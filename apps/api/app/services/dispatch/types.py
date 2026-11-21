"""Core value objects for the dispatch layer.

Everything here is immutable and dependency-free so the dispatch strategies and
the offline evaluation harness can be unit-tested without a database, Redis or
an LLM provider.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping, Protocol, Sequence


class ModelTier(str, Enum):
    """Execution tier an agent is bound to."""

    LARGE = "large"
    SMALL = "small"
    TOOL = "tool"


@dataclass(frozen=True, slots=True)
class AgentCandidate:
    """Snapshot of an agent's routing-relevant state.

    Built from ``agents`` + ``agent_versions`` + the live counters kept in
    Redis, but kept as a plain value object so strategies stay pure.
    """

    agent_code: str
    name: str
    stage: str
    capabilities: frozenset[str]
    model_tier: ModelTier
    success_rate: float
    inflight: int
    max_concurrency: int
    p95_latency_ms: float
    avg_cost_usd: float
    tags: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        if not 0.0 <= self.success_rate <= 1.0:
            raise ValueError(f"success_rate out of range for {self.agent_code}")
        if self.max_concurrency < 0 or self.inflight < 0:
            raise ValueError(f"negative concurrency for {self.agent_code}")

    @property
    def load(self) -> float:
        """Utilisation ratio in [0, 1]."""
        if self.max_concurrency <= 0:
            return 1.0
        return min(1.0, self.inflight / self.max_concurrency)

    @property
    def has_capacity(self) -> bool:
        return self.inflight < self.max_concurrency


@dataclass(frozen=True, slots=True)
class DispatchRequest:
    """A unit of work waiting to be assigned to an agent."""

    task_id: str
    task_type: str
    required_capabilities: frozenset[str]
    priority: int = 3
    sla_ms: int | None = None
    budget_usd: float | None = None
    stage: str | None = None
    tags: frozenset[str] = field(default_factory=frozenset)
    estimated_steps: int = 1
    complexity_hint: int = 3

    def __post_init__(self) -> None:
        if not 1 <= self.priority <= 5:
            raise ValueError("priority must be within 1..5 (1 = highest)")
        if self.estimated_steps < 1:
            raise ValueError("estimated_steps must be >= 1")
        if not 1 <= self.complexity_hint <= 5:
            raise ValueError("complexity_hint must be within 1..5")


@dataclass(frozen=True, slots=True)
class FactorScore:
    """One dimension of an explainable score."""

    name: str
    raw: float
    weight: float
    contribution: float
    detail: str


@dataclass(frozen=True, slots=True)
class Rejection:
    agent_code: str
    reason: str


@dataclass(frozen=True, slots=True)
class DispatchDecision:
    """Result of a strategy run, including the audit trail for the UI."""

    strategy: str
    task_id: str
    agent_code: str | None
    score: float
    factors: tuple[FactorScore, ...] = ()
    rejected: tuple[Rejection, ...] = ()
    planned_by: str = "rule"
    fallback_reason: str | None = None
    reason: str = ""

    @property
    def assigned(self) -> bool:
        return self.agent_code is not None

    def explain(self) -> Mapping[str, float]:
        return {f.name: round(f.contribution, 4) for f in self.factors}


class DispatchStrategy(Protocol):
    """Contract every routing policy must satisfy."""

    name: str

    def select(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> DispatchDecision: ...


class PlannerFn(Protocol):
    """A large-model planner: proposes an agent for a request.

    Returns the proposed ``agent_code`` plus an optional free-text reason. It is
    a plain callable so tests can inject a deterministic stub instead of a real
    LLM, and so the LLM gateway stays outside the dispatch package.
    """

    def __call__(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> Mapping[str, str]: ...
