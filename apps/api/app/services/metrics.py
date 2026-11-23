"""运行指标聚合。

数据规模是演示级（数百条），所以直接拉取后在 Python 里聚合；
真上量时应改为 SQL 聚合或物化视图，接口保持不变。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Agent, DispatchDecision, Run, RunStep, Task, Workflow

FINISHED = ("succeeded", "failed", "canceled", "timed_out")


def _percentile(values: Sequence[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    index = max(0, min(len(ordered) - 1, round(q * (len(ordered) - 1))))
    return float(ordered[index])


def _duration_ms(run: Run) -> float | None:
    if not run.started_at or not run.finished_at:
        return None
    return (run.finished_at - run.started_at).total_seconds() * 1000


def compute_metrics(db: Session, hours: int = 24, limit: int = 1000) -> dict:
    runs = db.scalars(select(Run).order_by(Run.created_at.desc()).limit(limit)).all()

    finished = [r for r in runs if r.status in FINISHED]
    succeeded = [r for r in finished if r.status == "succeeded"]
    failed = [r for r in finished if r.status == "failed"]

    durations = [d for r in finished if (d := _duration_ms(r)) is not None and d >= 0]

    # 端到端耗时包含审批等待；执行耗时只算各步骤实际运行时间。
    # 两个口径必须分开报，否则"审批慢了"会被误读成"引擎慢了"。
    step_rows = db.execute(
        select(RunStep.run_id, RunStep.started_at, RunStep.finished_at).where(
            RunStep.status.in_(("succeeded", "failed"))
        )
    ).all()
    active_by_run: dict[str, float] = {}
    for step_run_id, step_started, step_finished in step_rows:
        if not step_started or not step_finished:
            continue
        active_by_run[step_run_id] = active_by_run.get(step_run_id, 0.0) + (
            step_finished - step_started
        ).total_seconds() * 1000

    finished_ids = {r.id for r in finished}
    active_durations = [v for k, v in active_by_run.items() if k in finished_ids and v >= 0]
    costs = [float(r.cost_usd or 0) for r in finished]
    tokens = sum(int(r.token_input or 0) + int(r.token_output or 0) for r in runs)

    # --- 时间趋势（按小时分桶）---
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(hours=hours - 1)).replace(minute=0, second=0, microsecond=0)
    buckets: dict[str, dict[str, int]] = {}
    for offset in range(hours):
        key = (window_start + timedelta(hours=offset)).strftime("%m-%d %H:00")
        buckets[key] = {"succeeded": 0, "failed": 0, "other": 0}

    for run in runs:
        created = run.created_at
        if created is None:
            continue
        created_utc = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
        if created_utc < window_start:
            continue
        key = created_utc.astimezone(timezone.utc).strftime("%m-%d %H:00")
        if key not in buckets:
            continue
        if run.status == "succeeded":
            buckets[key]["succeeded"] += 1
        elif run.status in ("failed", "timed_out"):
            buckets[key]["failed"] += 1
        elif run.status in FINISHED:
            buckets[key]["other"] += 1

    trend = [{"hour": k, **v} for k, v in buckets.items()]

    # --- 按智能体统计（编码用于统计，名称用于展示）---
    agent_names = {a.code: a.name for a in db.scalars(select(Agent)).all()}
    decisions = db.execute(select(DispatchDecision.task_id, DispatchDecision.agent_code)).all()
    task_to_agent = {task_id: code for task_id, code in decisions if code}

    agent_stats: dict[str, dict] = {}
    for run in runs:
        code = task_to_agent.get(run.task_id)
        if not code:
            continue
        stat = agent_stats.setdefault(
            code,
            {
                "agent_code": code,
                "agent_name": agent_names.get(code, code),
                "runs": 0,
                "succeeded": 0,
                "failed": 0,
                "cost_usd": 0.0,
            },
        )
        stat["runs"] += 1
        stat["cost_usd"] += float(run.cost_usd or 0)
        if run.status == "succeeded":
            stat["succeeded"] += 1
        elif run.status == "failed":
            stat["failed"] += 1

    by_agent = sorted(agent_stats.values(), key=lambda s: s["runs"], reverse=True)
    for stat in by_agent:
        decided = stat["succeeded"] + stat["failed"]
        stat["success_rate"] = round(stat["succeeded"] / decided, 4) if decided else 0.0
        stat["cost_usd"] = round(stat["cost_usd"], 6)

    # --- 按工作流统计 ---
    workflows = {wf.id: wf for wf in db.scalars(select(Workflow)).all()}
    task_workflow = {
        task_id: wf_id
        for task_id, wf_id in db.execute(select(Task.id, Task.workflow_id)).all()
        if wf_id
    }
    wf_stats: dict[str, dict] = {}
    for run in runs:
        wf_id = task_workflow.get(run.task_id)
        wf = workflows.get(wf_id) if wf_id else None
        code = wf.code if wf else "unknown"
        stat = wf_stats.setdefault(
            code,
            {
                "workflow_code": code,
                # 名称一并返回：前端只有一两张编码映射表，新工作流会露出英文编码
                "workflow_name": wf.name if wf else "未知工作流",
                "runs": 0,
                "succeeded": 0,
                "failed": 0,
            },
        )
        stat["runs"] += 1
        if run.status == "succeeded":
            stat["succeeded"] += 1
        elif run.status == "failed":
            stat["failed"] += 1

    by_workflow = sorted(wf_stats.values(), key=lambda s: s["runs"], reverse=True)

    recent_failures = [
        {
            "run_id": r.id,
            "task_id": r.task_id,
            "status": r.status,
            "error_code": r.error_code,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in runs
        if r.status in ("failed", "timed_out")
    ][:5]

    return {
        "window_hours": hours,
        "totals": {
            "runs": len(runs),
            "finished": len(finished),
            "succeeded": len(succeeded),
            "failed": len(failed),
            "running": sum(1 for r in runs if r.status in ("queued", "running")),
            "waiting_approval": sum(1 for r in runs if r.status == "waiting_approval"),
            "success_rate": round(len(succeeded) / len(finished), 4) if finished else 0.0,
            "p50_ms": round(_percentile(durations, 0.5), 1),
            "p95_ms": round(_percentile(durations, 0.95), 1),
            "median_ms": round(median(durations), 1) if durations else 0.0,
            "p50_active_ms": round(_percentile(active_durations, 0.5), 1),
            "p95_active_ms": round(_percentile(active_durations, 0.95), 1),
            "cost_usd": round(sum(costs), 6),
            "avg_cost_usd": round(sum(costs) / len(finished), 6) if finished else 0.0,
            "tokens": tokens,
        },
        "trend": trend,
        "by_agent": by_agent,
        "by_workflow": by_workflow,
        "recent_failures": recent_failures,
    }
