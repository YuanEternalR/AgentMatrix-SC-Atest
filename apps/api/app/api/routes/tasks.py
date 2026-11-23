"""任务创建与查询。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import DispatchDecision as DispatchDecisionRow
from app.models import Agent, Run, Task, User, Workflow, WorkflowVersion
from app.schemas.task import DecisionOut, TaskCreate, TaskDetailOut, TaskOut
from app.services.audit import AuditCtx, record, request_ctx
from app.services.dispatcher import start_task

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _latest_published_version(db: Session, workflow_id: str) -> WorkflowVersion | None:
    return db.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id, WorkflowVersion.status == "published")
        .order_by(WorkflowVersion.version.desc())
    ).first()


@router.post("", response_model=TaskDetailOut, status_code=status.HTTP_201_CREATED)
def create_task(
    body: TaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> TaskDetailOut:
    if body.idempotency_key:
        existing = db.scalars(
            select(Task).where(Task.idempotency_key == body.idempotency_key)
        ).first()
        if existing:
            # 幂等：直接返回既有任务，不重复创建
            return get_task(existing.id, db, user)

    workflow = db.scalars(select(Workflow).where(Workflow.code == body.workflow_code)).first()
    if workflow is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"工作流不存在：{body.workflow_code}")

    version = _latest_published_version(db, workflow.id)
    if version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"工作流 {workflow.code} 没有已发布版本")

    graph = version.graph or {}
    task = Task(
        title=body.title,
        source="api",
        priority=body.priority,
        complexity_hint=body.complexity_hint,
        payload=body.payload,
        required_capabilities=list(graph.get("required_capabilities") or []),
        workflow_id=workflow.id,
        # 先占位为 dispatching：否则 Worker 的重试分配会在"任务已落库、还没建运行"
        # 的窗口里抢先处理，造成同一任务被执行两次
        status="dispatching",
        deadline_at=(
            datetime.now(timezone.utc) + timedelta(seconds=body.deadline_in_sec)
            if body.deadline_in_sec
            else None
        ),
        idempotency_key=body.idempotency_key,
        created_by=user.id,
    )
    db.add(task)
    # flush 才能拿到新任务 id（审计要记"对哪个对象"），但仍与创建共用一个事务
    db.flush()
    record(
        db,
        "task.create",
        user=user,
        resource_type="task",
        resource_id=task.id,
        summary=f"{user.name} 发起任务「{task.title}」（{workflow.name}，优先级 P{task.priority}）",
        after={
            "title": task.title,
            "workflow_code": workflow.code,
            "priority": task.priority,
            "payload": body.payload,
        },
        ctx=ctx,
    )
    db.commit()
    db.refresh(task)

    # 调度 + 建运行；未分到则留在 pending，由 Worker 周期重试分配
    start_task(db, task)

    return get_task(task.id, db, user)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100),
    order: str = Query(default="created_at", pattern="^(created_at|risk)$"),
) -> list[TaskOut]:
    """任务列表。支持状态筛选、关键词搜索、分页与排序。

    总数放在 ``X-Total-Count`` 响应头里，保持 body 仍是数组（不破坏既有调用方）。
    ``order=risk`` 按"失败 > 待审批 > 运行中 > 排队 > 其他"排序——异常优先，
    否则出问题的任务会被大量正常任务淹没。
    """
    base = select(Task)
    if status_filter:
        statuses = [s for s in status_filter.split(",") if s]
        base = base.where(Task.status.in_(statuses))
    if q:
        pattern = f"%{q}%"
        base = base.where(or_(Task.title.ilike(pattern), Task.id.ilike(pattern)))

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    if order == "risk":
        risk = case(
            (Task.status == "failed", 0),
            (Task.status == "waiting_approval", 1),
            (Task.status == "running", 2),
            (Task.status == "queued", 3),
            (Task.status == "pending", 4),
            else_=5,
        )
        stmt = base.order_by(risk.asc(), Task.created_at.desc())
    else:
        stmt = base.order_by(Task.created_at.desc())

    rows = db.scalars(stmt.limit(limit).offset(offset)).all()

    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    # 列表需要展示工作流编码与中文名：TaskOut 从 ORM 读不到，这里补一次映射
    workflows = db.scalars(select(Workflow)).all()
    codes = {w.id: w.code for w in workflows}
    names = {w.id: w.name for w in workflows}
    out: list[TaskOut] = []
    for task in rows:
        item = TaskOut.model_validate(task)
        item.workflow_code = codes.get(task.workflow_id or "")
        item.workflow_name = names.get(task.workflow_id or "")
        out.append(item)
    return out


@router.get("/{task_id}", response_model=TaskDetailOut)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TaskDetailOut:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")

    run = db.scalars(
        select(Run).where(Run.task_id == task.id).order_by(Run.created_at.desc())
    ).first()
    decision_row = db.scalars(
        select(DispatchDecisionRow)
        .where(DispatchDecisionRow.task_id == task.id)
        .order_by(DispatchDecisionRow.created_at.desc())
    ).first()
    workflow = db.get(Workflow, task.workflow_id) if task.workflow_id else None

    out = TaskDetailOut.model_validate(task)
    out.run_id = run.id if run else None
    out.run_status = run.status if run else None
    out.workflow_code = workflow.code if workflow else None
    out.workflow_name = workflow.name if workflow else None
    out.decision = DecisionOut.model_validate(decision_row) if decision_row else None
    if out.decision is not None and out.decision.agent_code:
        agent = db.scalars(select(Agent).where(Agent.code == out.decision.agent_code)).first()
        out.decision.agent_name = agent.name if agent else None
    return out
