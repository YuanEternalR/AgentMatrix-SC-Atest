"""错误分类。

分类决定了"能不能重试"，这是重试策略的全部依据：
盲目的无限重试会把一个校验错误放大成三次无谓的模型调用。
"""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    TRANSIENT = "TRANSIENT"      # 网络抖动、临时不可用 -> 可重试
    VALIDATION = "VALIDATION"    # 入参不合法 -> 不可重试
    PERMISSION = "PERMISSION"    # 鉴权/授权失败 -> 不可重试
    RATE_LIMIT = "RATE_LIMIT"    # 上游限流 -> 可重试（退避更长）
    UPSTREAM = "UPSTREAM"        # 上游 5xx -> 可重试
    TIMEOUT = "TIMEOUT"          # 超时 -> 可重试
    BUSINESS = "BUSINESS"        # 业务规则拒绝 -> 不可重试
    UNKNOWN = "UNKNOWN"          # 未识别 -> 默认不重试，避免放大故障


RETRYABLE: frozenset[ErrorCode] = frozenset(
    {ErrorCode.TRANSIENT, ErrorCode.RATE_LIMIT, ErrorCode.UPSTREAM, ErrorCode.TIMEOUT}
)


class NodeError(Exception):
    """节点执行失败，携带错误分类。"""

    def __init__(self, message: str, code: ErrorCode = ErrorCode.UNKNOWN) -> None:
        super().__init__(message)
        self.code = code

    @property
    def retryable(self) -> bool:
        return self.code in RETRYABLE


class TransientError(NodeError):
    def __init__(self, message: str) -> None:
        super().__init__(message, ErrorCode.TRANSIENT)


class BusinessError(NodeError):
    def __init__(self, message: str) -> None:
        super().__init__(message, ErrorCode.BUSINESS)


class ValidationError(NodeError):
    def __init__(self, message: str) -> None:
        super().__init__(message, ErrorCode.VALIDATION)


class TimeoutError_(NodeError):
    def __init__(self, message: str) -> None:
        super().__init__(message, ErrorCode.TIMEOUT)


def classify(exc: BaseException) -> ErrorCode:
    """把任意异常映射到错误分类。"""
    if isinstance(exc, NodeError):
        return exc.code
    if isinstance(exc, KeyError):
        return ErrorCode.VALIDATION
    if isinstance(exc, TimeoutError):
        return ErrorCode.TIMEOUT
    if isinstance(exc, PermissionError):
        return ErrorCode.PERMISSION
    if isinstance(exc, ValueError):
        return ErrorCode.VALIDATION
    return ErrorCode.UNKNOWN


def backoff_seconds(attempt: int, base: float = 0.8, cap: float = 30.0) -> float:
    """指数退避 + 抖动；attempt 从 1 开始。"""
    import random

    raw = min(cap, base * (2 ** (attempt - 1)))
    # 抖动 ±20%，避免多个 Worker 同时重试造成尖峰
    return round(raw * (0.8 + 0.4 * random.random()), 3)
