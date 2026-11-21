from app.services.dispatch import (
    Scenario,
    SimulatedExecutor,
    build,
    evaluate,
    to_markdown,
)
from app.services.dispatch.fixtures import SEED_AGENTS, mock_planner, seed_scenarios
from app.services.dispatch.registry import all_names


def all_strategies():
    return [
        build(name, planner=mock_planner if name == "s4_llm_planner" else None)
        for name in all_names()
    ]


def test_evaluation_covers_every_strategy():
    scenarios = seed_scenarios(count_per_type=4)
    reports = evaluate(all_strategies(), scenarios, SEED_AGENTS)
    assert [r.strategy for r in reports] == all_names()
    assert all(r.tasks == len(scenarios) for r in reports)


def test_evaluation_is_reproducible():
    scenarios = seed_scenarios(count_per_type=4)
    first = evaluate(all_strategies(), scenarios, SEED_AGENTS)
    second = evaluate(all_strategies(), scenarios, SEED_AGENTS)
    for a, b in zip(first, second):
        assert a.succeeded == b.succeeded
        assert a.total_cost_usd == b.total_cost_usd
        assert a.p95_latency_ms == b.p95_latency_ms


def test_report_rates_stay_in_range():
    reports = evaluate(all_strategies(), seed_scenarios(3), SEED_AGENTS)
    for report in reports:
        assert 0.0 <= report.success_rate <= 1.0
        assert 0.0 <= report.completion_rate <= 1.0
        assert report.succeeded <= report.assigned <= report.tasks
        assert report.total_cost_usd >= 0.0


def test_cost_aware_is_cheaper_than_all_large():
    """The central claim of the cost experiment: routing down saves money."""
    reports = {r.strategy: r for r in evaluate(all_strategies(), seed_scenarios(5), SEED_AGENTS)}
    assert reports["s3_cost_aware"].total_cost_usd < reports["s0_all_large"].total_cost_usd


def test_all_large_has_the_highest_success_rate_or_ties():
    reports = {r.strategy: r for r in evaluate(all_strategies(), seed_scenarios(5), SEED_AGENTS)}
    baseline = reports["s0_all_large"].success_rate
    assert baseline >= reports["s1_fixed_rule"].success_rate


def test_simulator_is_deterministic_per_scenario_and_agent():
    engine = SimulatedExecutor()
    scenario = Scenario(
        task_id="fixed-task",
        task_type="weekly_replenishment",
        required_capabilities=frozenset({"demand_forecast"}),
        difficulty=4,
    )
    first = engine.execute(scenario, SEED_AGENTS[0])
    second = engine.execute(scenario, SEED_AGENTS[0])
    assert first == second


def test_simulator_punishes_overreach_of_small_models():
    engine = SimulatedExecutor()
    scenario = Scenario(
        task_id="hard-task",
        task_type="order_delay_exception",
        required_capabilities=frozenset({"order_query"}),
        difficulty=5,
    )
    large = next(a for a in SEED_AGENTS if a.model_tier.value == "large")
    tool = next(a for a in SEED_AGENTS if a.model_tier.value == "tool")
    assert engine.probability(scenario, large) > engine.probability(scenario, tool)


def test_markdown_table_has_one_row_per_strategy():
    reports = evaluate(all_strategies(), seed_scenarios(2), SEED_AGENTS)
    table = to_markdown(reports)
    lines = [line for line in table.splitlines() if line.startswith("|")]
    assert len(lines) == len(reports) + 2  # header + separator
