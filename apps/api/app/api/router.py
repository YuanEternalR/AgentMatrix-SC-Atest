"""API 路由汇总。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import agents, approvals, auth, runs, tasks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(tasks.router)
api_router.include_router(runs.router)
api_router.include_router(approvals.router)
api_router.include_router(agents.router)

__all__ = ["api_router"]
