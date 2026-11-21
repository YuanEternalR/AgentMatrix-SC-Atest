"""产物查询与下载。"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Artifact, User

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


def _to_dict(artifact: Artifact) -> dict:
    return {
        "id": artifact.id,
        "run_id": artifact.run_id,
        "step_id": artifact.step_id,
        "name": artifact.name,
        "mime": artifact.mime,
        "uri": artifact.uri,
        "size": artifact.size,
        "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
    }


@router.get("")
def list_artifacts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    stmt = select(Artifact).order_by(Artifact.created_at.desc()).limit(limit)
    if run_id:
        stmt = stmt.where(Artifact.run_id == run_id)
    return [_to_dict(a) for a in db.scalars(stmt).all()]


@router.get("/{artifact_id}/download")
def download(
    artifact_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    artifact = db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "产物不存在")

    # 中文文件名必须按 RFC 5987 编码，否则部分客户端会乱码
    filename = quote(artifact.name)
    return Response(
        content=artifact.content.encode("utf-8"),
        media_type=f"{artifact.mime}; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
        },
    )
