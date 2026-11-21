"""审批中心：查询与决策。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import Approval, Run, User
from app.schemas.run import ApprovalDecisionIn, ApprovalOut

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=list[ApprovalOut])
def list_approvals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    pending_only: bool = Query(default=True),
) -> list[ApprovalOut]:
    stmt = select(Approval).order_by(Approval.created_at.desc())
    if pending_only:
        stmt = stmt.where(Approval.status == "pending")
    return [ApprovalOut.model_validate(a) for a in db.scalars(stmt).all()]


@router.post("/{approval_id}/decision", response_model=ApprovalOut)
def decide(
    approval_id: str,
    body: ApprovalDecisionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> ApprovalOut:
    approval = db.get(Approval, approval_id)
    if approval is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "审批不存在")
    if approval.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"审批已处理（{approval.status}）")

    run = db.get(Run, approval.run_id)
    if run is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "审批关联的运行不存在")
    if run.status != "waiting_approval":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"运行不在待审批状态（{run.status}）"
        )

    approval.status = body.decision
    approval.decision = body.decision
    approval.comment = body.comment
    approval.assignee_id = user.id
    approval.decided_at = datetime.now(timezone.utc)

    if body.decision == "approved":
        # 释放执行权：worker 会从 cursor_node_id 继续
        run.status = "queued"
    else:
        run.status = "failed"
        run.error_code = "APPROVAL_REJECTED"
        run.finished_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(approval)
    return ApprovalOut.model_validate(approval)
