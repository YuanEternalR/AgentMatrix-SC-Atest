"""LLM 网关。

当前只实现 Mock Provider：完全离线、确定性输出，保证演示可复现。
真实 Provider（OpenAI 兼容 / DeepSeek / Qwen）通过 ``LLM_PROVIDER`` 切换，
接口保持一致，业务层不感知差别。

注意：本模块顶层不导入 ``app.core.config``，以免离线单测被迫安装 pydantic-settings。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Sequence

from app.services.dispatch.types import AgentCandidate, DispatchRequest, ModelTier

# 模型档位单价（美元 / 1K token），用于成本核算
PRICE_PER_1K: dict[str, tuple[float, float]] = {
    # tier: (输入价, 输出价)
    "large": (0.0025, 0.0100),
    "small": (0.0002, 0.0006),
    "tool": (0.0, 0.0),
}


@dataclass(frozen=True, slots=True)
class LLMResult:
    text: str
    token_input: int
    token_output: int
    cost_usd: float
    provider: str
    model: str


def mock_planner(
    request: DispatchRequest,
    candidates: Sequence[AgentCandidate],
) -> dict[str, str]:
    """确定性规划器替身：模拟"大模型在安全集内挑执行者"。

    真实实现调用 LLM 并返回同样的 ``{"agent_code", "reason"}`` 结构；
    规则层不信任其输出，仍会校验候选是否在可行集内。
    """
    if not candidates:
        return {"agent_code": "", "reason": "无候选"}

    hard = request.complexity_hint >= 4 or request.priority <= 2
    if hard:
        large = [c for c in candidates if c.model_tier is ModelTier.LARGE]
        pool = large or list(candidates)
        pick = max(pool, key=lambda c: (c.success_rate, -c.avg_cost_usd))
        return {
            "agent_code": pick.agent_code,
            "reason": f"复杂度 {request.complexity_hint}/5 或高优先级，需要强推理能力",
        }

    reliable = [c for c in candidates if c.success_rate >= 0.8]
    pool = reliable or list(candidates)
    pick = min(pool, key=lambda c: (c.avg_cost_usd, -c.success_rate))
    return {
        "agent_code": pick.agent_code,
        "reason": f"复杂度 {request.complexity_hint}/5 且成功率阈值已满足，优先降本",
    }


class MockProvider:
    """离线确定性 Provider。同样输入永远得到同样输出。"""

    name = "mock"

    def complete(
        self,
        *,
        system_prompt: str,
        user_input: str,
        tier: str = "small",
        agent_code: str = "",
    ) -> LLMResult:
        seed = hashlib.sha256(
            f"{agent_code}|{tier}|{system_prompt}|{user_input}".encode("utf-8")
        ).hexdigest()
        token_input = max(1, len(system_prompt + user_input) // 4)
        token_output = 120 + int(seed[:2], 16) % 180

        price_in, price_out = PRICE_PER_1K.get(tier, PRICE_PER_1K["small"])
        cost = (token_input * price_in + token_output * price_out) / 1000

        return LLMResult(
            text=(
                f"[mock:{tier}] 已完成对 {agent_code or '未指定智能体'} 的分析。"
                f"结论置信度 {0.6 + int(seed[2:4], 16) % 35 / 100:.2f}，"
                f"建议按既定 SOP 执行并回传结果。"
            ),
            token_input=token_input,
            token_output=token_output,
            cost_usd=round(cost, 6),
            provider=self.name,
            model=f"mock-{tier}",
        )


class LLMGateway:
    """统一入口；真实 Provider 就位后在此分派。"""

    def __init__(self, provider: str = "mock") -> None:
        self.provider = provider
        if provider != "mock":
            # 明确失败而非静默降级，避免"以为接了真实模型其实是 mock"
            raise NotImplementedError(
                f"Provider {provider!r} 尚未接入；当前仅支持 mock。"
                "接入时请在此实现 OpenAI 兼容调用，并保留超时/重试/降级。"
            )
        self._mock = MockProvider()

    def plan(self, request: DispatchRequest, candidates: Sequence[AgentCandidate]) -> dict[str, str]:
        return mock_planner(request, candidates)

    def complete(
        self,
        *,
        system_prompt: str,
        user_input: str,
        tier: str = "small",
        agent_code: str = "",
    ) -> LLMResult:
        return self._mock.complete(
            system_prompt=system_prompt,
            user_input=user_input,
            tier=tier,
            agent_code=agent_code,
        )
