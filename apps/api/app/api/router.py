"""API 路由汇总。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    agents,
    alerts,
    approvals,
    artifacts,
    audit,
    auth,
    dead_letters,
    graphs,
    matrix,
    metrics,
    orders,
    runs,
    skills,
    tasks,
    workflows,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(tasks.router)
api_router.include_router(runs.router)
api_router.include_router(approvals.router)
api_router.include_router(agents.router)
api_router.include_router(skills.router)
api_router.include_router(workflows.router)
api_router.include_router(matrix.router)
api_router.include_router(metrics.router)
api_router.include_router(orders.router)
api_router.include_router(artifacts.router)
api_router.include_router(dead_letters.router)
api_router.include_router(alerts.router)
api_router.include_router(graphs.router)
api_router.include_router(audit.router)

__all__ = ["api_router"]
