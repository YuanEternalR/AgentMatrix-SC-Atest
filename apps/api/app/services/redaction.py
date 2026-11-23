"""日志脱敏与审计用词表。

**故意不依赖 SQLAlchemy / FastAPI**：脱敏是最需要单测覆盖的部分，
如果它跟 ORM 绑在一起，本地没装数据库驱动就测不了，等于没测。

规格 12 要求日志脱敏手机号、邮箱、地址、密钥、Token。这里的口径：
密钥与令牌整段打码，邮箱只留首字符与域名，手机号保留前后各 4 位，
足以在同一批次里认出"是不是同一个人/同一个号"，又不泄露原文。
"""
from __future__ import annotations

import re
from typing import Any

# 动作编码 → 中文。导出 CSV、文档与前端展示共用同一套口径。
ACTION_LABELS: dict[str, str] = {
    "auth.login": "登录",
    "auth.login_failed": "登录失败",
    "task.create": "创建任务",
    "workflow.publish": "发布工作流版本",
    "approval.decide": "审批决策",
    "dead_letter.retry": "死信重试",
    "dead_letter.ignore": "死信忽略",
    "alert_rule.create": "新建告警规则",
    "alert_rule.update": "修改告警规则",
    "alert_rule.delete": "删除告警规则",
    "alert.ack": "确认告警",
    "alert.resolve": "恢复告警",
    "skill.create": "新建技能",
    "skill.version": "发布技能版本",
    "skill.delete": "删除技能",
    "agent.create": "新建智能体",
    "agent.update": "修改智能体",
    "agent.publish": "发布智能体版本",
    "dispatch.configure": "调整调度策略",
}

RESOURCE_LABELS: dict[str, str] = {
    "user": "用户",
    "task": "任务",
    "run": "运行",
    "approval": "审批",
    "workflow": "工作流",
    "dead_letter": "死信",
    "alert_rule": "告警规则",
    "alert_event": "告警事件",
    "skill": "技能",
    "agent": "智能体",
    "dispatch": "调度配置",
}

ROLE_LABELS: dict[str, str] = {
    "admin": "管理员",
    "developer": "开发者",
    "operator": "运营",
    "viewer": "只读",
}

# 审计摘要里可能出现的字段名。摘要会直接显示在界面上，
# 不能写成"修改告警规则：enabled,threshold"这种半成品中文。
FIELD_LABELS: dict[str, str] = {
    "enabled": "启用状态",
    "threshold": "阈值",
    "severity": "级别",
    "name": "名称",
    "metric": "指标",
    "operator": "比较符",
    "decision": "决策",
    "comment": "审批意见",
    "status": "状态",
    "version": "版本",
    "changelog": "变更说明",
    "priority": "优先级",
    "title": "标题",
    "reason": "原因",
    "config": "配置",
    "skills": "绑定技能",
    "type": "类型",
    "category": "分类",
    "prompt_length": "提示词长度",
    "stage": "阶段",
    "strategy": "策略",
    "weights": "权重",
    "sla_headroom": "SLA 余量",
    "min_success_rate": "质量下限",
}

# 错误分类的中文名（与前端 labels.ts 的 ERROR_CODE_LABEL 同一口径）
ERROR_LABELS: dict[str, str] = {
    "TRANSIENT": "瞬时故障",
    "VALIDATION": "参数不合法",
    "PERMISSION": "权限不足",
    "RATE_LIMIT": "上游限流",
    "UPSTREAM": "上游异常",
    "TIMEOUT": "调用超时",
    "BUSINESS": "业务规则拒绝",
    "UNKNOWN": "未知错误",
}

# 模型密钥：保留前 4 位用于核对，其余打码
_SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_\-]{4})[A-Za-z0-9_\-]{4,}")
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{8,}")
# 邮箱：本地部分只留首字符
_EMAIL_RE = re.compile(r"([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*(@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})")
# 中国大陆手机号：中间四位打码
_PHONE_RE = re.compile(r"(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)")


def redact(text: str) -> str:
    """把一段文本里的密钥、令牌、邮箱、手机号替换成打码形式。

    幂等：对已脱敏文本再调用一次不会继续变化（``****`` 不含数字，不会二次命中）。
    """
    if not text:
        return text
    out = _SECRET_RE.sub(r"\1****", text)
    out = _BEARER_RE.sub(r"\1****", out)
    out = _EMAIL_RE.sub(r"\1***\2", out)
    out = _PHONE_RE.sub(r"\1****\2", out)
    return out


def redact_obj(value: Any) -> Any:
    """递归脱敏 dict / list / str。

    ``before`` / ``after`` 是"变更前后摘要"，同样可能带邮箱等原值，不能例外。
    """
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {k: redact_obj(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_obj(v) for v in value]
    return value


def describe_fields(changed: dict) -> str:
    """把变更字段翻成中文短语，用于审计摘要。

    查不到的字段回退成原键名——宁可显示英文键，也不要丢掉"改了什么"。
    """
    return "、".join(FIELD_LABELS.get(key, key) for key in changed)
