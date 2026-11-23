"""FastAPI entrypoint.

Routes are intentionally thin: the API only validates, persists and queries.
Long-running work belongs to the worker, never to a request handler.
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.router import api_router
from app.core.config import settings
from app.db.session import engine, get_db
from app.services.dispatch.registry import list_specs

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("agentmatrix")


class UTF8JSONResponse(JSONResponse):
    """显式声明 charset。

    Starlette 默认返回 ``application/json``（不带 charset），Windows PowerShell 5.1
    的 Invoke-RestMethod 会因此按 Latin-1 解码，中文变成乱码。
    """

    media_type = "application/json; charset=utf-8"


app = FastAPI(
    title="AgentMatrix-SC API",
    version="0.1.0",
    description="面向供应链的智能体矩阵工作台 —— 调度层与运行时",
    default_response_class=UTF8JSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


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

    return UTF8JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "checks": checks},
    )


@app.get("/api/v1/meta", tags=["ops"])
def meta(db: Session = Depends(get_db)) -> dict:
    """Capabilities the UI needs at boot."""
    from app.services.settings_store import load_dispatch_config

    dispatch = load_dispatch_config(db)
    return {
        "name": "AgentMatrix-SC",
        "version": "0.1.0",
        "env": settings.app_env,
        "dispatch": {
            # 库里改过就以库为准：界面上的"当前策略"必须与调度实际用的同一个来源
            "active_strategy": dispatch["strategy"],
            "source": dispatch["source"],
            "strategies": list_specs(),
        },
    }
