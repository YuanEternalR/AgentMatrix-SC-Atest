import pytest

from app.services.dispatch import (
    AgentCandidate,
    AllLargeModelStrategy,
    CostAwareStrategy,
    DispatchRequest,
    FixedRuleStrategy,
    LLMPlannerStrategy,
    ModelTier,
    ScoreWeights,
    WeightedScoreStrategy,
    build,
    hard_filter,
)
from app.services.dispatch.registry import all_names


def agent(code, caps, **kw):
    defaults = dict(
        name=code,
        stage="fulfillment",
        capabilities=frozenset(caps),
        model_tier=ModelTier.SMALL,
        success_rate=0.8,
        inflight=0,
        max_concurrency=4,
        p95_latency_ms=1000,
        avg_cost_usd=0.01,
        tags=frozenset(),
    )
    defaults.update(kw)
    return AgentCandidate(agent_code=code, **defaults)


def request(**kw):
    defaults = dict(
        task_id="t-1",
        task_type="order_delay_exception",
        required_capabilities=frozenset({"order_query"}),
    )
    defaults.update(kw)
    return DispatchRequest(**defaults)


# --- hard filter -----------------------------------------------------------


def test_hard_filter_rejects_missing_capability():
    eligible, rejected = hard_filter(request(), [agent("a", {"order_query"}), agent("b", {"other"})])
    assert [c.agent_code for c in eligible] == ["a"]
    assert rejected[0].agent_code == "b"
    assert "缺少能力" in rejected[0].reason


def test_hard_filter_rejects_saturated_agent():
    saturated = agent("a", {"order_query"}, inflight=4, max_concurrency=4)
    eligible, rejected = hard_filter(request(), [saturated])
    assert eligible == []
    assert "并发上限" in rejected[0].reason


def test_hard_filter_rejects_sla_breach():
    slow = agent("a", {"order_query"}, p95_latency_ms=9000)
    _, rejected = hard_filter(request(sla_ms=5000), [slow])
    assert "SLA" in rejected[0].reason


def test_hard_filter_rejects_stage_mismatch():
    wrong = agent("a", {"order_query"}, stage="inventory")
    _, rejected = hard_filter(request(stage="fulfillment"), [wrong])
    assert "阶段不匹配" in rejected[0].reason


# --- weighted --------------------------------------------------------------


def test_weighted_prefers_stronger_agent():
    strong = agent("strong", {"order_query"}, success_rate=0.95, avg_cost_usd=0.02)
    weak = agent("weak", {"order_query"}, success_rate=0.55, avg_cost_usd=0.02)
    decision = WeightedScoreStrategy().select(request(), [weak, strong])
    assert decision.agent_code == "strong"
    assert decision.assigned


def test_weighted_factors_are_explainable():
    decision = WeightedScoreStrategy().select(request(), [agent("a", {"order_query"})])
    assert decision.factors
    assert abs(sum(f.contribution for f in decision.factors) - decision.score) < 1e-6
    assert abs(sum(f.weight for f in decision.factors) - 1.0) < 1e-6
    assert set(decision.explain()) == {
        "capability",
        "success",
        "load",
        "cost",
        "latency",
        "affinity",
    }


def test_weighted_is_deterministic_on_ties():
    twins = [agent("b", {"order_query"}), agent("a", {"order_query"})]
    first = WeightedScoreStrategy().select(request(), twins)
    second = WeightedScoreStrategy().select(request(), list(reversed(twins)))
    assert first.agent_code == second.agent_code


def test_weighted_returns_unassigned_when_nothing_eligible():
    decision = WeightedScoreStrategy().select(request(), [agent("a", {"other"})])
    assert decision.agent_code is None
    assert not decision.assigned
    assert "等待队列" in decision.reason


def test_weights_must_be_non_negative():
    with pytest.raises(ValueError):
        ScoreWeights(capability=-1)


# --- all large -------------------------------------------------------------


def test_all_large_picks_large_tier():
    small = agent("small", {"order_query"}, model_tier=ModelTier.SMALL, success_rate=0.9)
    large = agent("large", {"order_query"}, model_tier=ModelTier.LARGE, success_rate=0.7)
    decision = AllLargeModelStrategy().select(request(), [small, large])
    assert decision.agent_code == "large"


def test_all_large_falls_back_when_no_large_agent():
    small = agent("small", {"order_query"}, model_tier=ModelTier.SMALL)
    decision = AllLargeModelStrategy().select(request(), [small])
    assert decision.agent_code == "small"
    assert decision.fallback_reason is not None


# --- fixed rule ------------------------------------------------------------


def test_fixed_rule_takes_first_eligible():
    decision = FixedRuleStrategy().select(request(), [agent("z", {"other"}), agent("a", {"order_query"})])
    assert decision.agent_code == "a"


# --- cost aware ------------------------------------------------------------


