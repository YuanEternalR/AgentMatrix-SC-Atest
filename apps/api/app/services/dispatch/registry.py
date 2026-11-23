"""Strategy registry.

The registry is the seam that makes the研究点 pluggable: the API reads the
active strategy name from settings, the evaluation harness iterates all of
them, and a new policy only has to be registered here.
"""

from __future__ import annotations

from typing import Any, Mapping

from .strategies import (
    AllLargeModelStrategy,
    CostAwareStrategy,
    FixedRuleStrategy,
    LLMPlannerStrategy,
    ScoreWeights,
    WeightedScoreStrategy,
)
from .types import DispatchStrategy, PlannerFn

DEFAULT_STRATEGY = "s2_weighted"


class StrategySpec:
    """Static description rendered in the settings page."""

    __slots__ = ("name", "label", "description", "research_role")

    def __init__(self, name: str, label: str, description: str, research_role: str) -> None:
        self.name = name
        self.label = label
        self.description = description
        self.research_role = research_role

    def as_dict(self) -> dict[str, str]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "research_role": self.research_role,
        }


SPECS: tuple[StrategySpec, ...] = (
    StrategySpec(
        "s0_all_large",
        "全大模型（基线）",
        "所有任务固定路由到最大模型智能体，只看历史成功率。",
        "质量上限基线：用于量化“大模型全包”的成本与时延代价。",
    ),
    StrategySpec(
        "s1_fixed_rule",
        "固定规则",
        "硬过滤后按注册顺序选择第一个可用智能体。",
        "下界基线：无反馈、无负载感知，用于证明反馈式调度的收益。",
    ),
    StrategySpec(
        "s2_weighted",
        "加权打分（产品基线）",
        "能力 35% / 成功率 20% / 负载 15% / 成本 10% / 时延 10% / 亲和 10%。",
        "产品基线策略：平衡质量、成本与负载，可解释性最强；实际默认值以 /settings/dispatch 为准。",
    ),
    StrategySpec(
        "s3_cost_aware",
        "SLA 约束下的成本优先",
        "先按 SLA 保留 20% 余量筛掉高风险候选，再取单步成本最低者。",
        "成本优化上界：验证“压成本是否以成功率为代价”。",
    ),
    StrategySpec(
        "s4_llm_planner",
        "大模型规划 + 规则校验",
        "由规划模型提出候选智能体，规则层校验其必须通过硬过滤，否则回退加权打分。",
        "本文主要创新点：大模型做规划、小模型/skill 执行的可控组合。",
    ),
)


def build(
    name: str,
    *,
    weights: ScoreWeights | None = None,
    planner: PlannerFn | None = None,
    sla_headroom: float = 0.8,
    min_success_rate: float = 0.85,
) -> DispatchStrategy:
    """Instantiate a strategy by name."""
    if name == "s0_all_large":
        return AllLargeModelStrategy(weights)
    if name == "s1_fixed_rule":
        return FixedRuleStrategy()
    if name == "s2_weighted":
        return WeightedScoreStrategy(weights)
    if name == "s3_cost_aware":
        return CostAwareStrategy(sla_headroom, min_success_rate)
    if name == "s4_llm_planner":
        return LLMPlannerStrategy(planner=planner, weights=weights)
    raise KeyError(f"unknown dispatch strategy: {name!r}")


def build_from_config(config: Mapping[str, Any], *, planner: PlannerFn | None = None) -> DispatchStrategy:
    """Build the active strategy from a settings mapping (env or DB row)."""
    name = str(config.get("strategy", DEFAULT_STRATEGY))
    raw_weights = config.get("weights") or {}
    weights = ScoreWeights(**raw_weights) if raw_weights else None
    return build(
        name,
        weights=weights,
        planner=planner,
        sla_headroom=float(config.get("sla_headroom", 0.8)),
        min_success_rate=float(config.get("min_success_rate", 0.85)),
    )


def all_names() -> list[str]:
    return [spec.name for spec in SPECS]


def list_specs() -> list[dict[str, str]]:
    return [spec.as_dict() for spec in SPECS]
