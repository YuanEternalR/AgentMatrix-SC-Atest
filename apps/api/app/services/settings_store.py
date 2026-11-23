"""运行时配置的读写（目前只有调度策略）。

三件事必须做对，否则"策略可配置"就是个摆设：

1. **校验在写入前**。权重全负、策略名拼错、SLA 余量 > 1 都要在保存时拒绝，
   不能等到下一次调度才发现线上跑不起来。
2. **默认值来自环境变量**。没在界面上改过时，行为与部署配置完全一致；
   改过之后以库里的为准，并在响应里说明来源（`source: env | db`）。
3. **改完即时生效**。Worker 每次调度都读一次（一个主键查询，代价可忽略），
   不需要重启容器。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import SystemSetting, User
from app.services.dispatch.registry import DEFAULT_STRATEGY, all_names
from app.services.errors import BusinessError

DISPATCH_KEY = "dispatch"

# 六个因子的中文名与含义：界面上的滑块直接用它渲染，避免前端硬编码文案
WEIGHT_FACTORS: tuple[tuple[str, str, str], ...] = (
    ("capability", "能力匹配", "任务所需能力与智能体能力标签的覆盖率，权重最高——派错人后面全白搭"),
    ("success", "历史成功率", "该智能体过往运行的成功比例，反映稳定性"),
    ("load", "当前负载", "空闲度 = 1 − 在跑数/并发上限，避免把活压给最忙的"),
    ("cost", "成本效率", "单步均价越低分越高（在候选集内做反向归一）"),
    ("latency", "时延", "P95 越低分越高，用于有响应要求的任务"),
    ("affinity", "优先级亲和", "高优先级任务偏向强模型，低优先级偏向便宜模型"),
)


def env_defaults() -> dict[str, Any]:
    """环境变量给出的默认策略配置。"""
    from app.services.dispatch.strategies import ScoreWeights

    weights = ScoreWeights()
    return {
        "strategy": settings.dispatch_strategy or DEFAULT_STRATEGY,
        "weights": weights.as_dict(),
        "sla_headroom": float(settings.dispatch_sla_headroom),
        "min_success_rate": float(settings.dispatch_min_success_rate),
    }


def _clean_weights(raw: dict[str, Any], *, base: dict[str, float]) -> dict[str, float]:
    merged = dict(base)
    for code, _, _ in WEIGHT_FACTORS:
        if code in raw:
            try:
                merged[code] = float(raw[code])
            except (TypeError, ValueError) as exc:
                raise BusinessError(f"权重 {code} 必须是数字") from exc
    unknown = set(raw) - {code for code, _, _ in WEIGHT_FACTORS}
    if unknown:
        raise BusinessError(f"未知权重字段：{', '.join(sorted(unknown))}")
    if any(value < 0 for value in merged.values()):
        raise BusinessError("权重不能为负")
    if sum(merged.values()) <= 0:
        raise BusinessError("至少要有一个权重大于 0")
    return {key: round(value, 4) for key, value in merged.items()}


def validate(config: dict[str, Any], *, base: dict[str, Any]) -> dict[str, Any]:
    """校验并规整一份配置；不合法直接抛 BusinessError（路由转 422）。"""
    strategy = str(config.get("strategy") or base["strategy"])
    if strategy not in all_names():
        raise BusinessError(f"未知策略 {strategy}，可用：{', '.join(all_names())}")

    weights = _clean_weights(config.get("weights") or {}, base=base["weights"])

    try:
        sla_headroom = float(config.get("sla_headroom", base["sla_headroom"]))
        min_success_rate = float(config.get("min_success_rate", base["min_success_rate"]))
    except (TypeError, ValueError) as exc:
        raise BusinessError("sla_headroom / min_success_rate 必须是数字") from exc

    if not 0 < sla_headroom <= 1:
        raise BusinessError("SLA 余量必须在 (0, 1] 之间")
    if not 0 <= min_success_rate <= 1:
        raise BusinessError("质量下限必须在 [0, 1] 之间")

    return {
        "strategy": strategy,
        "weights": weights,
        "sla_headroom": round(sla_headroom, 3),
        "min_success_rate": round(min_success_rate, 3),
    }


def load_dispatch_config(db: Session | None = None) -> dict[str, Any]:
    """读当前生效配置：库里有就用库里的，否则用环境变量。"""
    defaults = env_defaults()
    if db is None:
        return {**defaults, "source": "env"}

    row = db.get(SystemSetting, DISPATCH_KEY)
    if row is None or not row.value:
        return {**defaults, "source": "env"}

    stored = dict(row.value)
    # 库里只存改过的字段也成立：与默认值合并后再返回
    merged = {
        "strategy": stored.get("strategy", defaults["strategy"]),
        "weights": {**defaults["weights"], **(stored.get("weights") or {})},
        "sla_headroom": stored.get("sla_headroom", defaults["sla_headroom"]),
        "min_success_rate": stored.get("min_success_rate", defaults["min_success_rate"]),
    }
    return {**merged, "source": "db"}


def save_dispatch_config(
    db: Session, config: dict[str, Any], user: User | None = None
) -> dict[str, Any]:
    """校验后落库。返回保存后的完整配置。"""
    current = load_dispatch_config(db)
    cleaned = validate(config, base=env_defaults())

    row = db.get(SystemSetting, DISPATCH_KEY)
    if row is None:
        row = SystemSetting(key=DISPATCH_KEY, value=cleaned, updated_by=user.id if user else None)
        db.add(row)
    else:
        row.value = cleaned
        row.updated_by = user.id if user else None
        from datetime import datetime, timezone

        row.updated_at = datetime.now(timezone.utc)

    return {**cleaned, "source": "db", "previous": current}
