"""智能体矩阵：把「阶段 × 能力类型」组织成网格，用于覆盖与缺口分析。

能力标签到能力类型的映射集中在这里，改一处即可影响矩阵视图与覆盖率统计。
"""

from __future__ import annotations

from typing import Iterable, Protocol

STAGES: tuple[tuple[str, str], ...] = (
    ("demand", "需求计划"),
    ("sourcing", "采购寻源"),
    ("inventory", "仓储库存"),
    ("logistics", "运输物流"),
    ("fulfillment", "履约交付"),
    ("risk", "合规风控"),
    ("research", "科研流程"),
)

CATEGORIES: tuple[tuple[str, str], ...] = (
    ("perception", "感知与解析"),
    ("analysis", "分析与预测"),
    ("planning", "决策与规划"),
    ("execution", "执行与协同"),
)

# 产业关联度：把 2020 年投入产出表的 153 个部门按阶段汇总后的系数。
# 来源与算法见 docs/experiments/matrix-stage-basis.md，复现脚本 scripts/map_stages.py。
# 影响力高 = 该阶段波动会放大到上游；感应度高 = 该阶段容易被上游拖累。
INDUSTRY_COEFFICIENTS: dict[str, dict[str, float]] = {
    "demand": {"influence": 0.733, "sensitivity": 2.539, "output_share": 0.083, "sectors": 6},
    "sourcing": {"influence": 0.949, "sensitivity": 2.395, "output_share": 0.254, "sectors": 40},
    "inventory": {"influence": 0.993, "sensitivity": 0.916, "output_share": 0.004, "sectors": 1},
    "logistics": {"influence": 0.944, "sensitivity": 1.259, "output_share": 0.045, "sectors": 13},
    "fulfillment": {"influence": 1.105, "sensitivity": 0.890, "output_share": 0.413, "sectors": 81},
    "risk": {"influence": 0.711, "sensitivity": 2.725, "output_share": 0.150, "sectors": 7},
    "research": {"influence": 0.791, "sensitivity": 0.548, "output_share": 0.052, "sectors": 5},
}

# 能力标签 -> 能力类型；未登记的标签归入「执行与协同」
CAPABILITY_CATEGORY: dict[str, str] = {
    # 感知与解析
    "order_query": "perception",
    "stock_query": "perception",
    "freight_query": "perception",
    "literature_search": "perception",
    "contract_lookup": "perception",
    "document_parse": "perception",
    # 分析与预测
    "impact_assess": "analysis",
    "demand_forecast": "analysis",
    "supplier_score": "analysis",
    "anomaly_detect": "analysis",
    "relevance_screen": "analysis",
    "time_series": "analysis",
    # 决策与规划
    "reasoning": "planning",
    "replenish_calc": "planning",
    "synthesis": "planning",
    # 执行与协同
    "rule_check": "execution",
    "notify": "execution",
    "writing": "execution",
    "save_report": "execution",
}


class AgentLike(Protocol):
    code: str
    name: str
    stage: str
    capabilities: list[str]
    model_tier: str
    success_rate: float


def category_of(capability: str) -> str:    return CAPABILITY_CATEGORY.get(capability, "execution")


def build_matrix(agents: Iterable[AgentLike]) -> dict:
    """返回 阶段 × 能力 的网格、覆盖率与缺口。"""
    agent_list = list(agents)

    # 出现过的非标准阶段也纳入网格，避免数据里新增阶段被静默丢弃
    known_stages = {code for code, _ in STAGES}
    stages = list(STAGES)
    for agent in agent_list:
        if agent.stage not in known_stages:
            stages.append((agent.stage, agent.stage))
            known_stages.add(agent.stage)

    # (stage, category) -> 智能体
    cells: dict[tuple[str, str], list[dict]] = {}
    for agent in agent_list:
        categories = {category_of(cap) for cap in (agent.capabilities or [])}
        for category in categories:
            cells.setdefault((agent.stage, category), []).append(
                {
                    "code": agent.code,
                    "name": agent.name,
                    "model_tier": agent.model_tier,
                    "success_rate": agent.success_rate,
                    "capabilities": agent.capabilities or [],
                }
            )

    grid = []
    gaps = []
    for stage_code, stage_label in stages:
        for category_code, category_label in CATEGORIES:
            members = sorted(cells.get((stage_code, category_code), []), key=lambda a: a["code"])
            covered = bool(members)
            grid.append(
                {
                    "stage": stage_code,
                    "stage_label": stage_label,
                    "category": category_code,
                    "category_label": category_label,
                    "agents": members,
                    "covered": covered,
                }
            )
            if not covered:
                gaps.append(
                    {
                        "stage": stage_code,
                        "stage_label": stage_label,
                        "category": category_code,
                        "category_label": category_label,
                    }
                )

    total = len(grid)
    covered_count = total - len(gaps)

    return {
        "stages": [
            {"code": c, "label": l, "industry": INDUSTRY_COEFFICIENTS.get(c)}
            for c, l in stages
        ],
        "categories": [{"code": c, "label": l} for c, l in CATEGORIES],
        "cells": grid,
        "coverage": round(covered_count / total, 4) if total else 0.0,
        "total_cells": total,
        "covered_cells": covered_count,
        "gap_count": len(gaps),
        "gaps": gaps,
        "agent_count": len(agent_list),
    }
