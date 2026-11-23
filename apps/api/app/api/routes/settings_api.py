"""系统设置：调度策略与权重（规格 5.9 的第一块）。

「策略怎么设计」在界面上要能闭环：选策略 → 调权重 → 预览谁会被选中 → 保存 → 下一次调度生效。
只给一个只读的策略名，用户永远不知道那几个百分比是什么意思。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import User
from app.services.audit import AuditCtx, record, request_ctx
from app.services.dispatch import DispatchRequest, build_from_config, hard_filter
from app.services.dispatch.registry import list_specs
from app.services.dispatcher import load_candidates
from app.services.errors import BusinessError
from app.services.settings_store import (
    WEIGHT_FACTORS,
    env_defaults,
    load_dispatch_config,
    save_dispatch_config,
)

router = APIRouter(prefix="/settings", tags=["settings"])


class DispatchIn(BaseModel):
    strategy: str = Field(max_length=32)
    weights: dict[str, float] = Field(default_factory=dict)
    sla_headroom: float = 0.8
    min_success_rate: float = 0.85


class PreviewIn(BaseModel):
    required_capabilities: list[str] = Field(default_factory=list)
    priority: int = Field(default=3, ge=1, le=5)
    complexity_hint: int = Field(default=3, ge=1, le=5)
    # 允许"先试算再保存"：不传就用当前生效权重
    weights: dict[str, float] | None = None
    strategy: str | None = None


@router.get("/dispatch")
def get_dispatch_settings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    config = load_dispatch_config(db)
    return {
        "config": {
            "strategy": config["strategy"],
            "weights": config["weights"],
            "sla_headroom": config["sla_headroom"],
            "min_success_rate": config["min_success_rate"],
        },
        # env / db：改过没有、算出来的和部署配置是否一致，一眼可见
        "source": config["source"],
        "defaults": env_defaults(),
        "strategies": list_specs(),
        "factors": [
            {"code": code, "label": label, "description": desc}
            for code, label, desc in WEIGHT_FACTORS
        ],
    }


@router.put("/dispatch")
def update_dispatch_settings(
    body: DispatchIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    try:
        saved = save_dispatch_config(db, body.model_dump(), user)
    except BusinessError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    record(
        db,
        "dispatch.configure",
        user=user,
        resource_type="dispatch",
        resource_id="active",
        summary=(
            f"{user.name} 调整调度策略为「{saved['strategy']}」"
            f"（权重 {', '.join(f'{k}={v}' for k, v in saved['weights'].items())}）"
        ),
        before=saved.get("previous"),
        after={
            "strategy": saved["strategy"],
            "weights": saved["weights"],
            "sla_headroom": saved["sla_headroom"],
            "min_success_rate": saved["min_success_rate"],
        },
        ctx=ctx,
    )
    db.commit()
    return get_dispatch_settings(db, user)


def _mock_planner(request: DispatchRequest, candidates):
    """预览专用规划器：按成功率挑，不调真实模型（避免"看权重"也烧钱）。"""
    if not candidates:
        return {"agent_code": "", "reason": "无候选"}
    pick = max(candidates, key=lambda c: c.success_rate)
    return {"agent_code": pick.agent_code, "reason": "预览：按历史成功率选择（不调用真实模型）"}

@router.post("/dispatch/preview")
def preview_dispatch(
    body: PreviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """用当前（或传入的）参数跑一次真实打分，返回候选排名与因子拆解。

    这是"策略可设计"的关键：调完滑块立刻能看到谁会被选中、为什么——
    否则用户只能在任务跑完之后猜。
    """
    current = load_dispatch_config(db)
    merged = {
        "strategy": body.strategy or current["strategy"],
        "weights": {**current["weights"], **(body.weights or {})},
        "sla_headroom": current["sla_headroom"],
        "min_success_rate": current["min_success_rate"],
    }

    candidates = load_candidates(db)
    # 预览用固定规划器：不想因为"看一眼权重"就烧一次真实模型调用
    strategy = build_from_config(merged, planner=_mock_planner)

    request = DispatchRequest(
        task_id="preview",
        task_type="preview",
        required_capabilities=frozenset(body.required_capabilities),
        priority=body.priority,
        sla_ms=None,
        budget_usd=None,
        stage=None,
        tags=frozenset(),
        estimated_steps=1,
        complexity_hint=body.complexity_hint,
    )
    decision = strategy.select(request, candidates)
    eligible, rejected = hard_filter(request, candidates)

    return {
        "strategy": merged["strategy"],
        "weights": merged["weights"],
        "chosen": decision.agent_code,
        "score": decision.score,
        "reason": decision.reason,
        "planned_by": decision.planned_by,
        "factors": [
            {
                "name": factor.name,
                "raw": factor.raw,
                "weight": factor.weight,
                "contribution": factor.contribution,
                "detail": factor.detail,
            }
            for factor in decision.factors
        ],
        "rejected": [{"agent_code": r.agent_code, "reason": r.reason} for r in decision.rejected],
        "eligible_count": len(eligible),
        "candidates": [
            {
                "code": c.agent_code,
                "name": c.name,
                "stage": c.stage,
                "capabilities": sorted(c.capabilities),
                "success_rate": c.success_rate,
                "avg_cost_usd": c.avg_cost_usd,
                "p95_latency_ms": c.p95_latency_ms,
                "inflight": c.inflight,
            }
            for c in sorted(eligible, key=lambda c: c.agent_code)
        ],
    }
