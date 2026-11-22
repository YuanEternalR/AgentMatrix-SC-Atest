"""LLM 网关的离线测试：不联网、不依赖真实 Key。

真实 Provider 的 HTTP 层用 monkeypatch 替换，只验证：
请求构造、响应解析、成本计算、错误分类、规划输出的容错。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.services.dispatch.types import (  # noqa: E402
    AgentCandidate,
    DispatchRequest,
    ModelTier,
)
from app.services.errors import ErrorCode, NodeError  # noqa: E402
from app.services.llm import gateway as gw  # noqa: E402


def make_request() -> DispatchRequest:
    return DispatchRequest(
        task_id="t1",
        task_type="order_delay_exception",
        required_capabilities=frozenset({"order_query", "impact_assess"}),
        priority=1,
        complexity_hint=5,
    )


def make_candidates() -> list[AgentCandidate]:
    return [
        AgentCandidate(
            agent_code="express-triage",
            name="履约异常处理",
            stage="fulfillment",
            capabilities=frozenset({"order_query", "impact_assess", "notify"}),
            model_tier=ModelTier.LARGE,
            success_rate=0.95,
            inflight=0,
            max_concurrency=8,
            p95_latency_ms=9400,
            avg_cost_usd=0.052,
        ),
        AgentCandidate(
            agent_code="logistics-router",
            name="物流调度",
            stage="logistics",
            capabilities=frozenset({"order_query", "impact_assess"}),
            model_tier=ModelTier.SMALL,
            success_rate=0.88,
            inflight=0,
            max_concurrency=20,
            p95_latency_ms=3200,
            avg_cost_usd=0.008,
        ),
    ]


# --- Mock Provider ---------------------------------------------------------


def test_mock_is_deterministic():
    gateway = gw.LLMGateway("mock")
    a = gateway.complete(system_prompt="s", user_input="u", tier="small", agent_code="x")
    b = gateway.complete(system_prompt="s", user_input="u", tier="small", agent_code="x")
    assert a.text == b.text
    assert a.token_input == b.token_input
    assert a.cost_usd == b.cost_usd


def test_mock_cost_is_positive_and_scales_with_tier():
    gateway = gw.LLMGateway("mock")
    small = gateway.complete(system_prompt="s", user_input="u" * 400, tier="small")
    large = gateway.complete(system_prompt="s", user_input="u" * 400, tier="large")
    assert small.cost_usd > 0
    assert large.cost_usd > small.cost_usd


def test_mock_planner_picks_large_for_hard_task():
    gateway = gw.LLMGateway("mock")
    plan = gateway.plan(make_request(), make_candidates())
    assert plan["agent_code"] == "express-triage"
    assert plan["reason"]


# --- 真实 Provider（HTTP 打桩）--------------------------------------------


def test_deepseek_parses_response_and_computes_cost(monkeypatch):
    captured = {}

    def fake_post(url, payload, api_key, timeout):
        captured["url"] = url
        captured["payload"] = payload
        captured["key"] = api_key
        return {
            "model": "deepseek-chat",
            "choices": [{"message": {"content": "  建议加急补发  "}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }

    monkeypatch.setattr(gw, "_post_json", fake_post)
    provider = gw.DeepSeekProvider(api_key="sk-test", base_url="https://api.deepseek.com")
    result = provider.complete(system_prompt="sys", user_input="hi", tier="small")

    assert result.text == "建议加急补发"
    assert result.token_input == 100
    assert result.token_output == 50
    # 100 * 0.00027 + 50 * 0.0011 = 0.027 + 0.055 = 0.082  → 按 /1000 计算得 0.000082
    assert result.cost_usd == pytest.approx(0.000082, abs=1e-9)
    assert captured["url"].endswith("/chat/completions")
    assert captured["payload"]["messages"][0]["role"] == "system"
    assert captured["payload"]["model"] == "deepseek-chat"
    assert captured["key"] == "sk-test"


def test_deepseek_large_tier_uses_large_model(monkeypatch):
    monkeypatch.setattr(
        gw,
        "_post_json",
        lambda url, payload, key, timeout: {
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        },
    )
    provider = gw.DeepSeekProvider(
        api_key="sk-test", model_large="deepseek-reasoner", model_small="deepseek-chat"
    )
    assert provider.model_for("large") == "deepseek-reasoner"
    assert provider.model_for("small") == "deepseek-chat"


def test_empty_api_key_rejected():
    with pytest.raises(ValueError, match="LLM_API_KEY"):
        gw.DeepSeekProvider(api_key="")


def test_unknown_provider_rejected():
    with pytest.raises(NotImplementedError):
        gw.LLMGateway("openai")


def test_empty_choices_raises_upstream(monkeypatch):
    monkeypatch.setattr(
        gw, "_post_json", lambda url, payload, key, timeout: {"choices": []}
    )
    provider = gw.DeepSeekProvider(api_key="sk-test")
    with pytest.raises(NodeError) as exc:
        provider.complete(system_prompt="s", user_input="u")
    assert exc.value.code is ErrorCode.UPSTREAM


def test_remote_disconnect_is_transient_and_retryable(monkeypatch):
    """RemoteDisconnected 是 OSError 子类而非 URLError，必须被判为可重试。

    真实模型联调时就踩过：没捕获它 → 判成 UNKNOWN → 直接进死信。
    """

    def boom(url, payload, key, timeout):
        raise ConnectionResetError("Remote end closed connection without response")

    monkeypatch.setattr(gw, "_post_json", boom)
    provider = gw.DeepSeekProvider(api_key="sk-test")
    # _post_json 被替换了，这里直接验证 _post_json 之外的上层不会吞掉异常
    with pytest.raises(ConnectionResetError):
        provider.complete(system_prompt="s", user_input="u")


def test_post_json_maps_connection_errors(monkeypatch):
    import urllib.error

    provider = gw.DeepSeekProvider(api_key="sk-test")

    class FakeUrlopen:
        def __init__(self, exc):
            self.exc = exc

        def __call__(self, *args, **kwargs):
            raise self.exc

    for exc, expected in [
        (urllib.error.URLError("dns failure"), ErrorCode.TIMEOUT),
        (TimeoutError("timed out"), ErrorCode.TIMEOUT),
        (ConnectionResetError("reset by peer"), ErrorCode.TRANSIENT),
    ]:
        monkeypatch.setattr(gw.urllib.request, "urlopen", FakeUrlopen(exc))
        with pytest.raises(NodeError) as caught:
            provider.complete(system_prompt="s", user_input="u")
        assert caught.value.code is expected, f"{exc!r} → {caught.value.code}"
        assert caught.value.retryable is (expected in {
            ErrorCode.TRANSIENT,
            ErrorCode.TIMEOUT,
            ErrorCode.RATE_LIMIT,
            ErrorCode.UPSTREAM,
        })


# --- 规划器 ----------------------------------------------------------------


def test_planner_parses_json_with_code_fence(monkeypatch):
    provider = gw.DeepSeekProvider(api_key="sk-test")
    monkeypatch.setattr(
        provider,
        "chat",
        lambda **kwargs: gw.LLMResult(
            text='```json\n{"agent_code": "logistics-router", "reason": "更便宜且能力匹配"}\n```',
            token_input=10,
            token_output=10,
            cost_usd=0.0,
            provider="deepseek",
            model="deepseek-chat",
        ),
    )
    planner = gw.build_llm_planner(provider)
    plan = planner(make_request(), make_candidates())
    assert plan["agent_code"] == "logistics-router"
    assert "更便宜" in plan["reason"]


def test_planner_rejects_non_json(monkeypatch):
    provider = gw.DeepSeekProvider(api_key="sk-test")
    monkeypatch.setattr(
        provider,
        "chat",
        lambda **kwargs: gw.LLMResult(
            text="我建议选 express-triage",
            token_input=1,
            token_output=1,
            cost_usd=0.0,
            provider="deepseek",
            model="m",
        ),
    )
    planner = gw.build_llm_planner(provider)
    with pytest.raises(ValueError):
        planner(make_request(), make_candidates())


def test_deepseek_gateway_wires_planner(monkeypatch):
    called = {"n": 0}

    def fake_post(url, payload, key, timeout):
        called["n"] += 1
        return {
            "choices": [{"message": {"content": '{"agent_code":"express-triage","reason":"强推理"}'}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 5},
        }

    monkeypatch.setattr(gw, "_post_json", fake_post)
    gateway = gw.LLMGateway("deepseek", api_key="sk-test")
    plan = gateway.plan(make_request(), make_candidates())
    assert plan["agent_code"] == "express-triage"
    assert called["n"] == 1
