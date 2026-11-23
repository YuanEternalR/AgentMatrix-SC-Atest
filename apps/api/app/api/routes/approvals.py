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

    # 角色校验：审批节点声明了 assignee_role，调用者必须匹配（admin 可代批）。
    # 不校验的话，运营能批"要求管理员"的节点，双人审批就形同虚设。
    required_role = approval.assignee_role
    if required_role and user.role not in {required_role, "admin"}:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"该审批需要 {required_role} 角色，当前为 {user.role}",
        )

    # 同一次运行的多个审批节点要求不同人处理（双人审批语义）。
    # admin 例外，便于演示与值班代批。
    if user.role != "admin":
        already = db.scalars(
            select(Approval).where(
                Approval.run_id == approval.run_id,
                Approval.id != approval.id,
                Approval.status == "approved",
                Approval.assignee_id == user.id,
            )
        ).first()
        if already is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "同一次运行的多个审批需由不同人处理"
            )

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

    from app.models import RunStep, Task  # 局部导入，避免顶层循环依赖

    task = db.get(Task, run.task_id)

    # 审批步骤自身也要收尾，否则时间线上会永远停在"待审批"
    if approval.step_id:
        step = db.get(RunStep, approval.step_id)
        if step is not None:
            step.status = "succeeded" if body.decision == "approved" else "failed"
            step.finished_at = datetime.now(timezone.utc)
            step.output = {
                **(step.output or {}),
                "decision": body.decision,
                "comment": body.comment,
                "decided_by": user.name,
            }

    if body.decision == "approved":
        # 释放执行权：worker 会从 cursor_node_id 继续
        run.status = "queued"
        if task is not None:
            task.status = "queued"
    else:
        run.status = "failed"
        run.error_code = "APPROVAL_REJECTED"
        run.finished_at = datetime.now(timezone.utc)
        if task is not None:
            task.status = "failed"

    db.commit()
    db.refresh(approval)
    return ApprovalOut.model_validate(approval)
