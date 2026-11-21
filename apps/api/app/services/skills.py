"""技能注册表（MVP：内置函数 + 确定性 Mock 实现）。

真实技能（HTTP / SQL / MCP）接入时保持同样的 ``run(inputs, ctx) -> dict`` 契约。
所有实现都必须确定性，保证演示可复现。
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable

SkillFn = Callable[[dict[str, Any]], dict[str, Any]]


def _stable_delay_hours(order_id: str) -> float:
    digest = hashlib.sha256(order_id.encode("utf-8")).hexdigest()
    return round(2 + int(digest[:2], 16) % 70 / 10, 1)


def order_status_query(inputs: dict[str, Any]) -> dict[str, Any]:
    order_id = str(inputs.get("order_id") or "SO-UNKNOWN")
    delay = _stable_delay_hours(order_id)
    return {
        "order_id": order_id,
        "carrier": "SF-Express",
        "status": "delayed" if delay > 4 else "in_transit",
        "delay_hours": delay,
        "destination": inputs.get("destination", "上海中心仓"),
        "sku": inputs.get("sku", "SKU-10021"),
        "quantity": int(inputs.get("quantity", 120)),
    }


def customer_impact_assess(inputs: dict[str, Any]) -> dict[str, Any]:
    delay = float(inputs.get("delay_hours", 0) or 0)
    quantity = int(inputs.get("quantity", 0) or 0)
    score = min(5.0, round(delay / 3 + quantity / 100, 2))
    return {
        "impact_score": score,
        "affected_orders": 1,
        "risk_level": "high" if score >= 3 else ("medium" if score >= 1.5 else "low"),
        "revenue_at_risk_usd": round(quantity * 12.5, 2),
    }


def notify_customer(inputs: dict[str, Any]) -> dict[str, Any]:
    order_id = str(inputs.get("order_id") or "SO-UNKNOWN")
    return {
        "order_id": order_id,
        "channel": inputs.get("channel", "sms"),
        "template": "delay_apology_v2",
        "sent": True,
        "message_id": hashlib.sha256(f"notify|{order_id}".encode()).hexdigest()[:16],
    }


def inventory_query(inputs: dict[str, Any]) -> dict[str, Any]:
    sku = str(inputs.get("sku") or "SKU-UNKNOWN")
    digest = hashlib.sha256(sku.encode()).hexdigest()
    on_hand = int(digest[:3], 16) % 900 + 50
    in_transit = int(digest[3:6], 16) % 300
    return {
        "sku": sku,
        "on_hand": on_hand,
        "in_transit": in_transit,
        "available": on_hand + in_transit,
        "safety_stock": 120,
    }


def supplier_score(inputs: dict[str, Any]) -> dict[str, Any]:
    supplier_id = str(inputs.get("supplier_id") or "SUP-UNKNOWN")
    digest = hashlib.sha256(supplier_id.encode()).hexdigest()
    return {
        "supplier_id": supplier_id,
        "delivery_score": round(60 + int(digest[:2], 16) % 40, 1),
        "quality_score": round(60 + int(digest[2:4], 16) % 40, 1),
        "risk_flags": [] if int(digest[4:6], 16) % 3 else ["交付波动"],
    }


REGISTRY: dict[str, SkillFn] = {
    "order_status_query": order_status_query,
    "customer_impact_assess": customer_impact_assess,
    "notify_customer": notify_customer,
    "inventory_query": inventory_query,
    "supplier_score": supplier_score,
}


def run_skill(code: str, inputs: dict[str, Any]) -> dict[str, Any]:
    fn = REGISTRY.get(code)
    if fn is None:
        raise KeyError(f"未注册的技能：{code}")
    return fn(inputs)
