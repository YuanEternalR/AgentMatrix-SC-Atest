"""把调度层接到数据库：加载候选、执行策略、落库决策。

调度层本身（``app.services.dispatch``）不认识 SQLAlchemy，这里负责两边的转换，
并保证每次分配都留下可解释的审计记录。
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Agent, DispatchDecision as DispatchDecisionRow, Run, Task
from app.services.dispatch import (
    AgentCandidate,
    DispatchDecision,
    DispatchRequest,
    ModelTier,
    build_from_config,
)
from app.services.llm.gateway import LLMGateway

# 认为"正在占用并发"的运行状态
_BUSY_RUN_STATUSES = ("queued", "running", "waiting_approval")


def to_candidate(agent: Agent, inflight: int = 0) -> AgentCandidate:
    return AgentCandidate(
        agent_code=agent.code,
        name=agent.name,
        stage=agent.stage,
        capabilities=frozenset(agent.capabilities or []),
        model_tier=ModelTier(agent.model_tier),
        success_rate=float(agent.success_rate),
        inflight=inflight,
        max_concurrency=int(agent.max_concurrency),
        p95_latency_ms=float(agent.p95_latency_ms),
        avg_cost_usd=float(agent.avg_cost_usd),
        tags=frozenset(),
    )


def _inflight_counts(db: Session) -> dict[str, int]:
    """按智能体统计正在占用的并发（通过任务的调度决策关联到运行）。"""
    stmt = (
        select(DispatchDecisionRow.agent_code, func.count(Run.id))
        .join(Task, Task.id == DispatchDecisionRow.task_id)
        .join(Run, Run.task_id == Task.id)
        .where(Run.status.in_(_BUSY_RUN_STATUSES))
        .where(DispatchDecisionRow.agent_code.is_not(None))
        .group_by(DispatchDecisionRow.agent_code)
    )
    return {code: int(count) for code, count in db.execute(stmt).all()}


def load_candidates(db: Session) -> list[AgentCandidate]:
    agents = db.scalars(
        select(Agent).where(Agent.status.in_(("active", "published")))
    ).all()
    inflight = _inflight_counts(db)
    return [to_candidate(a, inflight.get(a.code, 0)) for a in agents]


def build_request(task: Task) -> DispatchRequest:
    return DispatchRequest(
        task_id=task.id,
        task_type=(task.payload or {}).get("task_type", "generic"),
        required_capabilities=frozenset(task.required_capabilities or []),
        priority=task.priority,
        sla_ms=None,
        budget_usd=None,
        stage=None,
        tags=frozenset(),
        estimated_steps=1,
        complexity_hint=task.complexity_hint,
    )


def make_strategy(provider: str | None = None):
    """按当前配置装配策略；s4 需要规划器。"""
    gateway = LLMGateway(provider or settings.llm_provider)
    config = {
        "strategy": settings.dispatch_strategy,
        "sla_headroom": settings.dispatch_sla_headroom,
        "min_success_rate": settings.dispatch_min_success_rate,
    }
    return build_from_config(config, planner=gateway.plan)


def start_task(db: Session, task: Task) -> Run | None:
    """给任务做一次调度，成功分配则创建运行并置为排队。

    创建任务与"容量释放后重试分配"共用这一段，避免两处逻辑分叉。
    """
    import uuid

    from app.models import Workflow, WorkflowVersion

    workflow = db.get(Workflow, task.workflow_id) if task.workflow_id else None
    if workflow is None:
        return None

    version = db.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow.id, WorkflowVersion.status == "published")
        .order_by(WorkflowVersion.version.desc())
    ).first()
    if version is None:
        return None

    decision, _ = dispatch_task(db, task, load_candidates(db))
    if not decision.agent_code:
        task.status = "pending"
        db.commit()
        return None

    graph = version.graph or {}
    run = Run(
        task_id=task.id,
        workflow_version_id=version.id,
        status="queued",
        trigger=task.source,
        trace_id=uuid.uuid4().hex,
        cursor_node_id=graph.get("entry"),
        context={},
    )
    db.add(run)
    task.status = "queued"
    db.commit()
    db.refresh(run)
    return run


def redispatch_pending(db: Session, limit: int = 10) -> int:
    """把因容量不足而滞留的任务重新分配。

    没有这一步，高并发下被硬过滤淘汰的任务会永远停在 pending。
    只处理 pending：dispatching 表示创建流程正在进行，不能抢。
    """
    from app.models import Run as RunModel

    has_run = select(RunModel.task_id).where(RunModel.task_id.is_not(None))
    pending = db.scalars(
        select(Task)
        .where(Task.status == "pending")
        .where(Task.id.not_in(has_run))
        .order_by(Task.created_at.asc())
        .limit(limit)
    ).all()

    started = 0
    for task in pending:
        if start_task(db, task) is not None:
            started += 1
    return started


def dispatch_task(
    db: Session,
    task: Task,
    candidates: list[AgentCandidate] | None = None,
) -> tuple[DispatchDecision, DispatchDecisionRow]:
    """执行一次调度，落库并返回（决策, 数据库记录）。"""
    candidates = candidates if candidates is not None else load_candidates(db)
    strategy = make_strategy()
    decision = strategy.select(build_request(task), candidates)

    row = DispatchDecisionRow(
        task_id=task.id,
        strategy=decision.strategy,
        agent_code=decision.agent_code,
        score=decision.score,
        factors=[
            {
                "name": f.name,
                "raw": f.raw,
                "weight": f.weight,
                "contribution": f.contribution,
                "detail": f.detail,
            }
            for f in decision.factors
        ],
        rejected=[{"agent_code": r.agent_code, "reason": r.reason} for r in decision.rejected],
        planned_by=decision.planned_by,
        fallback_reason=decision.fallback_reason,
        reason=decision.reason,
        dispatch_ms=0.0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return decision, row
