"""技能执行器：输入摘要、故障注入分类、Mock 分派（需要 ORM，宿主机跳过）。

HTTP 的纯逻辑在 ``test_http_skill.py``；这里只测与数据库/分派相关的部分。
"""

from __future__ import annotations

import pytest

pytest.importorskip("sqlalchemy")

from app.services.errors import ErrorCode, NodeError  # noqa: E402
from app.services.skill_runtime import inject_fault, preview_input  # noqa: E402


def test_preview_keeps_only_business_keys():
    """执行日志只留业务主键，避免把整块数据写进 skill_runs。"""
    preview = preview_input({"order_id": "1000", "secret_payload": "x" * 500, "region": "West"})
    assert preview == {"order_id": "1000", "region": "West"}


def test_preview_falls_back_to_first_keys():
    preview = preview_input({"foo": 1, "bar": 2, "baz": 3, "qux": 4})
    assert list(preview) == ["foo", "bar", "baz"]


def test_preview_truncates_long_text():
    preview = preview_input({"text": "长" * 200})
    assert len(preview["text"]) == 80


def test_fault_injection_none_does_nothing():
    inject_fault({"fault": "none"})
    inject_fault({})


def test_fault_injection_transient_is_retryable():
    """瞬时故障必须落到可重试分类，否则"自动重试"演示不出来。"""
    with pytest.raises(NodeError) as exc:
        inject_fault({"fault": "transient"})
    assert exc.value.code is ErrorCode.TRANSIENT
    assert exc.value.retryable is True


def test_fault_injection_timeout_is_retryable():
    with pytest.raises(NodeError) as exc:
        inject_fault({"fault": "timeout"})
    assert exc.value.code is ErrorCode.TIMEOUT
    assert exc.value.retryable is True


def test_fault_injection_business_is_not_retryable():
    with pytest.raises(NodeError) as exc:
        inject_fault({"fault": "business"})
    assert exc.value.code is ErrorCode.BUSINESS
    assert exc.value.retryable is False
