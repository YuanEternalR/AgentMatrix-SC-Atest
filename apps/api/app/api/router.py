"""API 路由汇总。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import agents, approvals, auth, matrix, runs, tasks, workflows

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(tasks.router)
api_router.include_router(runs.router)
api_router.include_router(approvals.router)
api_router.include_router(agents.router)
api_router.include_router(workflows.router)
api_router.include_router(matrix.router)

__all__ = ["api_router"]
