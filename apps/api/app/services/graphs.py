"""可视化数据聚合：协作拓扑、任务流转桑基、业务看板。

全部基于数据库中的真实运行记录与种子数据，不写死在前端。
"""

from __future__ import annotations

import hashlib
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    BusinessDaily,
    DispatchDecision,
    Run,
    RunStep,
    Task,
    WorkflowVersion,
)

# 业务看板种子：每天生成一条，30 天
BUSINESS_SEED_DAYS = 30


def _skill_and_agent_names(graph: dict) -> tuple[dict[str, str], str | None]:
    """从工作流图里解析 node_id → 技能编码 / 智能体编码。"""
    skills: dict[str, str] = {}
    for node in graph.get("nodes", []):
        if node.get("type") == "skill" and node.get("skill"):
            skills[node["id"]] = node["skill"]
    return skills, None


def build_collaboration(db: Session, limit_runs: int = 200) -> dict:
    """智能体 ↔ 技能 的调用拓扑：边权重 = 相邻调用次数。

    做法：取每个运行按时间排序的步骤序列，相邻两步若一方是智能体节点、
    一方是技能节点，就记一条有向边。
    """
    runs = db.scalars(
        select(Run).where(Run.status.in_(("succeeded", "failed", "waiting_approval")))
        .order_by(Run.created_at.desc())
        .limit(limit_runs)
    ).all()

    if not runs:
        return {"nodes": [], "edges": [], "run_count": 0}

    version_ids = {r.workflow_version_id for r in runs if r.workflow_version_id}
    versions = {
        v.id: v for v in db.scalars(select(WorkflowVersion).where(WorkflowVersion.id.in_(version_ids))).all()
    } if version_ids else {}

    node_kind: dict[tuple[str, str], str] = {}  # (version_id, node_id) -> label
    edges: Counter[tuple[str, str]] = Counter()
    node_calls: Counter[str] = Counter()

    for run in runs:
        version = versions.get(run.workflow_version_id or "")
        if version is None:
            continue
        skill_names, _ = _skill_and_agent_names(version.graph or {})

        steps = db.scalars(
            select(RunStep)
            .where(RunStep.run_id == run.id)
            .order_by(RunStep.started_at.asc())
        ).all()
        if len(steps) < 2:
            continue

        labels: list[str] = []
        for step in steps:
            if step.node_type == "agent":
                # 智能体节点：优先用步骤输出里记录的实际执行者
                label = str(step.output.get("agent_code") or step.node_id)
                node_kind[(version.id, step.node_id)] = label
                kind = "agent"
            elif step.node_type == "skill":
                label = skill_names.get(step.node_id, step.node_id)
                node_kind[(version.id, step.node_id)] = label
                kind = "skill"
            else:
                labels.append("")  # start/condition/approval/end 不参与拓扑
                continue
            labels.append(f"{kind}::{label}")
            node_calls[label] += 1

        for left, right in zip(labels, labels[1:]):
            if not left or not right or left == right:
                continue
            edges[(left, right)] += 1

    node_ids = {part for edge in edges for part in edge}
    nodes = []
    for key in sorted(node_ids):
        kind, label = key.split("::", 1)
        nodes.append(
            {
                "id": key,
                "name": label,
                "kind": kind,
                "calls": node_calls.get(label, 0),
            }
        )

    return {
        "nodes": nodes,
        "edges": [
            {"source": s, "target": t, "weight": w}
            for (s, t), w in sorted(edges.items(), key=lambda kv: -kv[1])
        ],
        "run_count": len(runs),
    }


