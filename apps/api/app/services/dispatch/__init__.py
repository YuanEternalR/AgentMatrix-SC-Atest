"""Dispatch layer public API."""

from .evaluation import Scenario, SimulatedExecutor, StrategyReport, evaluate, to_markdown
from .filtering import hard_filter
from .registry import DEFAULT_STRATEGY, SPECS, StrategySpec, all_names, build, build_from_config, list_specs
from .strategies import (
    AllLargeModelStrategy,
    CostAwareStrategy,
    FixedRuleStrategy,
    LLMPlannerStrategy,
    ScoreWeights,
    WeightedScoreStrategy,
    score_candidates,
)
from .types import (
    AgentCandidate,
    DispatchDecision,
    DispatchRequest,
    DispatchStrategy,
    FactorScore,
    ModelTier,
    PlannerFn,
    Rejection,
)

__all__ = [
    "AgentCandidate",
    "AllLargeModelStrategy",
    "CostAwareStrategy",
    "DEFAULT_STRATEGY",
    "DispatchDecision",
    "DispatchRequest",
    "DispatchStrategy",
    "FactorScore",
    "FixedRuleStrategy",
    "LLMPlannerStrategy",
    "ModelTier",
    "PlannerFn",
    "Rejection",
    "SPECS",
    "Scenario",
    "ScoreWeights",
    "SimulatedExecutor",
    "StrategyReport",
    "StrategySpec",
    "WeightedScoreStrategy",
    "all_names",
    "build",
    "build_from_config",
    "evaluate",
    "hard_filter",
    "list_specs",
    "score_candidates",
    "to_markdown",
]
