"""死信：重试耗尽后的运行，需要人工重试或标记忽略。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import DeadLetter, Run, Task, User
from app.services.audit import AuditCtx, ERROR_LABELS, record, request_ctx

router = APIRouter(prefix="/dead-letters", tags=["dead-letters"])


def _to_dict(dl: DeadLetter, run: Run | None) -> dict:
    return {
        "id": dl.id,
        "run_id": dl.run_id,
        "task_id": dl.task_id,
        "node_id": dl.node_id,
        "error_code": dl.error_code,
        "message": dl.message,
        "attempts": dl.attempts,
        "status": dl.status,
        "created_at": dl.created_at.isoformat() if dl.created_at else None,
        "run_status": run.status if run else None,
        "task_title": None,
    }


@router.get("")
def list_dead_letters(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    only_pending: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    stmt = select(DeadLetter).order_by(DeadLetter.created_at.desc()).limit(limit)
    if only_pending:
        stmt = stmt.where(DeadLetter.status == "pending")

    rows = db.scalars(stmt).all()
    result = []
    for dl in rows:
        item = _to_dict(dl, db.get(Run, dl.run_id))
        task = db.get(Task, dl.task_id)
        item["task_title"] = task.title if task else None
        result.append(item)
    return result


@router.post("/{dead_letter_id}/retry")
def retry_dead_letter(
    dead_letter_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    dl = db.get(DeadLetter, dead_letter_id)
    if dl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "死信不存在")
    if dl.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"死信已处理（{dl.status}）")

    run = db.get(Run, dl.run_id)
    if run is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "死信关联的运行不存在")

    # 回到失败节点重新执行：游标已指向该节点，这里只需重置运行状态
    run.status = "queued"
    run.error_code = None
    run.finished_at = None
    run.next_attempt_at = None
    run.cursor_node_id = dl.node_id

    task = db.get(Task, run.task_id)
    if task is not None:
        task.status = "queued"

    dl.status = "retried"
    dl.resolved_by = user.id
    dl.resolved_at = datetime.now(timezone.utc)

    record(
        db,
        "dead_letter.retry",
        user=user,
        resource_type="dead_letter",
        resource_id=dl.id,
        summary=(
            f"{user.name} 重试死信：运行 {run.id[:8]} 节点 {dl.node_id}"
            f"（{ERROR_LABELS.get(dl.error_code, dl.error_code)}）"
        ),
        before={"status": "pending"},
        after={"status": "retried", "run_status": run.status, "cursor_node_id": run.cursor_node_id},
        ctx=ctx,
    )

    db.commit()
    return {"id": dl.id, "status": dl.status, "run_id": run.id, "cursor_node_id": run.cursor_node_id}


@router.post("/{dead_letter_id}/ignore")
def ignore_dead_letter(
    dead_letter_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    dl = db.get(DeadLetter, dead_letter_id)
    if dl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "死信不存在")
    if dl.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"死信已处理（{dl.status}）")

    dl.status = "ignored"
    dl.resolved_by = user.id
    dl.resolved_at = datetime.now(timezone.utc)

    record(
        db,
        "dead_letter.ignore",
        user=user,
        resource_type="dead_letter",
        resource_id=dl.id,
        summary=(
            f"{user.name} 忽略死信：运行 {dl.run_id[:8]} 节点 {dl.node_id}"
            f"（{ERROR_LABELS.get(dl.error_code, dl.error_code)}）"
        ),
        before={"status": "pending"},
        after={"status": "ignored"},
        ctx=ctx,
    )

    db.commit()
    return {"id": dl.id, "status": dl.status}
