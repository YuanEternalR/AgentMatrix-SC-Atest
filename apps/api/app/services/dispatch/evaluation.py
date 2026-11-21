"""Offline evaluation harness for dispatch strategies.

**This is a simulator, not a measurement of a real LLM.** It exists so that the
five policies can be compared on identical inputs, with identical random draws,
before any paid model is wired in. Every number it produces is labelled
``simulated`` in the report metadata; the thesis must state the same.

Design notes that matter for validity:

* The uniform "quality draw" for a task is seeded from the *task* only, so all
  strategies face the same luck — this is a paired / common-variate design and
  it removes most of the variance between arms.
* Latency jitter is seeded per (task, agent) so re-running a strategy reproduces
  the same numbers exactly.
* Cost is deterministic: ``avg_cost_usd * steps * (1 + 5% * difficulty)``.
"""

from __future__ import annotations

import hashlib
import random
import statistics
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .types import (
    AgentCandidate,
    DispatchRequest,
    DispatchStrategy,
    ModelTier,
)


# ---------------------------------------------------------------------------
# scenario / outcome
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Scenario:
    """A synthetic but business-shaped unit of work."""

    task_id: str
    task_type: str
    required_capabilities: frozenset[str]
    difficulty: int
    sla_ms: int | None = None
    budget_usd: float | None = None
    priority: int = 3
    stage: str | None = None
    tags: frozenset[str] = field(default_factory=frozenset)
    estimated_steps: int = 1

    def __post_init__(self) -> None:
        if not 1 <= self.difficulty <= 5:
            raise ValueError("difficulty must be within 1..5")

    def to_request(self) -> DispatchRequest:
        return DispatchRequest(
            task_id=self.task_id,
            task_type=self.task_type,
            required_capabilities=self.required_capabilities,
            priority=self.priority,
            sla_ms=self.sla_ms,
            budget_usd=self.budget_usd,
            stage=self.stage,
            tags=self.tags,
            estimated_steps=self.estimated_steps,
            complexity_hint=self.difficulty,
        )


@dataclass(frozen=True, slots=True)
class SimulatedOutcome:
    success: bool
    latency_ms: float
    cost_usd: float
    effective_success_prob: float


_TIER_CEILING: dict[ModelTier, int] = {
    ModelTier.LARGE: 5,
    ModelTier.SMALL: 3,
    ModelTier.TOOL: 2,
}

_OVERREACH_PENALTY = 0.18


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


class SimulatedExecutor:
    """Deterministic stand-in for the real agent runtime."""

    def probability(self, scenario: Scenario, agent: AgentCandidate) -> float:
        ceiling = _TIER_CEILING[agent.model_tier]
        overreach = max(0, scenario.difficulty - ceiling)
        prob = agent.success_rate * (1.0 - _OVERREACH_PENALTY * overreach)
        return max(0.02, min(0.99, prob))

    def execute(self, scenario: Scenario, agent: AgentCandidate) -> SimulatedOutcome:
        quality_draw = random.Random(_seed("quality", scenario.task_id)).random()
        jitter_rng = random.Random(_seed("latency", scenario.task_id, agent.agent_code))
        jitter = 0.85 + 0.30 * jitter_rng.random()

        prob = self.probability(scenario, agent)
        success = quality_draw < prob

        latency = agent.p95_latency_ms * (0.65 + 0.12 * scenario.difficulty) * jitter
        cost = agent.avg_cost_usd * scenario.estimated_steps * (1 + 0.05 * scenario.difficulty)
        if not success:
            # Failed steps are cheaper: they stop early, but retries are not
            # modelled here (the real engine charges them per attempt).
            cost *= 0.6
            latency *= 0.8
        return SimulatedOutcome(
            success=success,
            latency_ms=round(latency, 1),
            cost_usd=round(cost, 6),
            effective_success_prob=round(prob, 4),
        )


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------


def _percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile; q in [0, 1]."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    index = max(0, min(len(ordered) - 1, round(q * (len(ordered) - 1))))
    return float(ordered[index])


@dataclass
class StrategyReport:
    strategy: str
    tasks: int
    assigned: int
    unassigned: int
    succeeded: int
    success_rate: float          # of assigned tasks
    completion_rate: float       # succeeded / all tasks
    p50_latency_ms: float
    p95_latency_ms: float
    total_cost_usd: float
    avg_cost_usd: float
    fallback_count: int
    llm_planned: int
    dispatch_ms: float
    simulated: bool = True

    def as_row(self) -> dict[str, object]:
        return {
            "策略": self.strategy,
            "任务数": self.tasks,
            "未分配": self.unassigned,
            "成功率": f"{self.success_rate:.1%}",
            "完成率": f"{self.completion_rate:.1%}",
            "P50时延(ms)": f"{self.p50_latency_ms:.0f}",
            "P95时延(ms)": f"{self.p95_latency_ms:.0f}",
            "总成本($)": f"{self.total_cost_usd:.4f}",
            "单任务成本($)": f"{self.avg_cost_usd:.4f}",
            "回退次数": self.fallback_count,
            "LLM规划": self.llm_planned,
            "调度耗时(ms)": f"{self.dispatch_ms:.2f}",
        }


def evaluate(
    strategies: Sequence[DispatchStrategy],
    scenarios: Sequence[Scenario],
    agents: Sequence[AgentCandidate],
    executor: SimulatedExecutor | None = None,
) -> list[StrategyReport]:
    """Run every strategy over the same scenarios and agents."""
    import time

    engine = executor or SimulatedExecutor()
    reports: list[StrategyReport] = []

    for strategy in strategies:
        latencies: list[float] = []
        costs: list[float] = []
        assigned = 0
        succeeded = 0
        fallbacks = 0
        llm_planned = 0
        dispatch_seconds = 0.0

        for scenario in scenarios:
            request = scenario.to_request()
            started = time.perf_counter()
            decision = strategy.select(request, agents)
            dispatch_seconds += time.perf_counter() - started

            if decision.fallback_reason:
                fallbacks += 1
            if decision.planned_by == "llm":
                llm_planned += 1
            if not decision.assigned:
                continue

            assigned += 1
            agent = next(a for a in agents if a.agent_code == decision.agent_code)
            outcome = engine.execute(scenario, agent)
            latencies.append(outcome.latency_ms)
            costs.append(outcome.cost_usd)
            succeeded += int(outcome.success)

        total = len(scenarios)
        reports.append(
            StrategyReport(
                strategy=strategy.name,
                tasks=total,
                assigned=assigned,
                unassigned=total - assigned,
                succeeded=succeeded,
                success_rate=succeeded / assigned if assigned else 0.0,
                completion_rate=succeeded / total if total else 0.0,
                p50_latency_ms=_percentile(latencies, 0.50),
                p95_latency_ms=_percentile(latencies, 0.95),
                total_cost_usd=round(sum(costs), 6),
                avg_cost_usd=round(sum(costs) / total, 6) if total else 0.0,
                fallback_count=fallbacks,
                llm_planned=llm_planned,
                dispatch_ms=round(dispatch_seconds * 1000 / total, 3) if total else 0.0,
            )
        )

    return reports


def to_markdown(reports: Iterable[StrategyReport]) -> str:
    rows = list(reports)
    if not rows:
        return "_无评测结果_"
    headers = list(rows[0].as_row().keys())
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    for report in rows:
        row = report.as_row()
        lines.append("| " + " | ".join(str(row[h]) for h in headers) + " |")
    return "\n".join(lines)
