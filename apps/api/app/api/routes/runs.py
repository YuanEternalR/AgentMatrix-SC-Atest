"""运行与步骤查询。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import Run, RunStep, User, WorkflowVersion
from app.schemas.run import RunDetailOut, RunOut, RunStepOut

router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("", response_model=list[RunOut])
def list_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[RunOut]:
    stmt = select(Run).order_by(Run.created_at.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(Run.status == status_filter)
    return [RunOut.model_validate(r) for r in db.scalars(stmt).all()]


@router.get("/{run_id}", response_model=RunDetailOut)
def get_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RunDetailOut:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "运行不存在")

    steps = db.scalars(
        select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.started_at.asc())
    ).all()
    version = db.get(WorkflowVersion, run.workflow_version_id) if run.workflow_version_id else None

    out = RunDetailOut.model_validate(run)
    out.steps = [RunStepOut.model_validate(s) for s in steps]
    out.workflow_version = version.version if version else None
    out.graph = (version.graph or None) if version else None
    return out


@router.post("/{run_id}/cancel", response_model=RunOut)
def cancel_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> RunOut:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "运行不存在")
    if run.status in {"succeeded", "failed", "canceled", "timed_out"}:
        raise HTTPException(status.HTTP_409_CONFLICT, f"运行已结束（{run.status}），无法取消")

    run.status = "canceled"
    run.finished_at = None
    db.commit()

    # 任务状态必须跟着运行走，否则列表里会一直显示"待审批"
    from app.models import Task

    task = db.get(Task, run.task_id)
    if task is not None and task.status not in ("succeeded", "failed"):
        task.status = "canceled"
        db.commit()

    db.refresh(run)
    return RunOut.model_validate(run)
