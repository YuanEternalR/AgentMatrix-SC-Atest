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


# --- 补货与承运商风险（演示场景二、三）------------------------------------


def _order_max_day(db):
    from sqlalchemy import func, select

    from app.models.tables import SupplyOrder

    return db.scalar(select(func.max(SupplyOrder.order_date)))


def demand_forecast(inputs: dict[str, Any]) -> dict[str, Any]:
    """按品类做需求预测：取真实订单最近 N 天的日销量，用移动平均外推。

    数据是 DataCo 的 2015–2018 订单，所以时间轴以**数据里的最后一天**为基准，
    而不是今天——否则会落到空区间。这一点在返回里写清楚。
    """
    from datetime import timedelta

    from sqlalchemy import func, select

    from app.db.session import SessionLocal
    from app.models.tables import SupplyOrder

    category = str(inputs.get("category") or "").strip()
    horizon = int(inputs.get("horizon_days") or 7)
    lookback = int(inputs.get("lookback_days") or 28)

    with SessionLocal() as db:
        dataset_anchor = _order_max_day(db)
        if dataset_anchor is None:
            raise BusinessError("订单表为空，无法预测需求")

        if not category:
            top = db.execute(
                select(SupplyOrder.category_name, func.sum(SupplyOrder.quantity).label("q"))
                .group_by(SupplyOrder.category_name)
                .order_by(func.sum(SupplyOrder.quantity).desc())
                .limit(1)
            ).first()
            category = top[0] if top else ""

        # 时间窗要锚在**该品类自己的最后一天**：数据集里不同品类停售时间不同，
        # 用全库最后一天会让尾部品类落进空区间（实测 Men's Footwear 就是这样）。
        category_anchor = db.scalar(
            select(func.max(SupplyOrder.order_date)).where(SupplyOrder.category_name == category)
        )
        if category_anchor is None:
            raise BusinessError(f"品类「{category}」在数据集中没有任何订单")
        anchor = category_anchor

        start = anchor - timedelta(days=lookback)
        rows = db.execute(
            select(
                func.date(SupplyOrder.order_date).label("day"),
                func.sum(SupplyOrder.quantity).label("units"),
                func.sum(SupplyOrder.sales).label("sales"),
                func.count().label("orders"),
            )
            .where(SupplyOrder.category_name == category)
            .where(SupplyOrder.order_date >= start)
            .where(SupplyOrder.order_date <= anchor)
            .group_by(func.date(SupplyOrder.order_date))
            .order_by(func.date(SupplyOrder.order_date))
        ).all()

    if not rows:
        raise BusinessError(f"品类「{category}」在近 {lookback} 天没有订单，无法预测")

    daily = [
        {
            "day": r.day.isoformat() if hasattr(r.day, "isoformat") else str(r.day),
            "units": int(r.units or 0),
            "orders": int(r.orders or 0),
        }
        for r in rows
    ]
    total_units = sum(d["units"] for d in daily)
    total_sales = sum(float(r.sales or 0) for r in rows)
    avg_daily = round(total_units / max(len(daily), 1), 2)

    # 近 7 天 vs 前 7 天，判断趋势
    recent = [d["units"] for d in daily[-7:]]
    prior = [d["units"] for d in daily[-14:-7]] or recent
    recent_avg = sum(recent) / max(len(recent), 1)
    prior_avg = sum(prior) / max(len(prior), 1)
    trend = "上升" if recent_avg > prior_avg * 1.05 else ("下降" if recent_avg < prior_avg * 0.95 else "平稳")

    unit_price = round(total_sales / total_units, 4) if total_units else 0.0
    return {
        "category": category,
        "anchor_date": anchor.date().isoformat(),
        "dataset_last_date": dataset_anchor.date().isoformat(),
        "lookback_days": lookback,
        "horizon_days": horizon,
        "days_with_orders": len(daily),
        "avg_daily_units": avg_daily,
        "forecast_units": round(avg_daily * horizon, 1),
        "unit_price": unit_price,
        "trend": trend,
        "recent_avg": round(recent_avg, 2),
        "prior_avg": round(prior_avg, 2),
        "source": "dataco",
        "note": "以数据最后一天为基准；需求=近 28 天日销量均值 × 预测天数",
    }


