"""任务创建与查询。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import DispatchDecision as DispatchDecisionRow
from app.models import Run, Task, User, Workflow, WorkflowVersion
from app.schemas.task import DecisionOut, TaskCreate, TaskDetailOut, TaskOut
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
    db.commit()
    db.refresh(task)

    # 调度 + 建运行；未分到则留在 pending，由 Worker 周期重试分配
    start_task(db, task)

    return get_task(task.id, db, user)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[TaskOut]:
    stmt = select(Task).order_by(Task.created_at.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    return [TaskOut.model_validate(t) for t in db.scalars(stmt).all()]


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
    out.decision = DecisionOut.model_validate(decision_row) if decision_row else None
    return out
