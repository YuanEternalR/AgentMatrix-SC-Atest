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


# --- 履约诊断域（供应链）-----------------------------------------------------


def _region_rows(db, region: str) -> dict[str, Any]:
    """按地区聚合履约指标。地区为空时自动挑延迟最严重的地区。"""
    from sqlalchemy import case, func, select

    from app.models.tables import SupplyOrder

    if not region:
        worst = db.execute(
            select(SupplyOrder.order_region)
            .group_by(SupplyOrder.order_region)
            .order_by(func.avg(SupplyOrder.delay_days).desc())
            .limit(1)
        ).first()
        region = worst[0] if worst else ""

    row = db.execute(
        select(
            func.count().label("orders"),
            func.sum(case((SupplyOrder.delivery_status == "Shipping on time", 1), else_=0)).label("on_time"),
            func.sum(case((SupplyOrder.delivery_status == "Late delivery", 1), else_=0)).label("late"),
            func.sum(case((SupplyOrder.delivery_status == "Advance shipping", 1), else_=0)).label("advance"),
            func.avg(SupplyOrder.delay_days).label("avg_delay"),
            func.sum(SupplyOrder.sales).label("sales"),
        ).where(SupplyOrder.order_region == region)
    ).one()

    orders = int(row.orders or 0)
    late = int(row.late or 0)
    on_time = int(row.on_time or 0)
    return {
        "region": region,
        "orders": orders,
        "on_time": on_time,
        "late": late,
        "advance": int(row.advance or 0),
        "late_rate": round(late / orders, 4) if orders else 0.0,
        "otif_rate": round(on_time / orders, 4) if orders else 0.0,
        "avg_delay_days": round(float(row.avg_delay or 0), 3),
        "sales": round(float(row.sales or 0), 2),
    }


def region_fulfillment_stats(inputs: dict[str, Any]) -> dict[str, Any]:
    """区域履约指标（真实订单数据）。

    不指定地区时自动选延迟最严重的地区——诊断要从最差的地方开始。
    """
    from collections import defaultdict

    from sqlalchemy import case, func, select

    from app.db.session import SessionLocal
    from app.models.tables import SupplyOrder

    region = str(inputs.get("region") or "").strip()
    with SessionLocal() as db:
        stats = _region_rows(db, region)

        # 顺带给出全局地区排名，便于对比"这个地区是不是最差的"
        ranking = db.execute(
            select(
                SupplyOrder.order_region,
                func.count().label("orders"),
                func.sum(case((SupplyOrder.delivery_status == "Late delivery", 1), else_=0)).label("late"),
            )
            .group_by(SupplyOrder.order_region)
            .having(func.count() >= 100)
        ).all()
        table = sorted(
            (
                {
                    "region": r[0],
                    "orders": int(r[1]),
                    "late_rate": round(int(r[2] or 0) / int(r[1]), 4) if r[1] else 0.0,
                }
                for r in ranking
            ),
            key=lambda x: x["late_rate"],
            reverse=True,
        )

    return {
        **stats,
        "region_ranking": table[:6],
        "source": "dataco",
        "note": "延迟口径：实际运输天数 - 承诺天数 > 0",
    }


def segment_breakdown(inputs: dict[str, Any]) -> dict[str, Any]:
    """把某个地区按运输方式与品类拆开，定位最拖后腿的环节。"""
    from sqlalchemy import case, func, select

    from app.db.session import SessionLocal
    from app.models.tables import SupplyOrder

    region = str(inputs.get("region") or "").strip()
    if not region:
        raise BusinessError("缺少 region，无法拆解细分环节")

    with SessionLocal() as db:
        modes = db.execute(
            select(
                SupplyOrder.shipping_mode,
                func.count().label("orders"),
                func.sum(case((SupplyOrder.delivery_status == "Late delivery", 1), else_=0)).label("late"),
                func.avg(SupplyOrder.delay_days).label("avg_delay"),
            )
            .where(SupplyOrder.order_region == region)
            .group_by(SupplyOrder.shipping_mode)
            .order_by(func.avg(SupplyOrder.delay_days).desc())
        ).all()

        categories = db.execute(
            select(
                SupplyOrder.category_name,
                func.count().label("orders"),
                func.avg(SupplyOrder.delay_days).label("avg_delay"),
            )
            .where(SupplyOrder.order_region == region)
            .group_by(SupplyOrder.category_name)
            .having(func.count() >= 50)
            .order_by(func.avg(SupplyOrder.delay_days).desc())
            .limit(5)
        ).all()

    segments = [
        {
            "shipping_mode": m[0],
            "orders": int(m[1]),
            "late": int(m[2] or 0),
            "late_rate": round(int(m[2] or 0) / int(m[1]), 4) if m[1] else 0.0,
            "avg_delay_days": round(float(m[3] or 0), 3),
        }
        for m in modes
    ]
    worst = segments[0] if segments else None
    return {
        "region": region,
        "segments": segments,
        "worst_segment": worst,
        "worst_categories": [
            {
                "category": c[0],
                "orders": int(c[1]),
                "avg_delay_days": round(float(c[2] or 0), 3),
            }
            for c in categories
        ],
        "by_mode_available": len(segments),
    }


def issue_rectification(inputs: dict[str, Any]) -> dict[str, Any]:
    """把诊断结论落成一份整改单（产物）。"""
    region = str(inputs.get("region") or "未知地区")
    diagnosis = str(inputs.get("text") or "")
    # 上游字段可能是平铺的（region_stats 直接输出 orders/late_rate），
    # 也可能被包在 stats 里；两种都接受，避免整改单出现空白的"现状"段。
    if isinstance(inputs.get("stats"), dict):
        stats = inputs["stats"]
    elif "late_rate" in inputs or "orders" in inputs:
        stats = {
            "orders": inputs.get("orders"),
            "late_rate": inputs.get("late_rate"),
            "avg_delay_days": inputs.get("avg_delay_days"),
        }
    else:
        stats = {}
    segments = inputs.get("segments") if isinstance(inputs.get("segments"), list) else []

    digest = hashlib.sha256(f"rectify|{region}|{diagnosis[:60]}".encode("utf-8")).hexdigest()
    lines = [
        f"# 履约整改单 · {region}",
        "",
        "> 由 AgentMatrix-SC 自动生成，数据来源：DataCo 真实订单数据集。",
        "",
        "## 一、现状",
        "",
        f"- 订单量：{stats.get('orders', '—')}",
        f"- 延迟率：{round(float(stats.get('late_rate', 0)) * 100, 2)}%",
        f"- 平均延迟：{stats.get('avg_delay_days', '—')} 天",
        "",
        "## 二、薄弱环节",
        "",
    ]
    for seg in segments[:5]:
        lines.append(
            f"- {seg.get('shipping_mode')}：{seg.get('orders')} 单，"
            f"延迟率 {round(float(seg.get('late_rate', 0)) * 100, 2)}%，"
            f"平均延迟 {seg.get('avg_delay_days')} 天"
        )
    lines += ["", "## 三、整改方案（智能体诊断）", "", diagnosis or "（未生成诊断内容）", ""]
    content = "\n".join(lines)

    return {
        "artifact_id": f"art-{digest[:12]}",
        "name": f"{region}-履约整改单.md",
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
    "region_fulfillment_stats": region_fulfillment_stats,
    "segment_breakdown": segment_breakdown,
    "issue_rectification": issue_rectification,
}


def run_skill(code: str, inputs: dict[str, Any]) -> dict[str, Any]:
    fn = REGISTRY.get(code)
    if fn is None:
        raise KeyError(f"未注册的技能：{code}")
    return fn(inputs)