def inventory_snapshot(inputs: dict[str, Any]) -> dict[str, Any]:
    """库存快照。

    本系统没有 WMS/ERP 数据，所以库存**只能由调用方传入**。没传时按 0 处理，
    并在返回里明确标注 ``inventory_source``，避免把假设当成真实库存。
    """
    raw_on_hand = inputs.get("on_hand")
    provided = raw_on_hand not in (None, "")
    on_hand = int(float(raw_on_hand)) if provided else 0
    in_transit = int(float(inputs.get("in_transit") or 0))
    safety_days = int(inputs.get("safety_days") or 3)

    return {
        "on_hand": on_hand,
        "in_transit": in_transit,
        "available": on_hand + in_transit,
        "safety_days": safety_days,
        "inventory_source": "input" if provided else "not_provided",
        "note": "" if provided else "未提供库存 → 按 0 处理，补货建议是保守上限",
    }


def replenish_calc(inputs: dict[str, Any]) -> dict[str, Any]:
    """把预测与库存合成补货建议：目标库存 = 预测需求 + 安全库存。"""
    import math

    avg_daily = float(inputs.get("avg_daily_units") or 0)
    forecast_units = float(inputs.get("forecast_units") or 0)
    available = float(inputs.get("available") or 0)
    safety_days = float(inputs.get("safety_days") or 3)
    unit_price = float(inputs.get("unit_price") or 0)
    lead_time_days = float(inputs.get("lead_time_days") or 5)

    safety_units = round(avg_daily * safety_days, 1)
    target_units = round(forecast_units + safety_units, 1)
    suggested = max(0, math.ceil(target_units - available))
    days_of_cover = round(available / avg_daily, 2) if avg_daily > 0 else 0.0

    urgency = "高" if days_of_cover < lead_time_days else ("中" if days_of_cover < lead_time_days * 2 else "低")
    # 条件表达式只支持「字段 比较 字面量」，不支持跨字段比较，
    # 所以在这里把结论算成布尔值给 gate 用。
    need_replenish = days_of_cover < lead_time_days
    return {
        "need_replenish": need_replenish,
        "avg_daily_units": avg_daily,
        "safety_units": safety_units,
        "target_units": target_units,
        "available": available,
        "suggested_units": suggested,
        "days_of_cover": days_of_cover,
        "lead_time_days": lead_time_days,
        "urgency": urgency,
        "estimated_value": round(suggested * unit_price, 2),
        "unit_price": unit_price,
    }


def carrier_signals(inputs: dict[str, Any]) -> dict[str, Any]:
    """承运商履约信号（真实订单聚合）。

    本系统没有供应商主数据，用**运输方式**作为承运商分层的代理：
    Standard / First / Second / Same Day 在数据里就是不同的服务档位。
    """
    from sqlalchemy import case, func, select

    from app.db.session import SessionLocal
    from app.models.tables import SupplyOrder

    region = str(inputs.get("region") or "").strip()
    with SessionLocal() as db:
        stmt = (
            select(
                SupplyOrder.shipping_mode.label("mode"),
                func.count().label("orders"),
                func.sum(case((SupplyOrder.delivery_status == "Late delivery", 1), else_=0)).label("late"),
                func.avg(SupplyOrder.delay_days).label("avg_delay"),
                func.sum(SupplyOrder.sales).label("sales"),
            )
            .group_by(SupplyOrder.shipping_mode)
            .order_by(func.count().desc())
        )
        if region:
            stmt = stmt.where(SupplyOrder.order_region == region)
        rows = db.execute(stmt).all()

    if not rows:
        raise BusinessError("没有可用的承运商数据")

    signals = [
        {
            "carrier": r.mode,
            "orders": int(r.orders),
            "late": int(r.late or 0),
            "late_rate": round(int(r.late or 0) / int(r.orders), 4) if r.orders else 0.0,
            "avg_delay_days": round(float(r.avg_delay or 0), 3),
            "sales": round(float(r.sales or 0), 2),
        }
        for r in rows
    ]
    return {
        "region": region or "全部地区",
        "carriers": signals,
        "count": len(signals),
        "source": "dataco",
        "note": "以运输方式作为承运商分层代理（无供应商主数据）",
    }


