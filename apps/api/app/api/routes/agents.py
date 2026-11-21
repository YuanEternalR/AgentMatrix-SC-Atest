"""智能体查询（矩阵视图的数据源）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Agent, AgentVersion, User

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
def list_agents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    agents = db.scalars(select(Agent).order_by(Agent.stage, Agent.code)).all()
    published: dict[str, int] = {}
    rows = db.execute(
        select(AgentVersion.agent_id, AgentVersion.version).where(
            AgentVersion.status == "published"
        )
    ).all()
    for agent_id, version in rows:
        published[agent_id] = max(published.get(agent_id, 0), version)

    return [
        {
            "code": a.code,
            "name": a.name,
            "stage": a.stage,
            "capabilities": a.capabilities or [],
            "status": a.status,
            "model_tier": a.model_tier,
            "success_rate": a.success_rate,
            "avg_cost_usd": a.avg_cost_usd,
            "p95_latency_ms": a.p95_latency_ms,
            "max_concurrency": a.max_concurrency,
            "published_version": published.get(a.id),
        }
        for a in agents
    ]


@router.get("/{code}")
def get_agent(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    agent = db.scalars(select(Agent).where(Agent.code == code)).first()
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "智能体不存在")

    versions = db.scalars(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent.id)
        .order_by(AgentVersion.version.desc())
    ).all()

    return {
        "code": agent.code,
        "name": agent.name,
        "description": agent.description,
        "stage": agent.stage,
        "capabilities": agent.capabilities or [],
        "status": agent.status,
        "model_tier": agent.model_tier,
        "success_rate": agent.success_rate,
        "avg_cost_usd": agent.avg_cost_usd,
        "p95_latency_ms": agent.p95_latency_ms,
        "max_concurrency": agent.max_concurrency,
        "versions": [
            {
                "version": v.version,
                "status": v.status,
                "system_prompt": v.system_prompt,
                "changelog": v.changelog,
                "published_at": v.published_at,
            }
            for v in versions
        ],
    }
