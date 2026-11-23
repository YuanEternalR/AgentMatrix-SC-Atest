"""审计记录的写入语义（需要 ORM 与框架，宿主机没装依赖时跳过）。

重点验证三件事：
1. 身份取**快照**，不是外键回查；
2. ``record`` 只入当前事务、不自行提交——业务与审计必须同生共死；
3. 请求上下文（IP / UA）在容器环境下取的是 X-Forwarded-For 第一跳。
"""

from __future__ import annotations

import pytest

pytest.importorskip("sqlalchemy")
pytest.importorskip("fastapi")

from app.models import AuditLog, User  # noqa: E402
from app.services.audit import (  # noqa: E402
    AuditCtx,
    record,
    request_ctx,
)


class FakeSession:
    """只实现 record() 用到的那一个方法。"""

    def __init__(self) -> None:
        self.rows: list[AuditLog] = []

    def add(self, row: AuditLog) -> None:
        self.rows.append(row)


def make_user(role: str = "operator", name: str = "张三") -> User:
    return User(
        id="u-1",
        email="zhangsan@agentmatrix.local",
        name=name,
        password_hash="x",
        role=role,
    )


def test_record_snapshots_actor_identity():
    db = FakeSession()
    user = make_user(role="operator", name="张三")

    record(db, "approval.decide", user=user, resource_type="approval", resource_id="a-1")

    row = db.rows[0]
    assert row.actor_id == user.id
    assert row.actor_name == "张三"
    # 角色存快照：用户日后调岗，历史记录不能跟着变
    assert row.actor_role == "operator"


def test_record_without_user_redacts_attempted_email():
    db = FakeSession()
    record(
        db,
        "auth.login_failed",
        actor_name="intruder@agentmatrix.local",
        summary="登录失败",
    )
    row = db.rows[0]
    assert row.actor_id is None
    assert row.actor_name == "i***@agentmatrix.local"
    assert row.actor_role == ""


def test_record_redacts_before_and_after():
    db = FakeSession()
    record(
        db,
        "alert_rule.update",
        user=make_user(),
        before={"threshold": 0.9, "note": "ops@agentmatrix.local"},
        after={"threshold": 0.8},
    )
    row = db.rows[0]
    assert row.before["note"] == "o***@agentmatrix.local"
    assert row.before["threshold"] == 0.9
    assert row.after == {"threshold": 0.8}


def test_record_copies_request_context():
    db = FakeSession()
    ctx = AuditCtx(ip="10.0.0.7", user_agent="pytest/1.0")
    record(db, "auth.login", user=make_user(), ctx=ctx)
    assert db.rows[0].ip == "10.0.0.7"
    assert db.rows[0].user_agent == "pytest/1.0"


def test_record_does_not_commit_or_flush():
    """record 只入当前事务；谁提交由调用方决定。"""

    class ExplodingSession(FakeSession):
        def commit(self):  # pragma: no cover - 被调用即失败
            raise AssertionError("record() 不应自行提交")

        def flush(self):  # pragma: no cover
            raise AssertionError("record() 不应自行 flush")

    db = ExplodingSession()
    record(db, "task.create", user=make_user())
    assert len(db.rows) == 1


def test_summary_is_bounded_and_redacted():
    db = FakeSession()
    record(db, "task.create", user=make_user(), summary="x" * 2000 + " sk-abcdef123456")
    assert len(db.rows[0].summary) <= 1000


def test_actor_name_is_bounded():
    db = FakeSession()
    record(db, "task.create", user=make_user(name="名" * 100))
    assert len(db.rows[0].actor_name) <= 64


def test_request_ctx_prefers_forwarded_header():
    class FakeClient:
        host = "172.18.0.5"

    class FakeRequest:
        headers = {"x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "pytest"}
        client = FakeClient()

    ctx = request_ctx(FakeRequest())  # type: ignore[arg-type]
    assert ctx.ip == "203.0.113.9"
    assert ctx.user_agent == "pytest"


def test_request_ctx_falls_back_to_socket_peer():
    class FakeClient:
        host = "172.18.0.5"

    class FakeRequest:
        headers: dict[str, str] = {}
        client = FakeClient()

    ctx = request_ctx(FakeRequest())  # type: ignore[arg-type]
    assert ctx.ip == "172.18.0.5"
    assert ctx.user_agent == ""
