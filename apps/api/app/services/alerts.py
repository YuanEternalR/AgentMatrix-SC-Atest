"""告警评估。

规则形状固定为「指标 + 比较符 + 阈值」，这样规则可配置、可解释，也不需要
在数据库里存表达式或执行任意代码。

评估由 Worker 周期触发：条件成立且没有未关闭事件时创建事件；条件恢复后自动
关闭已有事件（避免人工逐个确认淹没有效信息）。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AlertEvent, AlertRule, DeadLetter
from app.services.metrics import compute_metrics

logger = logging.getLogger("agentmatrix.alerts")


def _metric_values(db: Session) -> dict[str, float]:
    snapshot = compute_metrics(db, hours=24)
    totals = snapshot["totals"]
    dead = db.scalar(
        select(func.count()).select_from(DeadLetter).where(DeadLetter.status == "pending")
    ) or 0

    return {
        "success_rate": float(totals["success_rate"]),
        "failed_runs": float(totals["failed"]),
        "running_runs": float(totals["running"]),
        "waiting_approval": float(totals["waiting_approval"]),
        "p95_active_ms": float(totals["p95_active_ms"]),
        "p95_ms": float(totals["p95_ms"]),
        "cost_usd": float(totals["cost_usd"]),
        "dead_letters": float(dead),
    }


METRIC_LABELS: dict[str, str] = {
    "success_rate": "成功率",
    "failed_runs": "失败运行数",
    "running_runs": "进行中运行数",
    "waiting_approval": "待审批数",
    "p95_active_ms": "P95 执行耗时(ms)",
    "p95_ms": "P95 端到端耗时(ms)",
    "cost_usd": "累计成本($)",
    "dead_letters": "待处理死信数",
}

OPERATORS = {">", ">=", "<", "<=", "=="}


def _compare(value: float, operator: str, threshold: float) -> bool:
    if operator == ">":
        return value > threshold
    if operator == ">=":
        return value >= threshold
    if operator == "<":
        return value < threshold
    if operator == "<=":
        return value <= threshold
    if operator == "==":
        return abs(value - threshold) < 1e-9
    raise ValueError(f"不支持的比较符：{operator}")


def _format(value: float, metric: str) -> str:
    if metric == "success_rate":
        return f"{value:.1%}"
    if metric.endswith("_ms"):
        return f"{value:.0f}ms"
    if metric == "cost_usd":
        return f"${value:.4f}"
    return f"{value:.0f}"


def evaluate_rules(db: Session) -> list[dict]:
    """评估所有启用规则，返回本次的触发与恢复动作。"""
    rules = db.scalars(select(AlertRule).where(AlertRule.enabled.is_(True))).all()
    if not rules:
        return []

    values = _metric_values(db)
    actions: list[dict] = []
    now = datetime.now(timezone.utc)

    for rule in rules:
        value = values.get(rule.metric)
        if value is None:
            logger.warning("规则 %s 引用了未知指标 %s", rule.id, rule.metric)
            continue

        firing = _compare(value, rule.operator, rule.threshold)
        open_event = db.scalars(
            select(AlertEvent).where(
                AlertEvent.rule_id == rule.id, AlertEvent.status.in_(("open", "acknowledged"))
            )
        ).first()

        if firing and open_event is None:
            label = METRIC_LABELS.get(rule.metric, rule.metric)
            message = (
                f"{rule.name}：{label} 当前 {_format(value, rule.metric)} "
                f"{rule.operator} 阈值 {_format(rule.threshold, rule.metric)}"
            )
            db.add(
                AlertEvent(
                    rule_id=rule.id,
                    status="open",
                    severity=rule.severity,
                    value=value,
                    threshold=rule.threshold,
                    message=message,
                )
            )
            actions.append({"rule": rule.name, "action": "triggered", "value": value})
        elif not firing and open_event is not None:
            open_event.status = "resolved"
            open_event.resolved_at = now
            actions.append({"rule": rule.name, "action": "resolved", "value": value})

    if actions:
        db.commit()
        for action in actions:
            logger.info("告警%s：%s（当前值 %.4f）", action["action"], action["rule"], action["value"])

    return actions


DEFAULT_RULES = [
    {
        "name": "成功率过低",
        "metric": "success_rate",
        "operator": "<",
        "threshold": 0.8,
        "severity": "critical",
        "description": "24 小时内成功率低于 80% 时告警",
    },
    {
        "name": "死信积压",
        "metric": "dead_letters",
        "operator": ">",
        "threshold": 0,
        "severity": "critical",
        "description": "只要有待处理死信就告警，需人工介入",
    },
    {
        "name": "审批积压",
        "metric": "waiting_approval",
        "operator": ">",
        "threshold": 5,
        "severity": "warning",
        "description": "待审批运行超过 5 条，审批人可能不足",
    },
    {
        "name": "执行耗时劣化",
        "metric": "p95_active_ms",
        "operator": ">",
        "threshold": 5000,
        "severity": "warning",
        "description": "P95 执行耗时超过 5 秒，检查上游模型或技能",
    },
]
