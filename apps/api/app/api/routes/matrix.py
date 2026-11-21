"""智能体矩阵视图。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Agent, User
from app.services.matrix import build_matrix

router = APIRouter(prefix="/matrix", tags=["matrix"])


@router.get("")
def get_matrix(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    agents = db.scalars(select(Agent).order_by(Agent.code)).all()
    return build_matrix(agents)
