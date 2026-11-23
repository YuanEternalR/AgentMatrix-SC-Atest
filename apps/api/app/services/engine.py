"""工作流执行器（最小闭环：start / skill / agent / condition / approval / end）。

设计要点：
* 状态全部落库，进程重启后可从 ``run.cursor_node_id`` 继续；
* 审批节点是唯一暂停点，产出 Approval 记录后立即释放执行权；
* 条件表达式**不使用 eval**，只做受限比较，避免任意代码执行。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Agent, AgentVersion, Approval, DeadLetter, Run, RunStep, WorkflowVersion
from app.services.errors import RETRYABLE, backoff_seconds, classify
from app.services.llm.gateway import LLMGateway
from app.services.skill_runtime import execute_skill

logger = logging.getLogger("agentmatrix.engine")

MAX_NODES_PER_RUN = 100
DEFAULT_MAX_ATTEMPTS = 3

NodeType = Literal["start", "skill", "agent", "condition", "approval", "end"]


@dataclass(slots=True)
class EngineOutcome:
    status: Literal["paused", "succeeded", "failed", "retrying"]
    message: str = ""


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# 条件表达式：受限语法，不 eval
# ---------------------------------------------------------------------------

_COMPARE_RE = re.compile(
    r"^\s*(?P<path>[A-Za-z0-9_.]+)\s*(?P<op>>=|<=|==|!=|>|<)\s*(?P<value>.+?)\s*$"
)
_IN_RE = re.compile(
    r"^\s*(?P<path>[A-Za-z0-9_.]+)\s+in\s+\[(?P<items>.*)\]\s*$"
)


class ExpressionError(ValueError):
    """表达式非法或引用了不存在的路径。"""


def _resolve(context: dict[str, Any], path: str) -> Any:
    current: Any = context
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            raise ExpressionError(f"路径不存在：{path}")
        current = current[part]
    return current


def _literal(raw: str) -> Any:
    raw = raw.strip()
    if raw in {"true", "True"}:
        return True
    if raw in {"false", "False"}:
        return False
    if raw in {"null", "None"}:
        return None
    if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
        return raw[1:-1]
    try:
        return float(raw) if "." in raw else int(raw)
    except ValueError:
        return raw


def evaluate_condition(expr: str, context: dict[str, Any]) -> bool:
    """只支持 比较 / in / 空值判断。"""
    match = _IN_RE.match(expr)
    if match:
        left = _resolve(context, match.group("path"))
        items = [_literal(x) for x in match.group("items").split(",") if x.strip()]
        return left in items

    match = _COMPARE_RE.match(expr)
    if not match:
        raise ExpressionError(f"不支持的条件表达式：{expr!r}")

    left = _resolve(context, match.group("path"))
    right = _literal(match.group("value"))
    op = match.group("op")

    if op == "==":
        return left == right
    if op == "!=":
        return left != right
    if left is None or right is None:
        raise ExpressionError(f"无法比较空值：{expr!r}")
    if op == ">=":
        return left >= right
    if op == "<=":
        return left <= right
    if op == ">":
        return left > right
    return left < right


# ---------------------------------------------------------------------------
# 执行
# ---------------------------------------------------------------------------


def _graph_nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    nodes = graph.get("nodes") or []
    return {node["id"]: node for node in nodes}


def _next_node(node: dict[str, Any], context: dict[str, Any]) -> str | None:
    if node["type"] == "condition":
        branch = node.get("on_true") if evaluate_condition(node["expr"], context) else node.get("on_false")
        return branch
    return node.get("next")


def _context_inputs(run: Run, task_payload: dict[str, Any], node: dict[str, Any]) -> dict[str, Any]:
    """节点输入 = 任务 payload + 上游节点输出打平。"""
    inputs: dict[str, Any] = dict(task_payload)
    sources = node.get("input_from") or []
    context = run.context or {}
    for source in sources:
        upstream = context.get(source)
        if isinstance(upstream, dict):
            inputs.update(upstream)
    return inputs


def execute_run(db: Session, run: Run, gateway: LLMGateway) -> EngineOutcome:
    """从当前游标推进运行，直到结束、失败或暂停在审批。"""
    version = db.get(WorkflowVersion, run.workflow_version_id) if run.workflow_version_id else None
    if version is None:
        _fail(db, run, "WORKFLOW_VERSION_MISSING", "运行未绑定工作流版本")
        return EngineOutcome("failed", "缺少工作流版本")

    nodes = _graph_nodes(version.graph or {})
    cursor = run.cursor_node_id or (version.graph or {}).get("entry")
    if not cursor:
        _fail(db, run, "GRAPH_INVALID", "工作流缺少入口节点")
        return EngineOutcome("failed", "工作流缺少入口节点")

    run.status = "running"
    run.started_at = run.started_at or now()
    db.commit()

    from app.models import Task  # 局部导入避免循环

    task = db.get(Task, run.task_id)
    task_payload = (task.payload or {}) if task else {}
    context: dict[str, Any] = dict(run.context or {})

    for _ in range(MAX_NODES_PER_RUN):
        node = nodes.get(cursor)
        if node is None:
            _fail(db, run, "NODE_MISSING", f"节点不存在：{cursor}")
            return EngineOutcome("failed", f"节点不存在：{cursor}")

        node_type: str = node["type"]

        # 同一节点的执行次数：重试会生成新的步骤记录，便于逐次审计
        prior_attempts = db.scalar(
            select(func.count())
            .select_from(RunStep)
            .where(RunStep.run_id == run.id, RunStep.node_id == cursor)
        ) or 0
        attempt = int(prior_attempts) + 1

        step_input = _context_inputs(run, task_payload, node)
        # 技能实现可据此判断"这是第几次尝试"（用于故障注入演示）
        step_input["_attempt"] = attempt

        step = RunStep(
            run_id=run.id,
            node_id=cursor,
            node_type=node_type,
            status="running",
            attempt=attempt,
            started_at=now(),
            input=step_input,
        )
        db.add(step)
        db.commit()

        try:
            if node_type == "end":
                step.status = "succeeded"
                step.finished_at = now()
                step.output = {"finished": True}
                run.cursor_node_id = None
                _finish(db, run, "succeeded")
                return EngineOutcome("succeeded", "运行成功")

            if node_type == "approval":
                step.status = "waiting_approval"
                step.output = {"awaiting_role": node.get("role", "operator")}
                approval = Approval(
                    run_id=run.id,
                    step_id=step.id,
                    status="pending",
                    assignee_role=node.get("role", "operator"),
                    due_at=None,
                )
                db.add(approval)
                run.status = "waiting_approval"
                run.cursor_node_id = node.get("next")
                # 上下文必须落库：恢复时 execute_run 会重新读取 run.context
                run.context = dict(context)
                _sync_task_status(db, run)
                db.commit()
                return EngineOutcome("paused", "等待人工审批")

            if node_type == "skill":
                # 统一走 execute_skill：技能类型（内置 / HTTP）在这里分派，
                # 每次执行都会写一条 skill_runs，列表页的耗时与成功率才有真实来源
                output = dict(execute_skill(db, node.get("skill", ""), step.input).output)
                # 产物内容单独落 artifacts 表，避免步骤输出里重复存一份
                content = output.pop("content", None)
                step.output = output
                step.status = "succeeded"
                step.finished_at = now()
                context[cursor] = output

                if output.get("artifact_id") and content:
                    from app.models import Artifact

                    db.add(
                        Artifact(
                            run_id=run.id,
                            step_id=step.id,
                            name=str(output.get("name") or "artifact"),
                            mime=str(output.get("mime") or "text/plain"),
                            uri=str(output.get("uri") or ""),
                            size=len(str(content).encode("utf-8")),
                            content=str(content),
                        )
                    )

            elif node_type == "agent":
                agent_code = node.get("agent_code", "")
                resolution = "graph"
                if agent_code == "$dispatch":
                    # 由调度决策决定执行者，把"规划 → 执行"真正串起来
                    from app.models import DispatchDecision as DispatchDecisionRow

                    decision_row = db.scalars(
                        select(DispatchDecisionRow)
                        .where(DispatchDecisionRow.task_id == run.task_id)
                        .order_by(DispatchDecisionRow.created_at.desc())
                    ).first()
                    if decision_row is None or not decision_row.agent_code:
                        raise RuntimeError("任务没有可用的调度决策，无法确定执行智能体")
                    agent_code = decision_row.agent_code
                    resolution = f"dispatch:{decision_row.strategy}"

                agent = db.scalars(select(Agent).where(Agent.code == agent_code)).first()
                if agent is None:
                    raise RuntimeError(f"智能体不存在：{agent_code}")
                version_row = db.scalars(
                    select(AgentVersion)
                    .where(AgentVersion.agent_id == agent.id, AgentVersion.status == "published")
                    .order_by(AgentVersion.version.desc())
                ).first()
                if version_row is None:
                    raise RuntimeError(f"智能体 {agent_code} 没有已发布版本")

                result = gateway.complete(
                    system_prompt=version_row.system_prompt,
                    user_input=str(step.input),
                    tier=agent.model_tier,
                    agent_code=agent_code,
                )
                step.output = {
                    "text": result.text,
                    "model": result.model,
                    "agent_code": agent_code,
                    "agent_version": version_row.version,
                    "resolved_by": resolution,
                }
                step.agent_version_id = version_row.id
                step.tokens = result.token_input + result.token_output
                step.cost_usd = result.cost_usd
                step.status = "succeeded"
                step.finished_at = now()
                context[cursor] = step.output

                run.token_input += result.token_input
                run.token_output += result.token_output
                run.cost_usd = float(run.cost_usd or 0) + result.cost_usd

            elif node_type in {"start", "condition"}:
                if node_type == "condition":
                    # 记录判定结果，便于前端展示走了哪一支
                    branch = _next_node(node, context)
                    step.output = {"branch": branch, "expr": node.get("expr")}
                else:
                    step.output = {"started": True}
                step.status = "succeeded"
                step.finished_at = now()

            else:
                raise RuntimeError(f"未知节点类型：{node_type}")

            # 每个节点成功后都刷新一次上下文快照，保证暂停/恢复后不丢上游输出
            run.context = dict(context)
            db.commit()
            cursor = _next_node(node, context)
            run.cursor_node_id = cursor
            if cursor is None:
                _finish(db, run, "succeeded")
                return EngineOutcome("succeeded", "运行成功")
            db.commit()

        except ExpressionError as exc:
            # 表达式写错是配置问题，重试没有意义
            _fail_step(db, step, run, "VALIDATION", str(exc))
            return EngineOutcome("failed", str(exc))
        except Exception as exc:  # noqa: BLE001 - 节点失败必须落库后再决定重试或死信
            code = classify(exc)
            max_attempts = int(node.get("max_attempts", DEFAULT_MAX_ATTEMPTS))
            can_retry = code in RETRYABLE and attempt < max_attempts

            if can_retry:
                delay = backoff_seconds(attempt)
                step.status = "retrying"
                step.finished_at = now()
                step.error = {
                    "code": code.value,
                    "message": str(exc)[:500],
                    "retry_in_sec": delay,
                    "next_attempt": attempt + 1,
                }
                # 游标不前进：下次从同一个节点重新执行
                run.status = "queued"
                run.next_attempt_at = now() + timedelta(seconds=delay)
                run.cursor_node_id = cursor
                run.context = dict(context)
                db.commit()
                logger.warning(
                    "节点失败可重试 run=%s node=%s code=%s attempt=%s/%s %.1fs",
                    run.id, cursor, code.value, attempt, max_attempts, delay,
                )
                return EngineOutcome(
                    "retrying",
                    f"第 {attempt}/{max_attempts} 次失败（{code.value}），{delay}s 后重试",
                )

            logger.exception("节点执行失败 run=%s node=%s code=%s", run.id, cursor, code.value)
            # 死信与失败状态必须在同一次提交里落库，否则外部可能看到"已失败但无死信"
            db.add(
                DeadLetter(
                    run_id=run.id,
                    task_id=run.task_id,
                    node_id=cursor,
                    error_code=code.value,
                    message=str(exc)[:1000],
                    attempts=attempt,
                    status="pending",
                )
            )
            _fail_step(db, step, run, code.value, f"{type(exc).__name__}: {exc}")
            return EngineOutcome("failed", f"{code.value}: {exc}")

    _fail(db, run, "STEP_LIMIT_EXCEEDED", f"超过单次运行节点上限 {MAX_NODES_PER_RUN}")
    return EngineOutcome("failed", "节点数超限")


def _finish(db: Session, run: Run, status: str) -> None:
    run.status = status
    run.finished_at = now()
    _sync_task_status(db, run)
    db.commit()


def _fail(db: Session, run: Run, code: str, message: str) -> None:
    run.status = "failed"
    run.error_code = code
    run.finished_at = now()
    _sync_task_status(db, run)
    db.commit()
    logger.warning("运行失败 run=%s code=%s msg=%s", run.id, code, message)


def _sync_task_status(db: Session, run: Run) -> None:
    """任务状态跟随运行状态，避免列表里任务永远停在 queued。"""
    from app.models import Task

    task = db.get(Task, run.task_id)
    if task is None:
        return
    mapping = {
        "queued": "queued",
        "running": "running",
        "waiting_approval": "waiting_approval",
        "succeeded": "succeeded",
        "failed": "failed",
        "canceled": "canceled",
        "timed_out": "timed_out",
    }
    task.status = mapping.get(run.status, task.status)


def _fail_step(db: Session, step: RunStep, run: Run, code: str, message: str) -> None:
    step.status = "failed"
    step.finished_at = now()
    step.error = {"code": code, "message": message[:1000]}
    db.commit()
    _fail(db, run, code, message)
