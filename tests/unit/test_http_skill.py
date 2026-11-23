"""HTTP 技能的纯逻辑：SSRF 防护、模板渲染、Mock 响应。

这组用例守的是安全边界与确定性：
- 内网/回环地址必须被拦住，白名单是唯一例外；
- 多 A 记录时只要有一条是内网就拒绝（不能只看第一条）；
- Mock 响应必须确定性，否则"离线演示可复现"就是空话。
"""

from __future__ import annotations

import socket

import pytest

from app.services import http_skill
from app.services.errors import BusinessError, ErrorCode, NodeError


def _fake_dns(mapping: dict[str, list[str]]):
    """替换 getaddrinfo：单测不该真的去查 DNS。"""

    def fake(host, port, proto=None, *args, **kwargs):
        addresses = mapping.get(host)
        if addresses is None:
            raise socket.gaierror(f"unknown host {host}")
        return [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                (addr, port or 80),
            )
            for addr in addresses
        ]

    return fake


# --- SSRF -----------------------------------------------------------------

def test_guard_rejects_loopback_literal():
    with pytest.raises(BusinessError):
        http_skill.guard_url("http://127.0.0.1:8000/health")


def test_guard_rejects_private_literal():
    with pytest.raises(BusinessError):
        http_skill.guard_url("http://192.168.1.10/admin")


def test_guard_rejects_link_local():
    with pytest.raises(BusinessError):
        http_skill.guard_url("http://169.254.169.254/latest/meta-data")


def test_guard_rejects_non_http_scheme():
    with pytest.raises(BusinessError):
        http_skill.guard_url("file:///etc/passwd")


def test_guard_blocks_domain_resolving_to_internal(monkeypatch):
    monkeypatch.setattr(
        http_skill.socket, "getaddrinfo", _fake_dns({"evil.example.com": ["10.0.0.7"]})
    )
    with pytest.raises(BusinessError) as exc:
        http_skill.guard_url("http://evil.example.com/x")
    assert "内网" in str(exc.value)


def test_guard_blocks_when_any_record_is_internal(monkeypatch):
    """多 A 记录混入一条内网地址必须整体拒绝。"""
    monkeypatch.setattr(
        http_skill.socket,
        "getaddrinfo",
        _fake_dns({"mixed.example.com": ["93.184.216.34", "127.0.0.1"]}),
    )
    with pytest.raises(BusinessError):
        http_skill.guard_url("http://mixed.example.com/x")


def test_guard_allows_public_domain(monkeypatch):
    monkeypatch.setattr(
        http_skill.socket, "getaddrinfo", _fake_dns({"api.example.com": ["93.184.216.34"]})
    )
    assert http_skill.guard_url("https://api.example.com/quote") == "api.example.com"


def test_guard_allowlist_overrides_internal_check():
    """内网系统要接，就在白名单里显式登记。"""
    assert http_skill.guard_url("http://api:8000/health", ["api"]) == "api"


def test_guard_rejects_unresolvable_host(monkeypatch):
    monkeypatch.setattr(http_skill.socket, "getaddrinfo", _fake_dns({}))
    with pytest.raises(BusinessError) as exc:
        http_skill.guard_url("http://nope.example.com/x")
    assert "无法解析" in str(exc.value)


def test_guard_rejects_url_without_host():
    with pytest.raises(BusinessError):
        http_skill.guard_url("http:///path")


@pytest.mark.parametrize(
    "address,expected",
    [
        ("127.0.0.1", True),
        ("10.1.2.3", True),
        ("172.16.0.1", True),
        ("192.168.0.1", True),
        ("169.254.169.254", True),
        ("0.0.0.0", True),
        ("93.184.216.34", False),
        ("8.8.8.8", False),
    ],
)
def test_is_internal_address(address: str, expected: bool):
    assert http_skill.is_internal_address(address) is expected


# --- 模板与 Mock -----------------------------------------------------------

def test_render_template_replaces_placeholders():
    assert (
        http_skill.render_template("https://x/q?c={{carrier}}&w={{weight}}", {"carrier": "A", "weight": 3})
        == "https://x/q?c=A&w=3"
    )


def test_render_template_keeps_unknown_placeholder():
    assert http_skill.render_template("c={{carrier}}", {}) == "c={{carrier}}"


def test_mock_response_is_deterministic():
    config = {"mock": True}
    a = http_skill.mock_response(config, {"order_id": "1000"})
    b = http_skill.mock_response(config, {"order_id": "1000"})
    assert a == b
    assert a["mock"] is True
    assert a["request_id"]


def test_mock_response_differs_by_input():
    config = {}
    a = http_skill.mock_response(config, {"order_id": "1000"})
    b = http_skill.mock_response(config, {"order_id": "2000"})
    assert a["request_id"] != b["request_id"]


def test_mock_response_uses_template():
    config = {"mock_response": '{"quote": 128.5, "carrier": "{{carrier}}"}'}
    out = http_skill.mock_response(config, {"carrier": "Standard Class"})
    assert out == {"quote": 128.5, "carrier": "Standard Class"}


def test_mock_response_rejects_bad_json():
    with pytest.raises(BusinessError) as exc:
        http_skill.mock_response({"mock_response": "{not json"}, {})
    assert "JSON" in str(exc.value)