def risk_score(inputs: dict[str, Any]) -> dict[str, Any]:
    """把承运商信号换算成 0–100 风险分：延迟率 60% + 延迟深度 40%。"""
    carriers = inputs.get("carriers") if isinstance(inputs.get("carriers"), list) else []
    if not carriers:
        raise BusinessError("缺少承运商信号，无法评分")

    scored = []
    for c in carriers:
        late_rate = float(c.get("late_rate") or 0)
        delay = abs(float(c.get("avg_delay_days") or 0))
        depth = min(1.0, delay / 4.0)  # 4 天及以上视为满分风险
        score = round((0.6 * late_rate + 0.4 * depth) * 100, 1)
        level = "高" if score >= 60 else ("中" if score >= 35 else "低")
        scored.append(
            {
                "carrier": c.get("carrier"),
                "orders": c.get("orders"),
                "late_rate": late_rate,
                "avg_delay_days": c.get("avg_delay_days"),
                "risk_score": score,
                "risk_level": level,
            }
        )

    scored.sort(key=lambda x: x["risk_score"], reverse=True)
    worst = scored[0]
    return {
        "scored": scored,
        "worst_carrier": worst["carrier"],
        "worst_score": worst["risk_score"],
        "worst_level": worst["risk_level"],
        "high_risk_count": sum(1 for s in scored if s["risk_level"] == "高"),
        "formula": "风险分 = (0.6 × 延迟率 + 0.4 × min(1, |平均延迟|/4)) × 100",
    }


def issue_disposal(inputs: dict[str, Any]) -> dict[str, Any]:
    """承运商风险处置单（产物）。"""
    worst = str(inputs.get("worst_carrier") or "未知承运商")
    scored = inputs.get("scored") if isinstance(inputs.get("scored"), list) else []
    diagnosis = str(inputs.get("text") or "")
    region = str(inputs.get("region") or "全部地区")

    digest = hashlib.sha256(f"disposal|{worst}|{diagnosis[:60]}".encode()).hexdigest()
    lines = [
        f"# 承运商风险处置单 · {region}",
        "",
        "> 由 AgentMatrix-SC 自动生成；风险分来自真实订单履约数据。",
        "",
        "## 一、风险排序",
        "",
        "| 承运商 | 订单数 | 延迟率 | 平均延迟(天) | 风险分 | 等级 |",
        "|---|---|---|---|---|---|",
    ]
    for s in scored:
        lines.append(
            f"| {s.get('carrier')} | {s.get('orders')} | "
            f"{float(s.get('late_rate') or 0) * 100:.2f}% | {s.get('avg_delay_days')} | "
            f"{s.get('risk_score')} | {s.get('risk_level')} |"
        )
    lines += ["", "## 二、处置建议（智能体输出）", "", diagnosis or "（未生成）", ""]
    content = "\n".join(lines)

    return {
        "artifact_id": f"art-{digest[:12]}",
        "name": f"{worst}-处置单.md",
        "mime": "text/markdown",
        "size": len(content.encode("utf-8")),
        "uri": f"artifacts/{digest[:12]}.md",
        "content": content,
        "saved": True,
    }

def po_draft(inputs: dict[str, Any]) -> dict[str, Any]:
    """补货建议落成采购单草稿（产物）。"""
    category = str(inputs.get("category") or "未指定品类")
    suggested = int(float(inputs.get("suggested_units") or 0))
    unit_price = float(inputs.get("unit_price") or 0)
    value = float(inputs.get("estimated_value") or 0)
    urgency = str(inputs.get("urgency") or "—")
    cover = inputs.get("days_of_cover")
    forecast = inputs.get("forecast_units")

    digest = hashlib.sha256(f"po|{category}|{suggested}".encode()).hexdigest()
    lines = [
        f"# 采购单草稿 · {category}",
        "",
        "> 由 AgentMatrix-SC 自动生成；需求与单价来自真实订单数据。",
        "",
        "| 项目 | 值 |",
        "|---|---|",
        f"| 品类 | {category} |",
        f"| 建议补货量 | {suggested} 件 |",
        f"| 预测需求 | {forecast} 件 |",
        f"| 当前库存可覆盖 | {cover} 天 |",
        f"| 紧迫度 | {urgency} |",
        f"| 参考单价 | {unit_price:.2f} |",
        f"| 预估金额 | {value:.2f} |",
        "",
        "## 说明",
        "",
        "- 补货量 = 预测需求 + 安全库存 − 可用库存；",
        "- 单价取该品类历史销售额 ÷ 销量；",
        "- 本系统无 WMS，库存由调用方传入，未传时按 0 处理（保守上限）。",
        "",
    ]
    content = "\n".join(lines)
    return {
        "artifact_id": f"art-{digest[:12]}",
        "name": f"{category}-采购单草稿.md",
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
    "demand_forecast": demand_forecast,
    "inventory_snapshot": inventory_snapshot,
    "replenish_calc": replenish_calc,
    "carrier_signals": carrier_signals,
    "risk_score": risk_score,
    "issue_disposal": issue_disposal,
    "po_draft": po_draft,
}


def run_skill(code: str, inputs: dict[str, Any]) -> dict[str, Any]:
    fn = REGISTRY.get(code)
    if fn is None:
        raise KeyError(f"未注册的技能：{code}")
    return fn(inputs)
