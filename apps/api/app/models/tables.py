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
