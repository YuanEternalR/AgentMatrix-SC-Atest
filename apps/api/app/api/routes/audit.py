"""审计日志查询与导出（只读：没有写、改、删接口）。"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AuditLog, User
from app.services.audit import (
    ACTION_LABELS,
    RESOURCE_LABELS,
    ROLE_LABELS,
    action_label,
    resource_label,
)

router = APIRouter(prefix="/audit-logs", tags=["audit"])

# 谁能看审计：管理员、开发者（排查发布/配置问题）、运营（证明自己做过什么）。
# 只读角色看不到——规格里只读的权限是"查看仪表盘与详情"。
READERS = ("operator", "developer")


def _row(row: AuditLog) -> dict:
    return {
        "id": row.id,
        "actor_id": row.actor_id,
        "actor_name": row.actor_name,
        "actor_role": row.actor_role,
        "actor_role_label": ROLE_LABELS.get(row.actor_role or "", ""),
        "action": row.action,
        "action_label": action_label(row.action),
        "resource_type": row.resource_type,
        "resource_type_label": resource_label(row.resource_type),
        "resource_id": row.resource_id,
        "summary": row.summary,
        "before": row.before,
        "after": row.after,
        "ip": row.ip,
        "user_agent": row.user_agent,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _stmt(
    *,
    action: str | None,
    resource_type: str | None,
    q: str | None,
    days: int,
):
    stmt = select(AuditLog)
    if action:
        codes = [code.strip() for code in action.split(",") if code.strip()]
        stmt = stmt.where(AuditLog.action.in_(codes))
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                AuditLog.summary.ilike(pattern),
                AuditLog.actor_name.ilike(pattern),
                AuditLog.resource_id.ilike(pattern),
            )
        )
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    stmt = stmt.where(AuditLog.created_at >= cutoff)
    return stmt


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*READERS)),
    days: int = Query(default=7, ge=1, le=365),
) -> dict:
    """KPI 与动作分布：页面顶部与筛选项都从这里来，避免前端自己再算一遍。"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    total = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.created_at >= cutoff)) or 0
    today = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.created_at >= today_start)) or 0
    actors = (
        db.scalar(
            select(func.count(func.distinct(AuditLog.actor_name))).where(AuditLog.created_at >= cutoff)
        )
        or 0
    )

    rows = db.execute(
        select(AuditLog.action, func.count())
        .where(AuditLog.created_at >= cutoff)
        .group_by(AuditLog.action)
        .order_by(func.count().desc())
    ).all()

    return {
        "days": days,
        "total": total,
        "today": today,
        "actors": actors,
        "by_action": [
            {"action": code, "label": ACTION_LABELS.get(code, code), "count": count}
            for code, count in rows
        ],
        "actions": [
            {"action": code, "label": label} for code, label in sorted(ACTION_LABELS.items())
        ],
        "resources": [
            {"resource_type": code, "label": label}
            for code, label in sorted(RESOURCE_LABELS.items())
        ],
    }


@router.get("")
def list_logs(
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*READERS)),
    action: str | None = Query(default=None, max_length=200),
    resource_type: str | None = Query(default=None, max_length=32),
    q: str | None = Query(default=None, max_length=100),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[dict]:
    stmt = _stmt(action=action, resource_type=resource_type, q=q, days=days)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)).all()

    # 总数放响应头，body 保持数组（与 /tasks 一致，不破坏既有调用方）
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return [_row(row) for row in rows]


def _json_cell(value: dict | None) -> str:
    if not value:
        return ""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


@router.get("/export.csv")
def export_csv(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*READERS)),
    action: str | None = Query(default=None, max_length=200),
    resource_type: str | None = Query(default=None, max_length=32),
    q: str | None = Query(default=None, max_length=100),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=5000, ge=1, le=20000),
) -> Response:
    """导出当前筛选条件下的审计记录。

    带 UTF-8 BOM：不加的话 Excel 打开中文是乱码，导出功能等于废掉。
    """
    stmt = _stmt(action=action, resource_type=resource_type, q=q, days=days)
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit)).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["时间", "操作者", "角色", "动作", "对象类型", "对象", "摘要", "IP", "变更前", "变更后"])
    for row in rows:
        writer.writerow(
            [
                row.created_at.astimezone().strftime("%Y-%m-%d %H:%M:%S") if row.created_at else "",
                row.actor_name,
                ROLE_LABELS.get(row.actor_role or "", row.actor_role or ""),
                action_label(row.action),
                resource_label(row.resource_type),
                row.resource_id,
                row.summary,
                row.ip,
                _json_cell(row.before),
                _json_cell(row.after),
            ]
        )

    body = "\ufeff" + buffer.getvalue()
    filename = f"audit-logs-{datetime.now().strftime('%Y%m%d-%H%M')}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
