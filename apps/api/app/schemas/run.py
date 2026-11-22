"""运行、步骤与审批的响应模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RunStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    node_id: str
    node_type: str
    status: str
    attempt: int
    input: dict
    output: dict
    error: dict
    started_at: datetime | None
    finished_at: datetime | None
    tokens: int
    cost_usd: float


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    status: str
    trigger: str
    trace_id: str
    started_at: datetime | None
    finished_at: datetime | None
    cost_usd: float
    token_input: int
    token_output: int
    error_code: str | None


class RunDetailOut(RunOut):
    steps: list[RunStepOut] = Field(default_factory=list)
    workflow_version: int | None = None
    # 工作流图（节点 + 边），供前端只读渲染 DAG
    graph: dict | None = None


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    run_id: str
    step_id: str | None
    status: str
    assignee_role: str
    decision: str | None
    comment: str
    created_at: datetime
    decided_at: datetime | None


class ApprovalDecisionIn(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    comment: str = Field(default="", max_length=500)
