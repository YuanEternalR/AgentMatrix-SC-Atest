"""工作流列表（前端发起任务时用于选择）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User, Workflow, WorkflowVersion

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("")
def list_workflows(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    workflows = db.scalars(select(Workflow).order_by(Workflow.code)).all()
    result: list[dict] = []

    for wf in workflows:
        latest = db.scalars(
            select(WorkflowVersion)
            .where(WorkflowVersion.workflow_id == wf.id, WorkflowVersion.status == "published")
            .order_by(WorkflowVersion.version.desc())
        ).first()
        graph = (latest.graph or {}) if latest else {}
        result.append(
            {
                "code": wf.code,
                "name": wf.name,
                "description": wf.description,
                "stage": wf.stage,
                "published_version": latest.version if latest else None,
                "required_capabilities": graph.get("required_capabilities", []),
                "node_count": len(graph.get("nodes", [])),
            }
        )

    return result
