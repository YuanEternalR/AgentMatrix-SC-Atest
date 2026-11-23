"""工作台外壳的 AI 侧：场景助手。

分工（对应源工作台的 L2 / L4 分层）：

- **场景配置与场景记忆属于"壳"**：它们是文件（`scenarios/*.json`、`memory/*.md`），
  由外壳读写，平台不落库——壳可以随便换，记忆还在。
- **平台只提供能力**：给一份实时快照（任务/运行/审批/矩阵/策略），
  用"场景记忆 + 快照 + 问题"构造提示词，让模型回答"这个场景现在该干什么"。

这样场景助手看到的数字全部来自数据库当前状态，不是模型编的；
而且每次提问都写审计，能追溯"谁在哪个场景问了什么"。
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import Agent, Approval, DeadLetter, Run, Task, User
from app.services.audit import AuditCtx, record, request_ctx
from app.services.errors import NodeError
from app.services.llm.gateway import build_gateway
from app.services.matrix import build_matrix
from app.services.settings_store import load_dispatch_config

router = APIRouter(prefix="/workbench", tags=["workbench"])

SYSTEM_PROMPT = """你是 AgentMatrix-SC（供应链智能体矩阵工作台）里的「场景助手」。

工作方式：
1. 你能看到的只有两类事实：调用方给的**场景记忆**，和平台当前的**实时快照**。
   不要编造任何快照之外的数字、单号或人名；快照里没有的就说"快照里没有"。
2. 场景记忆里记的是这个场景的历史交接（上次做到哪、卡在哪、下一步）。
   回答时要接上这份记忆，不要每次从零开始。
3. 输出结构固定三段，用中文，不要客套：
   ① 现状：用快照里的数字说清这个场景现在什么状态（不超过 4 行）
   ② 判断：最值得先处理的一件事，说明依据
   ③ 下一步：3 条可执行的建议，每条写清"做什么 + 在哪做（页面/接口）"
4. 涉及派活时，指明该走哪条工作流；不要假设你能直接改数据。"""


class AskIn(BaseModel):
    scenario: str = Field(min_length=1, max_length=64)
    scenario_name: str = Field(default="", max_length=64)
    memory: str = Field(default="", max_length=12000)
    question: str = Field(min_length=1, max_length=2000)
    use_mock: bool = False


def _snapshot(db: Session) -> dict:
    """平台当前状态的快照：全部来自数据库，不含估算。"""
    task_counts = dict(
        db.execute(select(Task.status, func.count()).group_by(Task.status)).all()
    )
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    run_rows = db.execute(
        select(Run.status, func.count())
        .where(Run.created_at >= since)
        .group_by(Run.status)
    ).all()
    run_counts = {status: count for status, count in run_rows}

    pending_approvals = db.scalar(
        select(func.count()).select_from(Approval).where(Approval.status == "pending")
    ) or 0
    dead_letters = db.scalar(
        select(func.count()).select_from(DeadLetter).where(DeadLetter.status == "pending")
    ) or 0

    matrix = build_matrix(db.scalars(select(Agent).order_by(Agent.code)).all())
    config = load_dispatch_config(db)

    failures = db.scalars(
        select(Run)
        .where(Run.status == "failed")
        .order_by(Run.created_at.desc())
        .limit(3)
    ).all()

    return {
        "tasks": task_counts,
        "runs_24h": run_counts,
        "pending_approvals": int(pending_approvals),
        "pending_dead_letters": int(dead_letters),
        "matrix": {
            "coverage": matrix.get("coverage"),
            "covered_cells": matrix.get("covered_cells"),
            "total_cells": matrix.get("total_cells"),
            "gap_count": matrix.get("gap_count"),
            "gaps": [
                f"{gap['stage_label']} × {gap['category_label']}"
                for gap in matrix.get("gaps", [])
            ],
        },
        "dispatch": {"strategy": config["strategy"], "source": config["source"]},
        "recent_failures": [
            {"run_id": run.id[:8], "error_code": run.error_code} for run in failures
        ],
    }


@router.get("/context")
def workbench_context(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    """外壳的 KPI 面板用它：一次拿到所有数字，不用前端拼五个请求。"""
    return _snapshot(db)


@router.post("/ask")
def ask(
    body: AskIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    snapshot = _snapshot(db)
    started = time.perf_counter()

    user_input = "\n\n".join(
        [
            f"# 当前场景：{body.scenario_name or body.scenario}（id={body.scenario}）",
            "# 场景记忆（交接）\n" + (body.memory.strip() or "（这个场景还没有交接记录）"),
            "# 平台实时快照\n" + json.dumps(snapshot, ensure_ascii=False, indent=2),
            f"# 我的问题\n{body.question.strip()}",
        ]
    )

    gateway = build_gateway("mock" if body.use_mock else None)
    try:
        result = gateway.complete(
            system_prompt=SYSTEM_PROMPT,
            user_input=user_input,
            tier="small",
            agent_code=f"workbench:{body.scenario}",
        )
    except NodeError as exc:
        record(
            db,
            "workbench.ask",
            user=user,
            resource_type="workbench",
            resource_id=body.scenario,
            summary=f"{user.name} 在场景「{body.scenario_name or body.scenario}」提问，模型调用失败：{exc}",
            after={"scenario": body.scenario, "ok": False},
            ctx=ctx,
        )
        db.commit()
        return {
            "ok": False,
            "answer": "",
            "error": str(exc),
            "error_code": exc.code.value,
            "snapshot": snapshot,
        }

    record(
        db,
        "workbench.ask",
        user=user,
        resource_type="workbench",
        resource_id=body.scenario,
        summary=(
            f"{user.name} 在场景「{body.scenario_name or body.scenario}」提问："
            f"{body.question[:60]}"
        ),
        after={
            "scenario": body.scenario,
            "ok": True,
            "tokens": result.token_input + result.token_output,
            "cost_usd": result.cost_usd,
        },
        ctx=ctx,
    )
    db.commit()

    return {
        "ok": True,
        "answer": result.text,
        "provider": result.provider,
        "model": result.model,
        "tokens": result.token_input + result.token_output,
        "cost_usd": result.cost_usd,
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        "snapshot": snapshot,
    }