def test_cost_aware_prefers_cheapest_within_sla():
    pricey = agent("pricey", {"order_query"}, avg_cost_usd=0.05, p95_latency_ms=3000, success_rate=0.95)
    cheap = agent("cheap", {"order_query"}, avg_cost_usd=0.001, p95_latency_ms=1500, success_rate=0.85)
    decision = CostAwareStrategy().select(request(sla_ms=10000), [pricey, cheap])
    assert decision.agent_code == "cheap"


def test_cost_aware_drops_agents_that_eat_the_sla_headroom():
    risky = agent("risky", {"order_query"}, avg_cost_usd=0.001, p95_latency_ms=9500)
    safe = agent("safe", {"order_query"}, avg_cost_usd=0.02, p95_latency_ms=2000)
    # 9500 <= 10000 but > 0.8 * 10000, so the guard excludes it.
    decision = CostAwareStrategy(sla_headroom=0.8).select(request(sla_ms=10000), [risky, safe])
    assert decision.agent_code == "safe"


def test_cost_aware_respects_quality_floor():
    """A cheap agent below the reliability floor must not be chosen."""
    risky = agent("risky", {"order_query"}, avg_cost_usd=0.0005, success_rate=0.60)
    solid = agent("solid", {"order_query"}, avg_cost_usd=0.02, success_rate=0.90)
    decision = CostAwareStrategy(min_success_rate=0.85).select(request(), [risky, solid])
    assert decision.agent_code == "solid"
    assert "质量下限" in decision.reason


# --- llm planner -----------------------------------------------------------


def test_llm_planner_honours_valid_plan():
    planner = lambda req, cands: {"agent_code": "b", "reason": "复杂异常需要更强推理"}
    decision = LLMPlannerStrategy(planner=planner).select(
        request(), [agent("a", {"order_query"}), agent("b", {"order_query"})]
    )
    assert decision.agent_code == "b"
    assert decision.planned_by == "llm"
    assert "推理" in decision.reason


def test_llm_planner_rejects_out_of_pool_plan():
    planner = lambda req, cands: {"agent_code": "ghost"}
    decision = LLMPlannerStrategy(planner=planner).select(request(), [agent("a", {"order_query"})])
    assert decision.agent_code == "a"
    assert decision.fallback_reason is not None


def test_llm_planner_survives_planner_exception():
    def boom(req, cands):
        raise RuntimeError("provider timeout")

    decision = LLMPlannerStrategy(planner=boom).select(request(), [agent("a", {"order_query"})])
    assert decision.agent_code == "a"
    assert "规划模型调用失败" in (decision.fallback_reason or "")


def test_llm_planner_without_planner_falls_back():
    decision = LLMPlannerStrategy().select(request(), [agent("a", {"order_query"})])
    assert decision.agent_code == "a"
    assert decision.planned_by == "rule"


class TestMockPlanner:
    """The offline planner stub must behave like a competent planner."""

    def test_hard_tasks_go_to_large_model(self):
        from app.services.dispatch.fixtures import mock_planner

        small = agent("small", {"order_query"}, model_tier=ModelTier.SMALL, success_rate=0.9, avg_cost_usd=0.001)
        large = agent("large", {"order_query"}, model_tier=ModelTier.LARGE, success_rate=0.95, avg_cost_usd=0.05)
        decision = LLMPlannerStrategy(planner=mock_planner).select(
            request(complexity_hint=5), [small, large]
        )
        assert decision.agent_code == "large"
        assert decision.planned_by == "llm"

    def test_easy_tasks_go_to_cheap_reliable_agent(self):
        from app.services.dispatch.fixtures import mock_planner

        small = agent("small", {"order_query"}, model_tier=ModelTier.SMALL, success_rate=0.88, avg_cost_usd=0.001)
        large = agent("large", {"order_query"}, model_tier=ModelTier.LARGE, success_rate=0.95, avg_cost_usd=0.05)
        decision = LLMPlannerStrategy(planner=mock_planner).select(
            request(complexity_hint=2), [small, large]
        )
        assert decision.agent_code == "small"

    def test_high_priority_goes_to_large_model(self):
        from app.services.dispatch.fixtures import mock_planner

        small = agent("small", {"order_query"}, model_tier=ModelTier.SMALL, success_rate=0.9, avg_cost_usd=0.001)
        large = agent("large", {"order_query"}, model_tier=ModelTier.LARGE, success_rate=0.95, avg_cost_usd=0.05)
        decision = LLMPlannerStrategy(planner=mock_planner).select(
            request(complexity_hint=2, priority=1), [small, large]
        )
        assert decision.agent_code == "large"


# --- registry --------------------------------------------------------------


def test_registry_builds_every_strategy():
    for name in all_names():
        assert build(name).name == name


def test_registry_rejects_unknown_strategy():
    with pytest.raises(KeyError):
        build("s9_nonexistent")