def build_sankey(db: Session, limit_tasks: int = 500) -> dict:
    """任务流转桑基：来源 → 执行智能体 → 结果。"""
    tasks = db.scalars(select(Task).order_by(Task.created_at.desc()).limit(limit_tasks)).all()
    if not tasks:
        return {"nodes": [], "links": []}

    agent_by_task = {
        task_id: code
        for task_id, code in db.execute(
            select(DispatchDecision.task_id, DispatchDecision.agent_code)
        ).all()
        if code
    }
    run_status = {
        task_id: status
        for task_id, status in db.execute(select(Run.task_id, Run.status)).all()
    }

    source_label = {"api": "API 调用", "manual": "手动发起", "cron": "定时任务", "webhook": "事件触发", "subtask": "子任务"}
    status_label = {
        "succeeded": "成功",
        "failed": "失败",
        "canceled": "取消",
        "waiting_approval": "审批中",
        "queued": "排队中",
        "running": "执行中",
        "timed_out": "超时",
    }

    nodes: dict[str, str] = {}  # name -> layer
    links: Counter[tuple[str, str]] = Counter()

    for task in tasks:
        src = source_label.get(task.source, task.source)
        nodes.setdefault(src, "source")

        agent = agent_by_task.get(task.id)
        if not agent:
            nodes.setdefault("未分配", "agent")
            links[(src, "未分配")] += 1
            continue
        nodes.setdefault(agent, "agent")
        links[(src, agent)] += 1

        status = run_status.get(task.id) or task.status
        result = status_label.get(status, status)
        nodes.setdefault(result, "result")
        links[(agent, result)] += 1

    return {
        "nodes": [{"name": name, "layer": layer} for name, layer in nodes.items()],
        "links": [{"source": s, "target": t, "value": v} for (s, t), v in links.items()],
    }


def ensure_business_seed(db: Session, days: int = BUSINESS_SEED_DAYS) -> int:
    """幂等生成业务日指标（相对今天回填）。"""
    existing = {
        row for (row,) in db.execute(select(BusinessDaily.day)).all()
    }
    today = date.today()
    created = 0

    for offset in range(days):
        day = (today - timedelta(days=days - 1 - offset)).isoformat()
        if day in existing:
            continue
        digest = hashlib.sha256(f"biz|{day}".encode()).hexdigest()
        # 用哈希生成确定性波动，避免每次跑出来不一样
        wave = int(digest[:4], 16) / 65535
        risk = int(digest[4:6], 16) % 9

        db.add(
            BusinessDaily(
                day=day,
                otif_rate=round(0.90 + 0.07 * wave, 4),
                inventory_turnover=round(5.2 + 1.6 * wave, 2),
                stockout_rate=round(0.012 + 0.02 * (1 - wave), 4),
                supplier_risk_high=risk % 4,
                supplier_risk_medium=2 + risk % 6,
                supplier_risk_low=8 + risk % 10,
                logistics_cost_usd=round(11800 + 2600 * wave, 2),
            )
        )
        created += 1

    if created:
        db.commit()
    return created


def business_dashboard(db: Session, days: int = 30) -> dict:
    ensure_business_seed(db)

    rows = db.scalars(
        select(BusinessDaily).order_by(BusinessDaily.day.desc()).limit(days)
    ).all()
    rows = list(reversed(rows))

    return {
        "days": [r.day for r in rows],
        "otif_rate": [r.otif_rate for r in rows],
        "inventory_turnover": [r.inventory_turnover for r in rows],
        "stockout_rate": [r.stockout_rate for r in rows],
        "logistics_cost_usd": [r.logistics_cost_usd for r in rows],
        "supplier_risk": {
            "high": [r.supplier_risk_high for r in rows],
            "medium": [r.supplier_risk_medium for r in rows],
            "low": [r.supplier_risk_low for r in rows],
        },
        "latest": {
            "otif_rate": rows[-1].otif_rate if rows else 0.0,
            "inventory_turnover": rows[-1].inventory_turnover if rows else 0.0,
            "stockout_rate": rows[-1].stockout_rate if rows else 0.0,
            "logistics_cost_usd": rows[-1].logistics_cost_usd if rows else 0.0,
        },
        "seeded": True,
    }
