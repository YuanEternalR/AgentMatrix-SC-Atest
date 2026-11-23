"""HTTP 技能的纯逻辑：SSRF 防护、模板渲染、Mock 响应、真实请求。

**故意不依赖 SQLAlchemy / FastAPI**：SSRF 防护是安全边界，必须能被单测反复锤。
如果它跟 ORM 绑在一起，宿主机没装数据库驱动就测不了，等于没测。
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.services.errors import BusinessError, ErrorCode, NodeError, TransientError

_ERROR_MAP = {
    408: ErrorCode.TIMEOUT,
    429: ErrorCode.RATE_LIMIT,
    401: ErrorCode.PERMISSION,
    403: ErrorCode.PERMISSION,
}


def is_internal_address(address: str) -> bool:
    """回环 / 内网 / 链路本地 / 保留 / 组播 一律视为内部地址。"""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def guard_url(url: str, allowed_hosts: list[str] | None = None) -> str:
    """校验 URL 是否允许访问，返回主机名。

    规则（规格 12 的 SSRF 要求）：

    1. 只允许 http / https；
    2. 白名单命中的主机直接放行——内网系统要接，就在这里显式登记；
    3. 其余解析全部 A/AAAA 记录，任何一条命中内部地址即拒绝
       （不能只看第一条：多 A 记录时攻击者可以混入一条内网地址）。
    """
    allowed = {h.strip().lower() for h in (allowed_hosts or []) if h and h.strip()}
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise BusinessError(f"HTTP 技能只支持 http/https，收到 {parsed.scheme or '空'}")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise BusinessError("URL 缺少主机名")

    if host in allowed:
        return host

    try:
        infos = socket.getaddrinfo(host, parsed.port or 80, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise BusinessError(f"域名无法解析：{host}") from exc

    for info in infos:
        address = str(info[4][0])
        if is_internal_address(address):
            raise BusinessError(
                f"HTTP 技能禁止访问内网/回环地址（{host} → {address}）；"
                "如确有需要，请把域名加入白名单"
            )
    return host


def render_template(template: str, inputs: dict[str, Any]) -> str:
    """把 ``{{字段}}`` 替换成输入值；未提供的占位符原样保留，便于排查。"""
    out = template or ""
    for key, value in inputs.items():
        out = out.replace("{{" + key + "}}", str(value))
    return out


def mock_response(config: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    """确定性 Mock：同样输入永远同样响应。

    配了 ``mock_response``（JSON 字符串）就用它，并支持占位符替换；
    没配就返回回显结构，至少能证明"参数确实传进去了"。
    """
    template = config.get("mock_response") or ""
    if template:
        try:
            return json.loads(render_template(str(template), inputs))
        except json.JSONDecodeError as exc:
            raise BusinessError(f"mock_response 不是合法 JSON：{exc.msg}") from exc

    seed = hashlib.sha256(
        json.dumps(inputs, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return {
        "mock": True,
        "ok": True,
        "echo": inputs,
        "request_id": seed[:12],
        "responded_in_ms": int(config.get("mock_delay_ms") or 0),
    }


def _auth_headers(auth: dict[str, Any]) -> dict[str, str]:
    """鉴权只允许"从环境变量取"：配置里永远不存明文。"""
    if auth.get("type") == "bearer" and auth.get("token_env"):
        token = os.environ.get(str(auth["token_env"]), "")
        if token:
            return {"Authorization": f"Bearer {token}"}
    return {}


def call_http(config: dict[str, Any], inputs: dict[str, Any], timeout_sec: int) -> dict[str, Any]:
    """真实 HTTP 调用（仅当 mock=false 时走到这里）。"""
    url = render_template(str(config.get("url") or ""), inputs)
    if not url:
        raise BusinessError("HTTP 技能缺少 url")
    guard_url(url, config.get("allowed_hosts") or [])

    method = str(config.get("method") or "GET").upper()
    headers = {str(k): render_template(str(v), inputs) for k, v in (config.get("headers") or {}).items()}
    body_template = str(config.get("body_template") or "")
    data = render_template(body_template, inputs).encode("utf-8") if body_template else None
    if data is not None:
        headers.setdefault("Content-Type", "application/json")
    headers.update(_auth_headers(config.get("auth") or {}))

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            raw = response.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:200]
        raise NodeError(
            f"HTTP {exc.code}：{detail}", _ERROR_MAP.get(exc.code, ErrorCode.UPSTREAM)
        ) from exc
    except urllib.error.URLError as exc:
        raise NodeError(f"连接失败：{exc.reason}", ErrorCode.TIMEOUT) from exc
    except TimeoutError as exc:
        raise NodeError(f"请求超时（{timeout_sec}s）", ErrorCode.TIMEOUT) from exc
    except OSError as exc:
        raise TransientError(f"连接中断：{type(exc).__name__}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {"text": raw[:2000]}
    return payload if isinstance(payload, dict) else {"data": payload}
