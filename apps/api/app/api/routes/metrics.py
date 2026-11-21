"""监控指标。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.services.metrics import compute_metrics

router = APIRouter(prefix="/metrics", tags=["monitor"])


@router.get("")
def get_metrics(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    hours: int = Query(default=24, ge=1, le=168),
) -> dict:
    return compute_metrics(db, hours=hours)
