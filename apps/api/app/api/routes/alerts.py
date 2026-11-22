"""告警规则与事件。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AlertEvent, AlertRule, User
from app.services.alerts import METRIC_LABELS, OPERATORS, evaluate_rules

router = APIRouter(tags=["alerts"])


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    metric: str = Field(min_length=1, max_length=32)
    operator: str = Field(default=">", max_length=4)
    threshold: float = 0.0
    severity: str = Field(default="warning", pattern="^(info|warning|critical)$")
    description: str = Field(default="", max_length=500)


class RulePatch(BaseModel):
    enabled: bool | None = None
    threshold: float | None = None
    severity: str | None = Field(default=None, pattern="^(info|warning|critical)$")


def _rule_dict(rule: AlertRule) -> dict:
    return {
        "id": rule.id,
        "name": rule.name,
        "metric": rule.metric,
        "metric_label": METRIC_LABELS.get(rule.metric, rule.metric),
        "operator": rule.operator,
        "threshold": rule.threshold,
        "severity": rule.severity,
        "channel": rule.channel,
        "enabled": rule.enabled,
        "description": rule.description,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


def _event_dict(event: AlertEvent, rule: AlertRule | None) -> dict:
    return {
        "id": event.id,
        "rule_id": event.rule_id,
        "rule_name": rule.name if rule else None,
        "status": event.status,
        "severity": event.severity,
        "value": event.value,
        "threshold": event.threshold,
        "message": event.message,
        "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
        "acknowledged_at": event.acknowledged_at.isoformat() if event.acknowledged_at else None,
        "resolved_at": event.resolved_at.isoformat() if event.resolved_at else None,
    }


@router.get("/alert-rules")
def list_rules(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    rules = db.scalars(select(AlertRule).order_by(AlertRule.created_at)).all()
    return [_rule_dict(r) for r in rules]


@router.post("/alert-rules", status_code=status.HTTP_201_CREATED)
def create_rule(
    body: RuleIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
) -> dict:
    if body.metric not in METRIC_LABELS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"未知指标 {body.metric}，可用：{', '.join(METRIC_LABELS)}",
        )
    if body.operator not in OPERATORS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"未知比较符 {body.operator}，可用：{', '.join(sorted(OPERATORS))}",
        )

    rule = AlertRule(
        name=body.name,
        metric=body.metric,
        operator=body.operator,
        threshold=body.threshold,
        severity=body.severity,
        description=body.description,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule)


@router.patch("/alert-rules/{rule_id}")
def patch_rule(
    rule_id: str,
    body: RulePatch,
    db: Session = Depends(get_db),
    # 运营可以临时关掉噪声规则；改阈值/级别仍限开发者
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    rule = db.get(AlertRule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "规则不存在")

    if body.enabled is not None:
        rule.enabled = body.enabled
    if body.threshold is not None or body.severity is not None:
        if user.role not in {"admin", "developer"}:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "修改阈值或级别需要开发者权限"
            )
        if body.threshold is not None:
            rule.threshold = body.threshold
        if body.severity is not None:
            rule.severity = body.severity

    db.commit()
    db.refresh(rule)
    return _rule_dict(rule)


@router.delete("/alert-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
) -> None:
    rule = db.get(AlertRule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "规则不存在")
    db.delete(rule)
    db.commit()


@router.post("/alert-rules/evaluate")
def trigger_evaluation(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    """手动触发一次评估，方便演示与排查（正常由 Worker 每 30 秒执行）。"""
    actions = evaluate_rules(db)
    return {"actions": actions, "count": len(actions)}


@router.get("/alert-events")
def list_events(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    only_open: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    stmt = select(AlertEvent).order_by(AlertEvent.triggered_at.desc()).limit(limit)
    if only_open:
        stmt = stmt.where(AlertEvent.status.in_(("open", "acknowledged")))

    events = db.scalars(stmt).all()
    rules = {r.id: r for r in db.scalars(select(AlertRule)).all()}
    return [_event_dict(e, rules.get(e.rule_id)) for e in events]


@router.post("/alert-events/{event_id}/ack")
def acknowledge(
    event_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    event = db.get(AlertEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "告警事件不存在")
    if event.status == "resolved":
        raise HTTPException(status.HTTP_409_CONFLICT, "事件已恢复")

    event.status = "acknowledged"
    event.acknowledged_by = user.id
    event.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(event)
    return _event_dict(event, db.get(AlertRule, event.rule_id))


@router.post("/alert-events/{event_id}/resolve")
def resolve(
    event_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    event = db.get(AlertEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "告警事件不存在")

    event.status = "resolved"
    event.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(event)
    return _event_dict(event, db.get(AlertRule, event.rule_id))
