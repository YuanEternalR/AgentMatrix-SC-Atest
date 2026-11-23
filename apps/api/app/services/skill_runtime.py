"""技能执行入口：按类型分派 + 落执行记录。

HTTP 的纯逻辑（SSRF 防护、Mock、模板）在 ``services/http_skill.py``，
这里只负责：取技能 → 分派 → 计时 → 写 ``skill_runs`` → 抛错交给执行器分类。

设计要点：

1. **默认走 Mock**。规格要求演示阶段全离线，所以 HTTP 技能建出来就是 mock 模式：
   不联网、不要 Key、结果由输入决定。要打真实地址必须显式关掉，并受 SSRF 约束。
2. **失败也留痕**。执行记录表里 ok=False 的行同样是数据——成功率要有分母。
3. **异常继续抛**。执行器靠异常做错误分类与重试，吞掉错误会让重试逻辑失效。
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Skill, SkillRun
from app.services import http_skill
from app.services.errors import BusinessError, ErrorCode, NodeError, TransientError, classify
from app.services.skills import REGISTRY

# 只在输入摘要里保留这些键，避免把整块业务数据写进执行日志
_INPUT_PREVIEW_KEYS = ("order_id", "region", "sku", "supplier_id", "category", "carrier", "text")


@dataclass
class SkillExecution:
    ok: bool
    output: dict[str, Any] = field(default_factory=dict)
    duration_ms: float = 0.0
    mode: str = "builtin"


def preview_input(inputs: dict[str, Any]) -> dict[str, Any]:
    """输入摘要：只留业务主键类字段，超长文本截断。"""
    preview: dict[str, Any] = {}
    for key in _INPUT_PREVIEW_KEYS:
        if key in inputs:
            value = inputs[key]
            preview[key] = value[:80] if isinstance(value, str) else value
    if not preview:
        preview = {k: str(v)[:60] for k, v in list(inputs.items())[:3]}
    return preview


def inject_fault(config: dict[str, Any]) -> None:
    """故障注入：让"重试 / 死信 / 告警"在演示里能被看见。"""
    fault = str(config.get("fault") or "none")
    if fault == "none":
        return
    if fault == "transient":
        raise TransientError("技能故障注入：上游瞬时不可用")
    if fault == "timeout":
        raise NodeError("技能故障注入：调用超时", ErrorCode.TIMEOUT)
    raise BusinessError(f"技能故障注入：业务规则拒绝（{fault}）")


def _dispatch(skill: Skill, config: dict[str, Any], inputs: dict[str, Any]) -> tuple[dict, str]:
    if skill.type == "builtin":
        fn_name = str(config.get("function") or skill.code)
        fn = REGISTRY.get(fn_name)
        if fn is None:
            raise BusinessError(f"未注册的内置函数：{fn_name}")
        return dict(fn(inputs)), "builtin"

    if skill.type == "http":
        inject_fault(config)
        if config.get("mock", True):
            # 模拟网络延迟：让"平均耗时"这个指标在演示里有意义
            delay_ms = min(int(config.get("mock_delay_ms") or 0), 2000)
            if delay_ms:
                time.sleep(delay_ms / 1000)
            return http_skill.mock_response(config, inputs), "http-mock"
        return http_skill.call_http(config, inputs, skill.timeout_sec), "http-real"

    raise BusinessError(f"{skill.type.upper()} 类型技能尚未实现（当前支持 builtin / http）")


def _record(
    db: Session,
    skill: Skill,
    inputs: dict[str, Any],
    *,
    ok: bool,
    duration_ms: float,
    error: str = "",
    error_code: str = "",
    source: str,
) -> None:
    db.add(
        SkillRun(
            skill_id=skill.id,
            skill_code=skill.code,
            ok=ok,
            duration_ms=duration_ms,
            source=source,
            input=preview_input(inputs),
            error=error[:500],
            error_code=error_code,
        )
    )


def execute_skill(
    db: Session,
    code: str,
    inputs: dict[str, Any],
    *,
    source: str = "workflow",
    config_override: dict[str, Any] | None = None,
) -> SkillExecution:
    """执行技能并写一条 ``skill_runs``；失败时记录后原样抛出。

    ``config_override`` 只用于试运行（例如临时切换 Mock），不会写库。
    """
    skill = db.scalars(select(Skill).where(Skill.code == code)).first()
    if skill is None:
        raise KeyError(f"技能不存在：{code}")

    config = dict(config_override if config_override is not None else (skill.config or {}))
    started = time.perf_counter()

    try:
        output, mode = _dispatch(skill, config, inputs)
    except NodeError as exc:
        code_ = exc.code if isinstance(exc.code, ErrorCode) else ErrorCode.UNKNOWN
        _record(
            db,
            skill,
            inputs,
            ok=False,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
            error=str(exc),
            error_code=code_.value,
            source=source,
        )
        raise
    except Exception as exc:  # noqa: BLE001 - 未识别异常也要分类后抛出
        code_ = classify(exc)
        _record(
            db,
            skill,
            inputs,
            ok=False,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
            error=str(exc),
            error_code=code_.value,
            source=source,
        )
        raise NodeError(str(exc), code_) from exc

    duration = round((time.perf_counter() - started) * 1000, 1)
    _record(db, skill, inputs, ok=True, duration_ms=duration, source=source)
    return SkillExecution(ok=True, output=output, duration_ms=duration, mode=mode)


# 兼容旧导入点：guard_url 原先在 skill_runtime 里
guard_url = http_skill.guard_url
