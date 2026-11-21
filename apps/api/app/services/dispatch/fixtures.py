"""Reference agent pool and scenario set for the offline evaluation.

The numbers are hand-set to be plausible, not measured: they describe the
*shape* of the trade-off (a large model is accurate and expensive, a built-in
skill is cheap and narrow). Real values arrive from ``run_steps`` once the
engine has history, and :func:`refresh_from_history` is where that happens.
"""

from __future__ import annotations

from app.services.llm.gateway import mock_planner  # noqa: F401  —— 统一实现，避免两份启发式

from .evaluation import Scenario
from .types import AgentCandidate, ModelTier

# --- seven seed agents, one per supply-chain stage -------------------------

SEED_AGENTS: tuple[AgentCandidate, ...] = (
    AgentCandidate(
        agent_code="demand-planner",
        name="需求计划智能体",
        stage="demand",
        capabilities=frozenset({"demand_forecast", "time_series", "replenish_calc", "reasoning"}),
        model_tier=ModelTier.LARGE,
        success_rate=0.93,
        inflight=1,
        max_concurrency=6,
        p95_latency_ms=8200,
        avg_cost_usd=0.041,
        tags=frozenset({"weekly", "forecast"}),
    ),
    AgentCandidate(
        agent_code="buyer",
        name="采购寻源智能体",
        stage="sourcing",
        capabilities=frozenset({"supplier_score", "contract_lookup", "anomaly_detect", "reasoning"}),
        model_tier=ModelTier.LARGE,
        success_rate=0.90,
        inflight=0,
        max_concurrency=6,
        p95_latency_ms=7600,
        avg_cost_usd=0.038,
        tags=frozenset({"sourcing"}),
    ),
    AgentCandidate(
        agent_code="inventory-optimizer",
        name="库存优化智能体",
        stage="inventory",
        capabilities=frozenset({"stock_query", "rule_check", "replenish_calc", "demand_forecast"}),
        model_tier=ModelTier.SMALL,
        success_rate=0.88,
        inflight=2,
        max_concurrency=10,
        p95_latency_ms=1800,
        avg_cost_usd=0.006,
        tags=frozenset({"weekly", "replenish"}),
    ),
    AgentCandidate(
        agent_code="logistics-router",
        name="物流调度智能体",
        stage="logistics",
        capabilities=frozenset({"freight_query", "rule_check", "reasoning"}),
        model_tier=ModelTier.SMALL,
        success_rate=0.86,
        inflight=3,
        max_concurrency=10,
        p95_latency_ms=2100,
        avg_cost_usd=0.007,
        tags=frozenset({"in_transit"}),
    ),
    AgentCandidate(
        agent_code="fulfillment-triage",
        name="履约异常处理智能体",
        stage="fulfillment",
        capabilities=frozenset({"order_query", "impact_assess", "reasoning"}),
        model_tier=ModelTier.LARGE,
        success_rate=0.95,
        inflight=1,
        max_concurrency=8,
        p95_latency_ms=9400,
        avg_cost_usd=0.052,
        tags=frozenset({"urgent", "exception"}),
    ),
    AgentCandidate(
        agent_code="risk-inspector",
        name="供应商风险巡检智能体",
        stage="risk",
        capabilities=frozenset({"supplier_score", "anomaly_detect", "reasoning"}),
        model_tier=ModelTier.LARGE,
        success_rate=0.91,
        inflight=0,
        max_concurrency=6,
        p95_latency_ms=8800,
        avg_cost_usd=0.044,
        tags=frozenset({"weekly", "risk"}),
    ),
    AgentCandidate(
        agent_code="exception-rules",
        name="异常规则引擎",
        stage="fulfillment",
        capabilities=frozenset({"anomaly_detect", "rule_check", "order_query", "impact_assess"}),
        model_tier=ModelTier.TOOL,
        success_rate=0.82,
        inflight=0,
        max_concurrency=20,
        p95_latency_ms=240,
        avg_cost_usd=0.0004,
        tags=frozenset({"exception", "cheap"}),
    ),
    # 高端快线：更准更快但更贵，与 fulfillment-triage 构成同一能力格内的成本/质量梯度
    AgentCandidate(
        agent_code="express-triage",
        name="履约应急快线智能体",
        stage="fulfillment",
        capabilities=frozenset({"order_query", "impact_assess", "reasoning"}),
        model_tier=ModelTier.LARGE,
        success_rate=0.97,
        inflight=0,
        max_concurrency=4,
        p95_latency_ms=3100,
        avg_cost_usd=0.09,
        tags=frozenset({"urgent", "exception", "premium"}),
    ),
    # 预算模型：便宜但有质量上限，用来检验“质量下限”约束是否生效
    AgentCandidate(
        agent_code="bulk-forecaster",
        name="批量预测小模型",
        stage="demand",
        capabilities=frozenset({"demand_forecast", "time_series"}),
        model_tier=ModelTier.SMALL,
        success_rate=0.84,
        inflight=1,
        max_concurrency=12,
        p95_latency_ms=900,
        avg_cost_usd=0.004,
        tags=frozenset({"weekly", "budget"}),
    ),
)


def seed_scenarios(count_per_type: int = 6) -> list[Scenario]:
    """Build a balanced scenario set across the four demo task types."""
    scenarios: list[Scenario] = []

    def add(task_type, caps, difficulty, stage, tags, sla_ms, budget, priority, steps_prefix):
        for i in range(count_per_type):
            scenarios.append(
                Scenario(
                    task_id=f"{steps_prefix}-{i:03d}",
                    task_type=task_type,
                    required_capabilities=frozenset(caps),
                    difficulty=difficulty(i),
                    sla_ms=sla_ms(i),
                    budget_usd=budget,
                    priority=priority,
                    stage=stage,
                    tags=frozenset(tags),
                    estimated_steps=2 + (i % 3),
                )
            )

    # 订单延迟异常：SLA 紧，必须快
    add(
        "order_delay_exception",
        {"order_query", "impact_assess"},
        lambda i: 3 + (i % 3),
        "fulfillment",
        {"urgent", "exception"},
        lambda i: 12000,
        0.12,
        1,
        "order",
    )
    # 周度补货建议：SLA 宽松，成本敏感，且是跨阶段任务（需求预测 + 库存计算）
    add(
        "weekly_replenishment",
        {"demand_forecast", "replenish_calc"},
        lambda i: 2 + (i % 2),
        None,
        {"weekly", "replenish"},
        lambda i: 60000,
        0.05,
        4,
        "replen",
    )
    # 供应商风险巡检：中等难度，成本敏感
    add(
        "supplier_risk_patrol",
        {"supplier_score", "anomaly_detect"},
        lambda i: 3 + (i % 2),
        "risk",
        {"weekly", "risk"},
        lambda i: 45000,
        0.06,
        4,
        "risk",
    )
    # 运输在途异常：中等 SLA
    add(
        "shipment_anomaly",
        {"freight_query", "rule_check"},
        lambda i: 2 + (i % 3),
        "logistics",
        {"in_transit"},
        lambda i: 8000,
        0.02,
        2,
        "ship",
    )
    return scenarios
