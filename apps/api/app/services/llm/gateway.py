"""LLM 网关：Mock（离线确定性）与 DeepSeek（真实模型）两个实现。

为什么要两套：

- **Mock**：单元测试与离线演示用，同样输入永远同样输出，跑测试不需要网络和 Key；
- **DeepSeek**：真实推理。当前用它同时承担
  ① 矩阵的**总调控**（S4 规划器：在硬过滤后的候选里选执行者）
  ② 各分工智能体的**具体执行**（agent 节点的分析和结论）。

切换靠环境变量，业务层不感知差别：

    LLM_PROVIDER=deepseek
    LLM_API_KEY=sk-...
    LLM_API_BASE=https://api.deepseek.com     # 兼容 OpenAI 的 /chat/completions
    LLM_MODEL_LARGE=deepseek-chat
    LLM_MODEL_SMALL=deepseek-chat

错误分类沿用平台约定，交给执行器决定是否重试：
429 → RATE_LIMIT、5xx → UPSTREAM、超时 → TIMEOUT、401/403 → PERMISSION。
"""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Sequence

from app.services.dispatch.types import AgentCandidate, DispatchRequest, ModelTier
from app.services.errors import ErrorCode, NodeError

# 妯″瀷妗ｄ綅鍗曚环（缇庡厓 / 1K token锛夛紝鐢ㄤ簬鎴愭湰鏍哥畻
PRICE_PER_1K: dict[str, tuple[float, float]] = {
    # tier: (杈撳叆浠? 杈撳嚭浠?
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
    """确定性规划器替身：模拟大模型在安全集内挑执行者。

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


def _post_json(url: str, payload: dict, api_key: str, timeout: float) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:300]
        if exc.code == 429:
            raise NodeError(f"模型限流：{detail}", ErrorCode.RATE_LIMIT) from exc
        if exc.code in (401, 403):
            raise NodeError(f"模型鉴权失败：{detail}", ErrorCode.PERMISSION) from exc
        if exc.code >= 500:
            raise NodeError(f"模型服务异常 {exc.code}：{detail}", ErrorCode.UPSTREAM) from exc
        raise NodeError(f"模型请求被拒 {exc.code}：{detail}", ErrorCode.VALIDATION) from exc
    except urllib.error.URLError as exc:
        # 超时、DNS 失败、连接拒绝都走这里
        raise NodeError(f"模型连接失败：{exc}", ErrorCode.TIMEOUT) from exc
    except TimeoutError as exc:
        raise NodeError(f"模型调用超时：{exc}", ErrorCode.TIMEOUT) from exc
    except (ConnectionError, OSError) as exc:
        # http.client.RemoteDisconnected / ConnectionResetError 是 OSError 子类，
        # 不属于 URLError；不捕获会被判成 UNKNOWN 而失去重试机会。
        raise NodeError(f"模型连接中断：{type(exc).__name__}: {exc}", ErrorCode.TRANSIENT) from exc


class DeepSeekProvider:
    """DeepSeek（OpenAI 兼容）Provider。

    单价可配置：``LLM_PRICE_INPUT_PER_1K`` / ``LLM_PRICE_OUTPUT_PER_1K``，
    默认值只是量级参考，真实账单请以服务商为准（成本字段是估算值）。
    """

    name = "deepseek"

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.deepseek.com",
        model_large: str = "deepseek-chat",
        model_small: str = "deepseek-chat",
        timeout: float = 45.0,
        price_input_per_1k: float = 0.00027,
        price_output_per_1k: float = 0.0011,
    ) -> None:
        if not api_key:
            raise ValueError("缺少 LLM_API_KEY，无法启用 DeepSeek Provider")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model_large = model_large
        self.model_small = model_small
        self.timeout = timeout
        self.price_input = price_input_per_1k
        self.price_output = price_output_per_1k

    def model_for(self, tier: str) -> str:
        return self.model_large if tier == "large" else self.model_small

    def chat(
        self,
        *,
        system_prompt: str,
        user_input: str,
        tier: str = "small",
        temperature: float = 0.2,
    ) -> LLMResult:
        model = self.model_for(tier)
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_input},
            ],
            "temperature": temperature,
            "stream": False,
        }
        data = _post_json(
            f"{self.base_url}/chat/completions", payload, self.api_key, self.timeout
        )
        choices = data.get("choices") or []
        if not choices:
            raise NodeError("模型返回为空", ErrorCode.UPSTREAM)
        text = (choices[0].get("message") or {}).get("content") or ""

        usage = data.get("usage") or {}
        token_input = int(usage.get("prompt_tokens") or 0)
        token_output = int(usage.get("completion_tokens") or 0)
        cost = (
            token_input * self.price_input + token_output * self.price_output
        ) / 1000

        return LLMResult(
            text=text.strip(),
            token_input=token_input,
            token_output=token_output,
            cost_usd=round(cost, 6),
            provider=self.name,
            model=data.get("model") or model,
        )

    def complete(
        self,
        *,
        system_prompt: str,
        user_input: str,
        tier: str = "small",
        agent_code: str = "",
    ) -> LLMResult:
        return self.chat(system_prompt=system_prompt, user_input=user_input, tier=tier)


PLANNER_SYSTEM = """你是多智能体系统的调度规划器。任务：在给定的候选智能体中，为当前任务选出最合适的执行者。

规则：
1. 只能从候选列表里选，不得编造不在列表中的编码；
2. 优先看能力匹配，再看成功率与成本；
3. 输出必须是严格 JSON，不要任何解释性文字。

输出格式：{"agent_code": "<候选编码>", "reason": "<一句不超过 40 字的中文理由>"}"""


def _candidate_lines(candidates: Sequence[AgentCandidate]) -> str:
    lines = []
    for c in candidates:
        lines.append(
            f"- {c.agent_code}（{c.name}，阶段 {c.stage}，档位 {c.model_tier.value}，"
            f"成功率 {c.success_rate:.2f}，均价 ${c.avg_cost_usd:.4f}，"
            f"P95 {c.p95_latency_ms:.0f}ms，能力 {','.join(sorted(c.capabilities)) or '无'}）"
        )
    return "\n".join(lines)


def build_llm_planner(provider: Any, temperature: float = 0.0):
    """用真实模型构造 PlannerFn；输出仍由策略层校验，越界即回退。"""

    def planner(request: DispatchRequest, candidates: Sequence[AgentCandidate]) -> dict[str, str]:
        user_input = (
            f"任务类型：{request.task_type}\n"
            f"优先级：{request.priority}（1 最高）\n"
            f"复杂度：{request.complexity_hint}（1-5）\n"
            f"所需能力：{','.join(sorted(request.required_capabilities)) or '无'}\n"
            f"候选智能体：\n{_candidate_lines(candidates)}\n\n"
            "请选出最合适的一个，输出 JSON。"
        )
        result = provider.chat(
            system_prompt=PLANNER_SYSTEM,
            user_input=user_input,
            tier="large",
            temperature=temperature,
        )
        text = result.text.strip()
        # 容忍模型把 JSON 包在 ``` 里或前后带话
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError(f"规划输出不是 JSON：{text[:120]}")
        payload = json.loads(text[start : end + 1])
        return {
            "agent_code": str(payload.get("agent_code", "")),
            "reason": str(payload.get("reason", ""))[:200],
        }

    return planner


class LLMGateway:
    """统一入口：按配置装配 Provider，业务层只看 complete() / plan()。"""

    def __init__(
        self,
        provider: str = "mock",
        *,
        api_key: str = "",
        api_base: str = "",
        model_large: str = "",
        model_small: str = "",
        timeout: float = 45.0,
    ) -> None:
        self.provider = provider
        if provider == "mock":
            self._provider = MockProvider()
            self._planner = None
            return

        if provider == "deepseek":
            self._provider = DeepSeekProvider(
                api_key=api_key,
                base_url=api_base or "https://api.deepseek.com",
                model_large=model_large or "deepseek-chat",
                model_small=model_small or "deepseek-chat",
                timeout=timeout,
            )
            self._planner = build_llm_planner(self._provider)
            return

        raise NotImplementedError(
            f"Provider {provider!r} 尚未接入；支持 mock / deepseek。"
        )

    def plan(self, request: DispatchRequest, candidates: Sequence[AgentCandidate]) -> dict[str, str]:
        if self._planner is None:
            return mock_planner(request, candidates)
        return self._planner(request, candidates)

    def complete(
        self,
        *,
        system_prompt: str,
        user_input: str,
        tier: str = "small",
        agent_code: str = "",
    ) -> LLMResult:
        return self._provider.complete(
            system_prompt=system_prompt,
            user_input=user_input,
            tier=tier,
            agent_code=agent_code,
        )
