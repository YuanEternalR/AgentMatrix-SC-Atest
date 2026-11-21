"""Dispatch strategies — the research core of this workbench.

Five policies are registered today and they deliberately span the
"large-model-plans / small-model-or-skill-executes" design space:

    s0_all_large   every task goes to the strongest (largest) model  -> baseline
    s1_fixed_rule  first eligible agent in registration order        -> cheapest, dumbest
    s2_weighted    multi-factor weighted score (the product default)
    s3_cost_aware  lowest cost among agents that still meet the SLA
    s4_llm_planner large model proposes the assignee, rules validate -> guarded planning

Every strategy returns a :class:`DispatchDecision` carrying a per-factor
breakdown, so the API can answer "why did this task go to this agent" and the
evaluation harness can compare policies on identical inputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from .filtering import hard_filter
from .types import (
    AgentCandidate,
    DispatchDecision,
    DispatchRequest,
    FactorScore,
    ModelTier,
    PlannerFn,
    Rejection,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return max(0.0, min(1.0, numerator / denominator))


def _min_max(values: Iterable[float]) -> tuple[float, float]:
    seq = list(values)
    if not seq:
        return 0.0, 0.0
    return min(seq), max(seq)


def _inverse_normalise(value: float, lo: float, hi: float) -> float:
    """Map a "lower is better" metric onto [0, 1] where 1 is best."""
    if hi - lo <= 1e-12:
        return 1.0
    return 1.0 - (value - lo) / (hi - lo)


def _affinity(request: DispatchRequest, cand: AgentCandidate) -> float:
    """Stage alignment (half) plus tag overlap (half)."""
    stage_part = 0.5 if request.stage and cand.stage == request.stage else 0.0
    if request.tags:
        tag_part = 0.5 * _ratio(
            len(request.tags & cand.tags), len(request.tags)
        )
    else:
        tag_part = 0.0
    return stage_part + tag_part


def _no_candidate(strategy: str, request: DispatchRequest, rejected) -> DispatchDecision:
    return DispatchDecision(
        strategy=strategy,
        task_id=request.task_id,
        agent_code=None,
        score=0.0,
        rejected=tuple(rejected),
        reason="无可用智能体：全部被硬过滤淘汰，任务进入等待队列",
    )


def _best(
    scored: Sequence[tuple[AgentCandidate, float, tuple[FactorScore, ...]]],
) -> tuple[AgentCandidate, float, tuple[FactorScore, ...]]:
    # Explicit tiebreak on agent_code keeps routing reproducible run-to-run.
    return max(scored, key=lambda item: (item[1], -len(item[0].agent_code), item[0].agent_code))


# ---------------------------------------------------------------------------
# S2 / default: multi-factor weighted score
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ScoreWeights:
    """Weights for :class:`WeightedScoreStrategy`.

    Defaults follow the product spec: capability 35 / success 20 / load 15 /
    cost 10 / latency 10 / affinity 10.
    """

    capability: float = 0.35
    success: float = 0.20
    load: float = 0.15
    cost: float = 0.10
    latency: float = 0.10
    affinity: float = 0.10

    def __post_init__(self) -> None:
        if any(v < 0 for v in self.as_dict().values()):
            raise ValueError("score weights must be non-negative")
        if sum(self.as_dict().values()) <= 0:
            raise ValueError("at least one score weight must be positive")

    def as_dict(self) -> dict[str, float]:
        return {
            "capability": self.capability,
            "success": self.success,
            "load": self.load,
            "cost": self.cost,
            "latency": self.latency,
            "affinity": self.affinity,
        }

    def total(self) -> float:
        return sum(self.as_dict().values())


def score_candidates(
    request: DispatchRequest,
    candidates: Sequence[AgentCandidate],
    weights: ScoreWeights,
) -> list[tuple[AgentCandidate, float, tuple[FactorScore, ...]]]:
    """Score every candidate, normalising cost/latency inside this candidate set."""
    if not candidates:
        return []

    cost_lo, cost_hi = _min_max(c.avg_cost_usd for c in candidates)
    lat_lo, lat_hi = _min_max(c.p95_latency_ms for c in candidates)
    total_weight = weights.total()
    required = len(request.required_capabilities)

    scored: list[tuple[AgentCandidate, float, tuple[FactorScore, ...]]] = []
    for cand in candidates:
        cap = _ratio(len(request.required_capabilities & cand.capabilities), required) if required else 1.0
        load = 1.0 - cand.load
        cost = _inverse_normalise(cand.avg_cost_usd, cost_lo, cost_hi)
        latency = _inverse_normalise(cand.p95_latency_ms, lat_lo, lat_hi)
        affinity = _affinity(request, cand)

        raws = {
            "capability": (cap, f"能力命中 {cap:.0%}"),
            "success": (cand.success_rate, f"历史成功率 {cand.success_rate:.0%}"),
            "load": (load, f"空闲度 {load:.0%}（在跑 {cand.inflight}/{cand.max_concurrency}）"),
            "cost": (cost, f"单步成本 ${cand.avg_cost_usd:.4f}"),
            "latency": (latency, f"p95 {cand.p95_latency_ms:.0f}ms"),
            "affinity": (affinity, f"阶段/标签亲和 {affinity:.0%}"),
        }
        factors = tuple(
            FactorScore(
                name=name,
                raw=round(raw, 4),
                weight=round(weight / total_weight, 4),
                contribution=round(raw * weight / total_weight, 4),
                detail=detail,
            )
            for name, (raw, detail) in raws.items()
            for weight in (weights.as_dict()[name],)
        )
        score = round(sum(f.contribution for f in factors), 4)
        scored.append((cand, score, factors))

    scored.sort(key=lambda item: (-item[1], item[0].agent_code))
    return scored


class WeightedScoreStrategy:
    name = "s2_weighted"

    def __init__(self, weights: ScoreWeights | None = None) -> None:
        self.weights = weights or ScoreWeights()

    def select(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> DispatchDecision:
        eligible, rejected = hard_filter(request, candidates)
        if not eligible:
            return _no_candidate(self.name, request, rejected)

        scored = score_candidates(request, eligible, self.weights)
        cand, score, factors = scored[0]
        return DispatchDecision(
            strategy=self.name,
            task_id=request.task_id,
            agent_code=cand.agent_code,
            score=score,
            factors=factors,
            rejected=tuple(rejected),
            reason=f"加权总分最高（{score:.3f}）",
        )


# ---------------------------------------------------------------------------
# S0: everything goes to the largest model (quality ceiling baseline)
# ---------------------------------------------------------------------------


class AllLargeModelStrategy:
    name = "s0_all_large"

    def __init__(self, weights: ScoreWeights | None = None) -> None:
        self._fallback = WeightedScoreStrategy(weights)

    def select(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> DispatchDecision:
        eligible, rejected = hard_filter(request, candidates)
        large = [c for c in eligible if c.model_tier is ModelTier.LARGE]
        if not large:
            base = self._fallback.select(request, candidates)
            return DispatchDecision(
                strategy=self.name,
                task_id=base.task_id,
                agent_code=base.agent_code,
                score=base.score,
                factors=base.factors,
                rejected=base.rejected,
                fallback_reason="没有可用的大模型智能体，回退到加权打分",
                reason=base.reason,
            )

        chosen = max(large, key=lambda c: (c.success_rate, -c.avg_cost_usd))
        factors = (
            FactorScore(
                name="success",
                raw=chosen.success_rate,
                weight=1.0,
                contribution=chosen.success_rate,
                detail=f"大模型优先：历史成功率 {chosen.success_rate:.0%}",
            ),
        )
        return DispatchDecision(
            strategy=self.name,
            task_id=request.task_id,
            agent_code=chosen.agent_code,
            score=round(chosen.success_rate, 4),
            factors=factors,
            rejected=tuple(rejected),
            reason="基线策略：固定使用最大模型",
        )


# ---------------------------------------------------------------------------
# S1: registration-order rule (cheapest, no feedback loop)
# ---------------------------------------------------------------------------


class FixedRuleStrategy:
    name = "s1_fixed_rule"

    def select(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> DispatchDecision:
        eligible, rejected = hard_filter(request, candidates)
        if not eligible:
            return _no_candidate(self.name, request, rejected)

        chosen = eligible[0]
        required = len(request.required_capabilities)
        cap = _ratio(len(request.required_capabilities & chosen.capabilities), required) if required else 1.0
        factors = (
            FactorScore(
                name="capability",
                raw=cap,
                weight=1.0,
                contribution=cap,
                detail=f"固定规则：取注册顺序第一个可用智能体 {chosen.agent_code}",
            ),
        )
        return DispatchDecision(
            strategy=self.name,
            task_id=request.task_id,
            agent_code=chosen.agent_code,
            score=round(cap, 4),
            factors=factors,
            rejected=tuple(rejected),
            reason="固定规则：按注册顺序选择第一个可用智能体",
        )


# ---------------------------------------------------------------------------
# S3: cost-aware under an SLA guard
# ---------------------------------------------------------------------------


class CostAwareStrategy:
    """Cheapest agent that still clears a quality floor and an SLA headroom.

    Without the floor this collapses into "always pick the cheapest agent" and
    becomes indistinguishable from the weighted policy, which is exactly what
    the experiment needs to separate.
    """

    name = "s3_cost_aware"

    def __init__(self, sla_headroom: float = 0.8, min_success_rate: float = 0.85) -> None:
        if not 0 < sla_headroom <= 1:
            raise ValueError("sla_headroom must be in (0, 1]")
        if not 0 <= min_success_rate <= 1:
            raise ValueError("min_success_rate must be in [0, 1]")
        self.sla_headroom = sla_headroom
        self.min_success_rate = min_success_rate

    def select(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> DispatchDecision:
        eligible, rejected = hard_filter(request, candidates)
        if not eligible:
            return _no_candidate(self.name, request, rejected)

        reliable = [c for c in eligible if c.success_rate >= self.min_success_rate]
        pool = reliable or eligible
        notes: list[str] = []
        if not reliable:
            notes.append(f"没有智能体达到质量下限 {self.min_success_rate:.0%}")
        else:
            notes.append(f"质量下限 {self.min_success_rate:.0%}")

        if request.sla_ms is not None:
            guarded = [c for c in pool if c.p95_latency_ms <= request.sla_ms * self.sla_headroom]
            if guarded:
                pool = guarded
                notes.append(f"SLA 保留 {self.sla_headroom:.0%} 余量")
            else:
                notes.append("无智能体满足 SLA 余量，回退到全部候选")

        chosen = min(pool, key=lambda c: (c.avg_cost_usd, -c.success_rate))
        cost_lo, cost_hi = _min_max(c.avg_cost_usd for c in pool)
        cost_factor = _inverse_normalise(chosen.avg_cost_usd, cost_lo, cost_hi)
        factors = (
            FactorScore(
                name="cost",
                raw=round(cost_factor, 4),
                weight=0.6,
                contribution=round(cost_factor * 0.6, 4),
                detail=f"单步成本 ${chosen.avg_cost_usd:.4f}（候选池最低）",
            ),
            FactorScore(
                name="success",
                raw=chosen.success_rate,
                weight=0.4,
                contribution=round(chosen.success_rate * 0.4, 4),
                detail=f"历史成功率 {chosen.success_rate:.0%}",
            ),
        )
        return DispatchDecision(
            strategy=self.name,
            task_id=request.task_id,
            agent_code=chosen.agent_code,
            score=round(sum(f.contribution for f in factors), 4),
            factors=factors,
            rejected=tuple(rejected),
            reason=f"{'，'.join(notes)}：{chosen.agent_code}",
        )


# ---------------------------------------------------------------------------
# S4: large model plans, rules validate
# ---------------------------------------------------------------------------


class LLMPlannerStrategy:
    name = "s4_llm_planner"

    def __init__(
        self,
        planner: PlannerFn | None = None,
        weights: ScoreWeights | None = None,
    ) -> None:
        self.planner = planner
        self._fallback = WeightedScoreStrategy(weights)

    def select(
        self,
        request: DispatchRequest,
        candidates: Sequence[AgentCandidate],
    ) -> DispatchDecision:
        eligible, rejected = hard_filter(request, candidates)
        if not eligible:
            return _no_candidate(self.name, request, rejected)

        planned_by = "rule"
        fallback_reason: str | None = None
        proposal_reason = ""

        if self.planner is None:
            fallback_reason = "未配置规划模型，回退到加权打分"
        else:
            try:
                proposal = self.planner(request, eligible)
            except Exception as exc:  # planner failure must never break dispatch
                proposal = {}
                fallback_reason = f"规划模型调用失败：{type(exc).__name__}"
            code = (proposal or {}).get("agent_code", "")
            matched = next((c for c in eligible if c.agent_code == code), None)
            if matched is None:
                fallback_reason = fallback_reason or f"规划结果 {code!r} 不在可用候选内，回退到加权打分"
            else:
                planned_by = "llm"
                proposal_reason = str((proposal or {}).get("reason", ""))[:200]
                cap = _ratio(
                    len(request.required_capabilities & matched.capabilities),
                    len(request.required_capabilities),
                ) if request.required_capabilities else 1.0
                factors = (
                    FactorScore(
                        name="capability",
                        raw=round(cap, 4),
                        weight=0.5,
                        contribution=round(cap * 0.5, 4),
                        detail="大模型规划选中的智能体",
                    ),
                    FactorScore(
                        name="success",
                        raw=matched.success_rate,
                        weight=0.5,
                        contribution=round(matched.success_rate * 0.5, 4),
                        detail=f"历史成功率 {matched.success_rate:.0%}",
                    ),
                )
                return DispatchDecision(
                    strategy=self.name,
                    task_id=request.task_id,
                    agent_code=matched.agent_code,
                    score=round(sum(f.contribution for f in factors), 4),
                    factors=factors,
                    rejected=tuple(rejected),
                    planned_by=planned_by,
                    reason=proposal_reason or "大模型规划选中该智能体",
                )

        cand, score, factors = _best(score_candidates(request, eligible, self._fallback.weights))
        return DispatchDecision(
            strategy=self.name,
            task_id=request.task_id,
            agent_code=cand.agent_code,
            score=score,
            factors=factors,
            rejected=tuple(rejected),
            planned_by="rule",
            fallback_reason=fallback_reason,
            reason=f"回退加权打分：{cand.agent_code}",
        )
