"""审计日志的写入与请求上下文。

为什么单独一层而不是在每个路由里 ``db.add(AuditLog(...))``：

- **脱敏只有一处**。审计摘要里常常带着业务原值（客户邮箱、密钥前缀、
  操作理由），如果各处自己拼字符串，迟早漏一处。实现见 ``services/redaction``。
- **身份快照只有一处**。谁算操作者、角色怎么取，各路由不该有第二种写法。
- **只追加**。这里只提供 ``record``，不提供 update/delete；数据库触发器再兜一次底。

写入时机约定：``record()`` 只把行加入当前事务，由调用方 ``commit``，
这样"业务变更 + 审计"要么都成功，要么都不发生——审计漏记比审计多记更危险。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User
from app.services.redaction import (
    ACTION_LABELS,
    ERROR_LABELS,
    FIELD_LABELS,
    RESOURCE_LABELS,
    ROLE_LABELS,
    describe_fields,
    redact,
    redact_obj,
)

__all__ = [
    "ACTION_LABELS",
    "ERROR_LABELS",
    "FIELD_LABELS",
    "RESOURCE_LABELS",
    "ROLE_LABELS",
    "AuditCtx",
    "action_label",
    "describe_fields",
    "record",
    "record_and_commit",
    "redact",
    "redact_obj",
    "request_ctx",
    "resource_label",
]


# --- 调用上下文 ------------------------------------------------------------

@dataclass(frozen=True)
class AuditCtx:
    """一次请求的来源信息。作为 FastAPI 依赖注入，避免路由自己解析请求头。"""

    ip: str = ""
    user_agent: str = ""


def request_ctx(request: Request) -> AuditCtx:
    """从请求里取真实来源 IP 与 UA。

    容器化部署时 ``request.client.host`` 常是 Docker 网桥地址，
    因此优先取 ``X-Forwarded-For`` 的第一跳。
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else ""
    if not ip and request.client is not None:
        ip = request.client.host
    return AuditCtx(ip=(ip or "")[:64], user_agent=request.headers.get("user-agent", "")[:255])


# --- 写入 ------------------------------------------------------------------

def record(
    db: Session,
    action: str,
    *,
    user: User | None = None,
    resource_type: str = "",
    resource_id: str = "",
    summary: str = "",
    before: dict | None = None,
    after: dict | None = None,
    ctx: AuditCtx | None = None,
    actor_name: str | None = None,
) -> AuditLog:
    """往当前事务里追加一条审计记录。**不 commit**，由调用方决定提交时机。

    ``user`` 为 None 表示"没有已认证身份"（例如登录失败、系统触发），
    此时用 ``actor_name`` 记录尝试者，例如登录请求里填的邮箱。
    """
    row = AuditLog(
        actor_id=user.id if user is not None else None,
        actor_name=redact(actor_name if actor_name is not None else (user.name if user else ""))[:64],
        actor_role=user.role if user is not None else "",
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id or "")[:64],
        summary=redact(summary)[:1000],
        before=redact_obj(before) if before is not None else None,
        after=redact_obj(after) if after is not None else None,
        ip=(ctx.ip if ctx else "")[:64],
        user_agent=(ctx.user_agent if ctx else "")[:255],
    )
    db.add(row)
    return row


def record_and_commit(db: Session, action: str, **kwargs: Any) -> AuditLog:
    """独立提交：用于"业务已经结束、只剩记录"的场景（登录、登录失败）。"""
    row = record(db, action, **kwargs)
    db.commit()
    return row


def action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


def resource_label(resource_type: str) -> str:
    return RESOURCE_LABELS.get(resource_type, resource_type)
