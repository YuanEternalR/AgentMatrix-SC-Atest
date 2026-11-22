"""技能注册表（MVP：内置函数 + 确定性 Mock 实现）。

真实技能（HTTP / SQL / MCP）接入时保持同样的 ``run(inputs, ctx) -> dict`` 契约。
所有实现都必须确定性，保证演示可复现。
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable

from app.services.errors import BusinessError, TransientError

SkillFn = Callable[[dict[str, Any]], dict[str, Any]]


def _stable_delay_hours(order_id: str) -> float:
    """仅用于未接入真实数据的技能（inventory / supplier）的确定性占位。"""
    digest = hashlib.sha256(order_id.encode("utf-8")).hexdigest()
    return round(2 + int(digest[:2], 16) % 70 / 10, 1)


def order_status_query(inputs: dict[str, Any]) -> dict[str, Any]:
    """按订单号查询真实履约数据（DataCo 数据集，65,752 单）。

    不再用哈希编造延迟——查不到就明确返回 ``found: false``，并给一个真实样本
    订单号做对照，避免"编一个数字糊弄过去"。
    """
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.tables import SupplyOrder

    order_id = str(inputs.get("order_id") or "").strip()
    if not order_id:
        raise BusinessError("缺少 order_id，无法查询订单")

    with SessionLocal() as db:
        order = db.get(SupplyOrder, order_id)
        if order is None:
            sample = db.scalars(
                select(SupplyOrder)
                .where(SupplyOrder.delay_days > 0)
                .order_by(SupplyOrder.order_id)
                .limit(1)
            ).first()
            return {
                "order_id": order_id,
                "found": False,
                "status": "not_found",
                "delay_hours": 0.0,
                "reason": "该订单号不在真实数据集中",
                "sample_order_id": sample.order_id if sample else None,
                "source": "dataco",
            }

        delay_days = order.delay_days or 0
        return {
            "order_id": order.order_id,
            "found": True,
            "status": order.delivery_status.lower().replace(" ", "_") or "unknown",
            "delivery_status": order.delivery_status,
            "delay_days": delay_days,
            "delay_hours": round(delay_days * 24.0, 1),
            "days_real": order.days_real,
            "days_scheduled": order.days_scheduled,
            "late_risk": order.late_risk,
            "destination": order.order_city or order.order_region,
            "region": order.order_region,
            "country": order.order_country,
            "market": order.market,
            "shipping_mode": order.shipping_mode,
            "category": order.category_name,
            "department": order.department_name,
            "quantity": order.quantity,
            "sales": order.sales,
            "ordered_at": order.order_date.isoformat() if order.order_date else None,
            "source": "dataco",
        }


def customer_impact_assess(inputs: dict[str, Any]) -> dict[str, Any]:
    """把订单延误换算成影响分。

    真实数据（DataCo）的延误单位是**天**，所以用天做量纲：1 天延误 ≈ 1 分，
    每 100 件数量加 1 分，上限 5 分。金额优先用真实订单的销售额。
    """
    delay_days = float(inputs.get("delay_days") or 0)
    if not delay_days and inputs.get("delay_hours"):
        delay_days = float(inputs["delay_hours"]) / 24.0
    quantity = int(inputs.get("quantity", 0) or 0)
    sales = float(inputs.get("sales") or 0)
    score = min(5.0, round(abs(delay_days) + quantity / 100, 2))
    return {
        "impact_score": score,
        "delay_days": round(delay_days, 2),
        "affected_orders": 1,
        "risk_level": "high" if score >= 3 else ("medium" if score >= 1.5 else "low"),
        "revenue_at_risk": round(sales or quantity * 12.5, 2),
    }


def notify_customer(inputs: dict[str, Any]) -> dict[str, Any]:
    order_id = str(inputs.get("order_id") or "SO-UNKNOWN")
    attempt = int(inputs.get("_attempt") or 1)

    # 故障注入（仅演示用）：订单号里带 FLAKY / DEAD 标记即可触发
    #   FLAKY  前两次失败、第三次成功          -> 演示"自动重试后恢复"
    #   DEAD   前三次失败、第四次成功          -> 演示"自动重试耗尽进死信，人工重试后恢复"
    marker = order_id.upper()
    if "DEAD" in marker and attempt <= 3:
        raise TransientError(f"通知网关持续不可用（第 {attempt} 次尝试）")
    if "FLAKY" in marker and attempt <= 2:
        raise TransientError(f"通知网关瞬时抖动（第 {attempt} 次尝试失败）")

    return {
        "order_id": order_id,
        "channel": inputs.get("channel", "sms"),
        "template": "delay_apology_v2",
        "sent": True,
        "attempts_used": attempt,
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


# --- 科研域 -----------------------------------------------------------------


def literature_search(inputs: dict[str, Any]) -> dict[str, Any]:
    """真实文献检索（OpenAlex 主，Crossref 兜底）。

    返回的 ``relevance`` 由关键词命中率与被引数算出，可解释、可复现。
    """
    from app.services.literature import search_literature

    topic = str(inputs.get("topic") or "").strip()
    if not topic:
        raise BusinessError("缺少 topic，无法检索文献")
    limit = int(inputs.get("limit") or 8)

    result = search_literature(topic, limit=limit)
    return {
        "topic": result["topic"],
        "query_used": result.get("query_used", topic),
        "expanded_terms": result.get("expanded_terms", []),
        "count": result["count"],
        "provider": result["provider"],
        "papers": result["papers"],
    }


def relevance_screen(inputs: dict[str, Any]) -> dict[str, Any]:
    papers = inputs.get("papers") if isinstance(inputs.get("papers"), list) else []
    threshold = float(inputs.get("threshold", 0.55) or 0.55)

    selected = [p for p in papers if float(p.get("relevance", 0)) >= threshold]
    selected.sort(key=lambda p: float(p.get("relevance", 0)), reverse=True)

    return {
        "threshold": threshold,
        "selected_count": len(selected),
        "selected": selected,
        "dropped_count": len(papers) - len(selected),
    }


def save_report(inputs: dict[str, Any]) -> dict[str, Any]:
    topic = str(inputs.get("topic") or "未命名主题")
    text = str(inputs.get("text") or "")
    digest = hashlib.sha256(f"report|{topic}|{text[:40]}".encode("utf-8")).hexdigest()

    selected = inputs.get("selected") if isinstance(inputs.get("selected"), list) else []
    lines = [f"# {topic} · 综述草稿", "", "> 由 AgentMatrix-SC 自动生成（Mock 模式，内容仅作流程演示）。", ""]

    if selected:
        lines += ["## 参考文献", ""]
        for index, paper in enumerate(selected[:8], start=1):
            lines.append(
                f"{index}. {paper.get('title', '未命名')} — *{paper.get('venue', '')}*, "
                f"{paper.get('year', '')}（相关性 {paper.get('relevance', 0):.2f}）"
            )
        lines.append("")

    lines += ["## 正文要点", "", text or "（正文由撰写智能体生成）", ""]
    content = "\n".join(lines)

    return {
        "artifact_id": f"art-{digest[:12]}",
        "name": f"{topic}-综述草稿.md",
        "mime": "text/markdown",
        "size": len(content.encode("utf-8")),
        "uri": f"artifacts/{digest[:12]}.md",
        "content": content,
        "saved": True,
    }


REGISTRY: dict[str, SkillFn] = {
    "order_status_query": order_status_query,
    "customer_impact_assess": customer_impact_assess,
    "notify_customer": notify_customer,
    "inventory_query": inventory_query,
    "supplier_score": supplier_score,
    "literature_search": literature_search,
    "relevance_screen": relevance_screen,
    "save_report": save_report,
}


def run_skill(code: str, inputs: dict[str, Any]) -> dict[str, Any]:
    fn = REGISTRY.get(code)
    if fn is None:
        raise KeyError(f"未注册的技能：{code}")
    return fn(inputs)
