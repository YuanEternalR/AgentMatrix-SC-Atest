"""真实订单数据接口（DataCo Smart Supply Chain，65,752 单）。

与 ``/metrics`` 的区别：这里是**事实明细**，指标接口是**聚合派生**。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import SupplyOrder, User

router = APIRouter(prefix="/orders", tags=["orders"])

# 允许客户端读取总数头
EXPOSE = {"Access-Control-Expose-Headers": "X-Total-Count"}


def _row(order: SupplyOrder) -> dict:
    return {
        "order_id": order.order_id,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "shipping_date": order.shipping_date.isoformat() if order.shipping_date else None,
        "days_real": order.days_real,
        "days_scheduled": order.days_scheduled,
        "delay_days": order.delay_days,
        "delivery_status": order.delivery_status,
        "late_risk": order.late_risk,
        "market": order.market,
        "order_region": order.order_region,
        "order_country": order.order_country,
        "order_city": order.order_city,
        "shipping_mode": order.shipping_mode,
        "customer_segment": order.customer_segment,
        "department_name": order.department_name,
        "category_name": order.category_name,
        "quantity": order.quantity,
        "sales": order.sales,
        "profit": order.profit,
        "item_count": order.item_count,
    }


@router.get("")
def list_orders(
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    region: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=64),
    order: str = Query(default="delay", pattern="^(delay|recent)$"),
) -> list[dict]:
    """订单列表。``order=delay`` 按延迟天数倒序，方便直接看异常单。"""
    stmt = select(SupplyOrder)
    if status_filter:
        stmt = stmt.where(SupplyOrder.delivery_status == status_filter)
    if region:
        stmt = stmt.where(SupplyOrder.order_region == region)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                SupplyOrder.order_id.ilike(pattern),
                SupplyOrder.order_city.ilike(pattern),
                SupplyOrder.category_name.ilike(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    if order == "delay":
        stmt = stmt.order_by(SupplyOrder.delay_days.desc(), SupplyOrder.order_id)
    else:
        stmt = stmt.order_by(SupplyOrder.order_date.desc())

    rows = db.scalars(stmt.limit(limit).offset(offset)).all()
    response.headers["X-Total-Count"] = str(total)
    response.headers.update(EXPOSE)
    return [_row(o) for o in rows]


@router.get("/stats")
def order_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """整体履约分布：准时率、延迟率、按地区与运输方式的延迟情况。"""
    total = db.scalar(select(func.count()).select_from(SupplyOrder)) or 0
    if total == 0:
        return {"total": 0, "source": "dataco", "note": "尚未导入真实订单"}

    on_time = (
        db.scalar(
            select(func.count())
            .select_from(SupplyOrder)
            .where(SupplyOrder.delivery_status == "Shipping on time")
        )
        or 0
    )
    late = (
        db.scalar(
            select(func.count())
            .select_from(SupplyOrder)
            .where(SupplyOrder.delivery_status == "Late delivery")
        )
        or 0
    )
    advance = (
        db.scalar(
            select(func.count())
            .select_from(SupplyOrder)
            .where(SupplyOrder.delivery_status == "Advance shipping")
        )
        or 0
    )
    avg_delay = db.scalar(select(func.avg(SupplyOrder.delay_days)))

    by_region = db.execute(
        select(
            SupplyOrder.order_region,
            func.count().label("orders"),
            func.avg(SupplyOrder.delay_days).label("avg_delay"),
            func.sum(
                case((SupplyOrder.delivery_status == "Late delivery", 1), else_=0)
            ).label("late"),
        )
        .group_by(SupplyOrder.order_region)
        .order_by(func.count().desc())
    ).all()

    by_mode = db.execute(
        select(
            SupplyOrder.shipping_mode,
            func.count().label("orders"),
            func.avg(SupplyOrder.delay_days).label("avg_delay"),
        )
        .group_by(SupplyOrder.shipping_mode)
        .order_by(func.count().desc())
    ).all()

    return {
        "source": "dataco",
        "total": total,
        "shipping_on_time": on_time,
        "late_delivery": late,
        "advance_shipping": advance,
        "otif_rate": round(on_time / total, 4),
        "late_rate": round(late / total, 4),
        "avg_delay_days": round(float(avg_delay or 0), 3),
        "by_region": [
            {
                "region": r[0],
                "orders": r[1],
                "avg_delay_days": round(float(r[2] or 0), 3),
                "late": int(r[3] or 0),
            }
            for r in by_region
        ],
        "by_mode": [
            {
                "mode": r[0],
                "orders": r[1],
                "avg_delay_days": round(float(r[2] or 0), 3),
            }
            for r in by_mode
        ],
    }


@router.get("/{order_id}")
def get_order(
    order_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    order = db.get(SupplyOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不在真实数据集中")
    return _row(order)
