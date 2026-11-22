"""验证 LLM 配置是否可用：真实调用一次，打印模型、Token、耗时与成本。

用法（在仓库根目录）：
    python scripts/check_llm.py                # 读 .env 里的配置
    python scripts/check_llm.py --plan         # 额外验证 S4 规划器
    python scripts/check_llm.py --provider mock   # 验证 mock 通路

没有配置 Key 时只做结构检查，不发请求。
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from app.services.dispatch.types import AgentCandidate, DispatchRequest, ModelTier  # noqa: E402
from app.services.llm.gateway import LLMGateway  # noqa: E402


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", default=None, help="mock | deepseek（默认读 .env）")
    parser.add_argument("--plan", action="store_true", help="同时验证 S4 规划器")
    args = parser.parse_args()

    env = load_env(Path(__file__).resolve().parents[1] / ".env")
    provider = args.provider or env.get("LLM_PROVIDER") or "mock"
    api_key = env.get("LLM_API_KEY", "")
    api_base = env.get("LLM_API_BASE", "")
    model_large = env.get("LLM_MODEL_LARGE", "") or "deepseek-chat"
    model_small = env.get("LLM_MODEL_SMALL", "") or "deepseek-chat"

    print(f"provider = {provider}")
    print(f"base_url = {api_base or '(默认)'}")
    print(f"model    = {model_large} / {model_small}")
    print(f"api_key  = {'已配置（长度 %d）' % len(api_key) if api_key else '未配置'}")

    if provider != "mock" and not api_key:
        print("\n没有 API Key，无法真实调用。请在 .env 里填写 LLM_API_KEY。")
        return 2

    try:
        gateway = LLMGateway(
            provider,
            api_key=api_key,
            api_base=api_base,
            model_large=model_large,
            model_small=model_small,
            timeout=float(env.get("LLM_TIMEOUT_SECONDS") or 45),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"\n初始化失败：{exc}")
        return 1

    print("\n--- 智能体调用测试 ---")
    started = time.time()
    try:
        result = gateway.complete(
            system_prompt="你是供应链异常处理专家。用一句话给出处理建议，不超过 40 字。",
            user_input="订单 100 从 Santo Domingo 发出，Second Class 实际 6 天、承诺 2 天，销售额 $549.94。",
            tier="small",
            agent_code="express-triage",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"调用失败：{type(exc).__name__}: {exc}")
        return 1

    elapsed = (time.time() - started) * 1000
    print(f"耗时     {elapsed:.0f} ms")
    print(f"模型     {result.model}（provider={result.provider}）")
    print(f"Token    输入 {result.token_input} / 输出 {result.token_output}")
    print(f"估算成本 ${result.cost_usd:.6f}")
    print(f"输出     {result.text[:300]}")

    if args.plan:
        print("\n--- S4 规划器测试 ---")
        request = DispatchRequest(
            task_id="check-llm",
            task_type="order_delay_exception",
            priority=1,
            complexity_hint=5,
            required_capabilities=frozenset({"order_query", "impact_assess"}),
            sla_ms=None,
            budget_usd=None,
            stage=None,
            tags=frozenset(),
            estimated_steps=5,
        )
        candidates = [
            AgentCandidate(
                agent_code="express-triage",
                name="履约异常处理",
                stage="fulfillment",
                model_tier=ModelTier.LARGE,
                capabilities=frozenset({"order_query", "impact_assess", "notify"}),
                success_rate=0.95,
                avg_cost_usd=0.052,
                p95_latency_ms=9400,
                inflight=0,
                max_concurrency=8,
            ),
            AgentCandidate(
                agent_code="logistics-router",
                name="物流调度",
                stage="logistics",
                model_tier=ModelTier.SMALL,
                capabilities=frozenset({"order_query", "impact_assess"}),
                success_rate=0.88,
                avg_cost_usd=0.008,
                p95_latency_ms=3200,
                inflight=2,
                max_concurrency=20,
            ),
        ]
        started = time.time()
        try:
            plan = gateway.plan(request, candidates)
        except Exception as exc:  # noqa: BLE001
            print(f"规划失败：{type(exc).__name__}: {exc}")
            return 1
        print(f"耗时     {(time.time() - started) * 1000:.0f} ms")
        print(f"选中     {plan.get('agent_code')}")
        print(f"理由     {plan.get('reason')}")
        allowed = {c.agent_code for c in candidates}
        if plan.get("agent_code") not in allowed:
            print(f"⚠️ 规划结果不在候选内：{plan.get('agent_code')}（策略层会回退）")
            return 1

    print("\n配置可用。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
