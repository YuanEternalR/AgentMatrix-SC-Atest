"""任务与调度决策的请求/响应模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FactorOut(BaseModel):
    name: str
    raw: float
    weight: float
    contribution: float
    detail: str


class RejectionOut(BaseModel):
    agent_code: str
    reason: str


class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    strategy: str
    agent_code: str | None
    score: float
    factors: list[FactorOut] = Field(default_factory=list)
    rejected: list[RejectionOut] = Field(default_factory=list)
    planned_by: str
    fallback_reason: str | None = None
    reason: str


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    workflow_code: str
    payload: dict = Field(default_factory=dict)
    priority: int = Field(default=3, ge=1, le=5)
    complexity_hint: int = Field(default=3, ge=1, le=5)
    deadline_in_sec: int | None = Field(default=None, gt=0)
    idempotency_key: str | None = Field(default=None, max_length=128)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    status: str
    priority: int
    complexity_hint: int
    payload: dict
    required_capabilities: list[str]
    created_at: datetime
    workflow_code: str | None = None


class TaskDetailOut(TaskOut):
    run_id: str | None = None
    run_status: str | None = None
    decision: DecisionOut | None = None
    workflow_code: str | None = None
