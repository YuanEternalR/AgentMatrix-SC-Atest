"""FastAPI entrypoint.

Routes are intentionally thin: the API only validates, persists and queries.
Long-running work belongs to the worker, never to a request handler.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine
from app.services.dispatch.registry import DEFAULT_STRATEGY, list_specs

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("agentmatrix")

app = FastAPI(
    title="AgentMatrix-SC API",
    version="0.1.0",
    description="面向供应链的智能体矩阵工作台 —— 调度层与运行时",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["ops"])
def health() -> JSONResponse:
    """Readiness probe: 200 only when the database is reachable."""
    checks: dict[str, str] = {}
    ok = True

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 - health must never raise
        checks["database"] = f"error: {type(exc).__name__}"
        ok = False

    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2)
        client.ping()
        checks["redis"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error: {type(exc).__name__}"
        ok = False

    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "checks": checks},
    )


@app.get("/api/v1/meta", tags=["ops"])
def meta() -> dict:
    """Capabilities the UI needs at boot."""
    return {
        "name": "AgentMatrix-SC",
        "version": "0.1.0",
        "env": settings.app_env,
        "dispatch": {
            "active_strategy": settings.dispatch_strategy or DEFAULT_STRATEGY,
            "strategies": list_specs(),
        },
    }
