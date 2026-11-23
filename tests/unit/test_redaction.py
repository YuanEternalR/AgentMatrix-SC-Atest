"""脱敏与审计用词表（纯函数，不依赖数据库/框架）。

规格 12 要求日志脱敏手机号、邮箱、地址、密钥、Token。这组用例守住两头：
该打码的必须打码，不该动的（中文业务文案、阈值、计数）一个字都不能改。
"""

from __future__ import annotations

import pytest

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


def test_redact_masks_secret_key_keeping_prefix():
    assert redact("key=sk-abcdef1234567890 tail") == "key=sk-abcd**** tail"


def test_redact_masks_bearer_token():
    out = redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6")
    assert out == "Authorization: Bearer ****"


def test_redact_masks_email_keeping_domain():
    assert redact("联系 ops@agentmatrix.local") == "联系 o***@agentmatrix.local"


def test_redact_masks_phone_middle_digits():
    assert redact("电话 13812345678") == "电话 138****5678"


def test_redact_is_idempotent():
    once = redact("sk-abcdef123456 ops@agentmatrix.local 13812345678")
    assert redact(once) == once


def test_redact_keeps_plain_chinese_text():
    text = "发布「订单延迟异常闭环」v3，共 8 个节点"
    assert redact(text) == text


def test_redact_keeps_numbers_that_are_not_phones():
    assert redact("阈值 0.9 与 2026-11-23 12:30") == "阈值 0.9 与 2026-11-23 12:30"


def test_redact_handles_empty_string():
    assert redact("") == ""


def test_redact_obj_walks_nested_structures():
    out = redact_obj(
        {
            "email": "a@b.com",
            "list": ["sk-abcdef1234", 42, None],
            "nested": {"phone": "13812345678"},
        }
    )
    assert out["email"] == "a***@b.com"
    assert out["list"][0] == "sk-abcd****"
    assert out["list"][1] == 42
    assert out["list"][2] is None
    assert out["nested"]["phone"] == "138****5678"


def test_redact_obj_leaves_booleans_and_floats_alone():
    value = {"enabled": False, "threshold": 0.75, "count": 12}
    assert redact_obj(value) == value


@pytest.mark.parametrize(
    "mapping", [ACTION_LABELS, RESOURCE_LABELS, ROLE_LABELS, FIELD_LABELS, ERROR_LABELS]
)
def test_every_code_has_chinese_label(mapping: dict[str, str]):
    """界面不出现英文代码：任何会被渲染的编码都必须有中文名。"""
    for code, label in mapping.items():
        assert label and not label.isascii(), f"{code} 缺少中文名"


def test_action_codes_are_namespaced():
    """动作编码统一 ``域.动作`` 形式，便于前端分组与后端筛选。"""
    for code in ACTION_LABELS:
        assert "." in code, f"{code} 不符合 域.动作 命名"


def test_describe_fields_uses_chinese_names():
    assert describe_fields({"enabled": True, "threshold": 0.9}) == "启用状态、阈值"


def test_describe_fields_falls_back_to_key():
    """查不到的字段宁可显示键名，也不能丢掉"改了什么"。"""
    assert describe_fields({"custom_field": 1}) == "custom_field"
