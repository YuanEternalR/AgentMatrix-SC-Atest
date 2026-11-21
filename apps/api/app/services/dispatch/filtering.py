"""Hard filters shared by every dispatch strategy.

Hard filtering happens before scoring: a candidate that fails any hard
constraint is never scored, and the reason is recorded so the UI can show
"why not this agent" next to "why this agent".
"""

from __future__ import annotations

from typing import Sequence

from .types import AgentCandidate, DispatchRequest, Rejection


def hard_filter(
    request: DispatchRequest,
    candidates: Sequence[AgentCandidate],
) -> tuple[list[AgentCandidate], list[Rejection]]:
    eligible: list[AgentCandidate] = []
    rejected: list[Rejection] = []

    for cand in candidates:
        reason = _reject_reason(request, cand)
        if reason is None:
            eligible.append(cand)
        else:
            rejected.append(Rejection(agent_code=cand.agent_code, reason=reason))

    return eligible, rejected


def _reject_reason(request: DispatchRequest, cand: AgentCandidate) -> str | None:
    missing = request.required_capabilities - cand.capabilities
    if missing:
        return f"缺少能力: {', '.join(sorted(missing))}"

    if request.stage is not None and cand.stage != request.stage:
        return f"阶段不匹配: 需要 {request.stage}, 实际 {cand.stage}"

    if not cand.has_capacity:
        return f"已达并发上限 {cand.inflight}/{cand.max_concurrency}"

    # SLA feasibility uses the historical p95: if the agent's own tail latency
    # already blows the deadline, routing to it is a guaranteed SLA breach.
    if request.sla_ms is not None and cand.p95_latency_ms > request.sla_ms:
        return (
            f"p95 时延 {cand.p95_latency_ms:.0f}ms 超过 SLA {request.sla_ms}ms"
        )

    if request.budget_usd is not None and cand.avg_cost_usd > request.budget_usd:
        return (
            f"单步成本 {cand.avg_cost_usd:.4f} 超过预算 {request.budget_usd:.4f}"
        )

    return None
