"""可视化数据：协作拓扑、桑基图、业务看板。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.services.graphs import build_collaboration, build_sankey, business_dashboard

router = APIRouter(tags=["visualization"])


@router.get("/graphs/collaboration")
def collaboration(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit_runs: int = Query(default=200, ge=1, le=1000),
) -> dict:
    return build_collaboration(db, limit_runs=limit_runs)


@router.get("/graphs/sankey")
def sankey(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit_tasks: int = Query(default=500, ge=1, le=2000),
) -> dict:
    return build_sankey(db, limit_tasks=limit_tasks)


@router.get("/business")
def business(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    days: int = Query(default=30, ge=7, le=90),
) -> dict:
    return business_dashboard(db, days=days)
