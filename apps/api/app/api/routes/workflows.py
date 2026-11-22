"""工作流列表、详情与新版本保存。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import User, Workflow, WorkflowVersion
from app.services.graph_validation import validate_graph
from app.services.workflow_diff import diff_graphs

router = APIRouter(prefix="/workflows", tags=["workflows"])


class VersionIn(BaseModel):
    graph: dict
    changelog: str = Field(default="", max_length=500)


class ValidateIn(BaseModel):
    graph: dict


def _latest_published(db: Session, workflow_id: str) -> WorkflowVersion | None:
    return db.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id, WorkflowVersion.status == "published")
        .order_by(WorkflowVersion.version.desc())
    ).first()


def _latest_any(db: Session, workflow_id: str) -> WorkflowVersion | None:
    return db.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id)
        .order_by(WorkflowVersion.version.desc())
    ).first()


@router.get("")
def list_workflows(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    workflows = db.scalars(select(Workflow).order_by(Workflow.code)).all()
    result: list[dict] = []

    for wf in workflows:
        latest = _latest_published(db, wf.id)
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
                # 供前端按 Schema 生成任务表单
                "variables_schema": (latest.variables_schema if latest else {}) or {},
            }
        )

    return result


@router.get("/{code}")
def get_workflow(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    wf = db.scalars(select(Workflow).where(Workflow.code == code)).first()
    if wf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"工作流不存在：{code}")

    versions = db.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == wf.id)
        .order_by(WorkflowVersion.version.desc())
    ).all()
    latest = versions[0] if versions else None

    return {
        "code": wf.code,
        "name": wf.name,
        "description": wf.description,
        "stage": wf.stage,
        "latest_version": latest.version if latest else None,
        "graph": (latest.graph or None) if latest else None,
        "variables_schema": (latest.variables_schema or {}) if latest else {},
        "versions": [
            {
                "version": v.version,
                "status": v.status,
                "changelog": v.changelog,
                "node_count": len((v.graph or {}).get("nodes", [])),
                "published_at": v.published_at.isoformat() if v.published_at else None,
            }
            for v in versions
        ],
    }


@router.get("/{code}/diff")
def diff_versions(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    from_version: int = Query(..., alias="from", ge=1),
    to_version: int = Query(..., alias="to", ge=1),
) -> dict:
    """对比同一工作流的两个版本（节点增删、字段变更、连线变化）。"""
    wf = db.scalars(select(Workflow).where(Workflow.code == code)).first()
    if wf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"工作流不存在：{code}")

    versions = {
        v.version: v
        for v in db.scalars(
            select(WorkflowVersion).where(
                WorkflowVersion.workflow_id == wf.id,
                WorkflowVersion.version.in_((from_version, to_version)),
            )
        ).all()
    }
    if from_version not in versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"版本不存在：v{from_version}")
    if to_version not in versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"版本不存在：v{to_version}")

    result = diff_graphs(versions[from_version].graph or {}, versions[to_version].graph or {})
    return {
        "code": wf.code,
        "from": from_version,
        "to": to_version,
        "from_changelog": versions[from_version].changelog,
        "to_changelog": versions[to_version].changelog,
        **result,
    }


@router.post("/{code}/validate")
def validate(
    code: str,
    body: ValidateIn,
    user: User = Depends(require_roles("developer")),
) -> dict:
    """只校验不保存，供设计器实时提示。"""
    return validate_graph(body.graph).as_dict()


@router.post("/{code}/versions", status_code=status.HTTP_201_CREATED)
def create_version(
    code: str,
    body: VersionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
) -> dict:
    wf = db.scalars(select(Workflow).where(Workflow.code == code)).first()
    if wf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"工作流不存在：{code}")

    result = validate_graph(body.graph)
    if not result.ok:
        # 校验失败必须拒绝保存：不允许把跑不通的图发布出去
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "图校验未通过", **result.as_dict()},
        )

    latest = _latest_any(db, wf.id)
    next_version = (latest.version + 1) if latest else 1

    row = WorkflowVersion(
        workflow_id=wf.id,
        version=next_version,
        graph=body.graph,
        variables_schema=(latest.variables_schema if latest else {}),
        sla_sec=latest.sla_sec if latest else None,
        changelog=body.changelog or f"由 {user.name} 在设计器中保存",
        status="published",
        published_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {
        "code": wf.code,
        "version": row.version,
        "status": row.status,
        "changelog": row.changelog,
        "warnings": result.as_dict()["warnings"],
    }
