"""ORM models for the minimal closed loop.

Scope note: this is the *deliberate* subset needed to run
"create task -> dispatch with score breakdown -> execute steps -> approve ->
inspect run", not the full 20-table schema. RBAC uses a single ``role`` column
instead of ``roles``/``user_roles`` for now; that is a documented deviation to be
revisited when multi-role assignment is actually needed.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def uid() -> str:
    return uuid.uuid4().hex


def _now_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    # admin | developer | operator | viewer
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = _now_col()


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    stage: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    capabilities: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    owner_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    # 路由统计量：MVP 由种子数据设定，后续由 run_steps 滚动聚合刷新
    model_tier: Mapped[str] = mapped_column(String(8), nullable=False, default="small")
    max_concurrency: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    success_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    avg_cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.01)
    p95_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=2000)
    created_at: Mapped[datetime] = _now_col()


class AgentVersion(Base):
    __tablename__ = "agent_versions"
    __table_args__ = (
        Index("ix_agent_versions_agent_version", "agent_id", "version", unique=True),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    agent_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    skill_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    io_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    guardrails: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # draft | published | archived  —— published 版本不可变
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    changelog: Mapped[str] = mapped_column(Text, nullable=False, default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    # http | builtin | sql | mcp
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    input_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    output_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    secret_ref: Mapped[str | None] = mapped_column(String(64))
    timeout_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    rate_limit: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = _now_col()


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    owner_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    created_at: Mapped[datetime] = _now_col()


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"
    __table_args__ = (
        Index("ix_workflow_versions_wf_version", "workflow_id", "version", unique=True),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    workflow_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    graph: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    variables_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    sla_sec: Mapped[int | None] = mapped_column(Integer)
    changelog: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # manual | api | cron | webhook | subtask
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    complexity_hint: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    required_capabilities: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    workflow_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("workflows.id"))
    # pending | dispatching | queued | running | waiting_approval | succeeded | failed | canceled
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", index=True)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    parent_task_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("tasks.id"))
    created_by: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    created_at: Mapped[datetime] = _now_col()


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_version_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("workflow_versions.id")
    )
    # queued | running | waiting_approval | succeeded | failed | canceled | timed_out
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued", index=True)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    trace_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False, default=0)
    token_input: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    token_output: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(32))
    replay_of: Mapped[str | None] = mapped_column(String(32), ForeignKey("runs.id"))
    # 执行游标：下一个待执行节点，审批暂停后据此恢复
    cursor_node_id: Mapped[str | None] = mapped_column(String(64))
    # 重试调度：到点前不会被 Worker 领取
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = _now_col()


class RunStep(Base):
    __tablename__ = "run_steps"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    node_type: Mapped[str] = mapped_column(String(24), nullable=False)
    # pending | running | succeeded | failed | skipped | retrying | waiting_approval
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    input: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    output: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    agent_version_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("agent_versions.id")
    )
    skill_version_id: Mapped[str | None] = mapped_column(String(32))
    tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False, default=0)


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("run_steps.id"))
    # pending | approved | rejected | transferred | expired
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    assignee_role: Mapped[str] = mapped_column(String(16), nullable=False, default="operator")
    assignee_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    decision: Mapped[str | None] = mapped_column(String(16))
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now_col()


class DeadLetter(Base):
    """重试耗尽后的死信，需人工重试或忽略。"""

    __tablename__ = "dead_letters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    error_code: Mapped[str] = mapped_column(String(24), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # pending | retried | ignored
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    resolved_by: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now_col()


class SupplyOrder(Base):
    """真实订单事实表（DataCo Smart Supply Chain 数据集）。

    数据来源：Kaggle DataCo Smart Supply Chain for Big Data Analysis，
    180,519 条订单明细，按 Order Id 聚合为订单级后导入。
    与 ``business_daily`` 的区别：那张表是按日聚合的派生指标，这张是明细事实。

    延迟口径：``delay_days = days_real - days_scheduled``，负值表示提前送达。
    """

    __tablename__ = "supply_orders"
    __table_args__ = (
        Index("ix_supply_orders_date", "order_date"),
        Index("ix_supply_orders_status", "delivery_status"),
        Index("ix_supply_orders_region", "order_region"),
    )

    order_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    order_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    shipping_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    days_real: Mapped[int | None] = mapped_column(Integer)
    days_scheduled: Mapped[int | None] = mapped_column(Integer)
    delay_days: Mapped[int | None] = mapped_column(Integer)
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    late_risk: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    market: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    order_region: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    order_country: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    order_city: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    shipping_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    customer_segment: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    department_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    category_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sales: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class AlertRule(Base):
    """告警规则：指标 + 比较符 + 阈值 + 严重级别。"""

    __tablename__ = "alert_rules"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # success_rate | failed_runs | waiting_approval | p95_active_ms | cost_usd | dead_letters | running_runs
    metric: Mapped[str] = mapped_column(String(32), nullable=False)
    # > | >= | < | <= | ==
    operator: Mapped[str] = mapped_column(String(4), nullable=False, default=">")
    threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # info | warning | critical
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="warning")
    # 站内；后续可扩展 webhook
    channel: Mapped[str] = mapped_column(String(16), nullable=False, default="inapp")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _now_col()


class AlertEvent(Base):
    """告警事件：open -> acknowledged -> resolved。"""

    __tablename__ = "alert_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    rule_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # open | acknowledged | resolved
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="warning")
    value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    triggered_at: Mapped[datetime] = _now_col()
    acknowledged_by: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Artifact(Base):
    """运行产物（报告、CSV 等）。

    MVP 直接把内容存库：体积小、离线可演示、下载无需对象存储。
    接入 MinIO/S3 时把 ``content`` 换成 ``storage_key`` 即可，接口不变。
    """

    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("run_steps.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(64), nullable=False, default="text/plain")
    uri: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _now_col()


class AuditLog(Base):
    """审计日志：谁、什么时候、对什么、做了什么，改前改后是什么。

    三条设计约束（对应规格 5.8 / 12）：

    1. **只追加**：没有更新与删除接口；迁移里还加了触发器，直接 ``DELETE``/``UPDATE``
       会被数据库拒绝——"不可物理删除"不能只靠代码自觉。
    2. **身份快照**：``actor_name`` / ``actor_role`` 记录**当时**的身份。用户改名或
       调岗后，历史记录仍须反映当时的身份，否则追责无从谈起。
    3. **写入前脱敏**：令牌、邮箱、手机号在落库前就替换掉，避免敏感信息随日志扩散。
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_action", "action"),
        Index("ix_audit_logs_resource", "resource_type", "resource_id"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    actor_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"))
    actor_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    actor_role: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    # 动作编码，见 app/services/audit.py 的 ACTION_LABELS
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 变更前后摘要：只存差异字段，不存整行快照
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = _now_col()


class DispatchDecision(Base):
    """Audit trail for "why this task went to this agent"."""
    __tablename__ = "dispatch_decisions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy: Mapped[str] = mapped_column(String(32), nullable=False)
    agent_code: Mapped[str | None] = mapped_column(String(64))
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    factors: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    rejected: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    planned_by: Mapped[str] = mapped_column(String(16), nullable=False, default="rule")
    fallback_reason: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    dispatch_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = _now_col()
