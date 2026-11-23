"""幂等种子数据：用户、技能、智能体、工作流。

可通过 ``python -m app.seed`` 反复执行，不会产生重复记录。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Agent,
    AgentVersion,
    AlertRule,
    Skill,
    Task,
    User,
    Workflow,
    WorkflowVersion,
)

# 演示账号；生产环境必须改密码
DEMO_PASSWORD = "AgentMatrix@2026"

USERS = [
    ("admin@agentmatrix.local", "系统管理员", "admin"),
    ("dev@agentmatrix.local", "开发者", "developer"),
    ("ops@agentmatrix.local", "运营专员", "operator"),
    ("viewer@agentmatrix.local", "只读访客", "viewer"),
]

AGENTS = [
    {
        "code": "fulfillment-triage",
        "name": "履约异常处理智能体",
        "stage": "fulfillment",
        "description": "处理订单延迟、缺货、破损等履约异常的诊断与补救建议。",
        "capabilities": ["order_query", "impact_assess", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.95,
        "avg_cost_usd": 0.052,
        "p95_latency_ms": 9400,
        "max_concurrency": 8,
        "system_prompt": "你是履约异常处理专家。基于订单与物流事实，判断影响等级并给出可执行的补救方案。",
    },
    {
        "code": "express-triage",
        "name": "履约应急快线智能体",
        "stage": "fulfillment",
        "description": "面向高优先级、紧 SLA 的履约异常快速处置通道。",
        "capabilities": ["order_query", "impact_assess", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.97,
        "avg_cost_usd": 0.09,
        "p95_latency_ms": 3100,
        "max_concurrency": 4,
        "system_prompt": "你是应急响应专家，需要在极短时间内给出可执行结论，优先保障 SLA。",
    },
    {
        "code": "exception-rules",
        "name": "异常规则引擎",
        "stage": "fulfillment",
        "description": "基于规则库快速判定异常类型，成本极低。",
        "capabilities": ["order_query", "impact_assess", "rule_check", "anomaly_detect"],
        "model_tier": "tool",
        "success_rate": 0.82,
        "avg_cost_usd": 0.0004,
        "p95_latency_ms": 240,
        "max_concurrency": 20,
        "system_prompt": "按规则表匹配异常类型，不做开放式推理。",
    },
    {
        "code": "inventory-optimizer",
        "name": "库存优化智能体",
        "stage": "inventory",
        "description": "计算安全库存与补货建议。",
        "capabilities": ["stock_query", "rule_check", "replenish_calc", "demand_forecast"],
        "model_tier": "small",
        "success_rate": 0.88,
        "avg_cost_usd": 0.006,
        "p95_latency_ms": 1800,
        "max_concurrency": 10,
        "system_prompt": "根据库存、在途与预测计算补货量，输出结构化建议。",
    },
    {
        "code": "demand-planner",
        "name": "需求计划智能体",
        "stage": "demand",
        "description": "周度需求预测与计划编制。",
        "capabilities": ["demand_forecast", "time_series", "replenish_calc", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.93,
        "avg_cost_usd": 0.041,
        "p95_latency_ms": 8200,
        "max_concurrency": 6,
        "system_prompt": "结合历史销量与促销计划做需求预测，并给出置信区间。",
    },
    {
        "code": "logistics-router",
        "name": "物流调度智能体",
        "stage": "logistics",
        "description": "在途异常识别与运输方案调整。",
        "capabilities": ["freight_query", "rule_check", "reasoning"],
        "model_tier": "small",
        "success_rate": 0.86,
        "avg_cost_usd": 0.007,
        "p95_latency_ms": 2100,
        "max_concurrency": 10,
        "system_prompt": "评估运输方案的成本与时效，输出改派建议。",
    },
    {
        "code": "risk-inspector",
        "name": "供应商风险巡检智能体",
        "stage": "risk",
        "description": "供应商交付、质量、舆情风险打分。",
        "capabilities": ["supplier_score", "anomaly_detect", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.91,
        "avg_cost_usd": 0.044,
        "p95_latency_ms": 8800,
        "max_concurrency": 6,
        "system_prompt": "综合交付、质量与外部信号评估供应商风险，给出等级与处置建议。",
    },
    {
        "code": "buyer",
        "name": "采购寻源智能体",
        "stage": "sourcing",
        "description": "供应商准入、比价与合同条款检索。",
        "capabilities": ["supplier_score", "contract_lookup", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.90,
        "avg_cost_usd": 0.038,
        "p95_latency_ms": 7600,
        "max_concurrency": 6,
        "system_prompt": "评估候选供应商资质与报价，检索合同条款，输出寻源建议。",
    },
    # --- 生产协同 ---
    {
        "code": "production-planner",
        "name": "产能编排智能体",
        "stage": "production",
        "description": "按订单交期与产能约束编排生产计划，识别产能瓶颈。",
        "capabilities": ["production_plan", "capacity_check", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.91,
        "avg_cost_usd": 0.042,
        "p95_latency_ms": 8200,
        "max_concurrency": 6,
        "system_prompt": "你是生产计划专家。给定交期、产能与物料约束，输出可执行的生产编排建议，指出瓶颈工序。",
    },
    {
        "code": "workorder-triage",
        "name": "工单异常分诊智能体",
        "stage": "production",
        "description": "识别工单停滞、返工与设备异常，判断是否需要介入。",
        "capabilities": ["workorder_query", "anomaly_detect"],
        "model_tier": "small",
        "success_rate": 0.88,
        "avg_cost_usd": 0.009,
        "p95_latency_ms": 2800,
        "max_concurrency": 16,
        "system_prompt": "你是产线工单分诊员。根据工单状态与历史节拍，判断异常类型与紧急程度。",
    },
    # --- 售后逆向 ---
    {
        "code": "return-inspector",
        "name": "退货核验智能体",
        "stage": "returns",
        "description": "核验退货原因与责任归属，判断是否可退、是否需质检。",
        "capabilities": ["return_inspect", "returns_analyze"],
        "model_tier": "small",
        "success_rate": 0.92,
        "avg_cost_usd": 0.011,
        "p95_latency_ms": 3100,
        "max_concurrency": 12,
        "system_prompt": "你是退货核验员。按退货原因、商品状态与政策，给出可退/需质检/拒退的结论与依据。",
    },
    {
        "code": "reverse-logistics",
        "name": "逆向物流调度智能体",
        "stage": "returns",
        "description": "安排退货取件、回仓与二次上架，计算逆向成本。",
        "capabilities": ["reverse_logistics", "freight_query"],
        "model_tier": "small",
        "success_rate": 0.86,
        "avg_cost_usd": 0.010,
        "p95_latency_ms": 3400,
        "max_concurrency": 20,
        "system_prompt": "你是逆向物流调度员。为退货单安排取件与回仓方案，优先控制逆向成本。",
    },
    # --- 补货与承运商风险（演示场景二、三）---
    {
        "code": "replenishment-planner",
        "name": "补货计划智能体",
        "stage": "demand",
        "description": "结合需求预测与库存水位，给出补货量与补货时点建议。",
        "capabilities": ["demand_forecast", "replenish_calc", "planning"],
        "model_tier": "large",
        "success_rate": 0.92,
        "avg_cost_usd": 0.040,
        "p95_latency_ms": 7800,
        "max_concurrency": 6,
        "system_prompt": (
            "你是补货计划专家。给定需求预测、安全库存与可用库存，判断补货紧迫度，"
            "给出补货数量、时点与依据。要求先给结论，再列关键数字。"
        ),
    },
    {
        "code": "carrier-risk-scout",
        "name": "承运商风险巡检智能体",
        "stage": "logistics",
        "description": "巡检承运商履约风险，定位高风险档位并给出处置建议。",
        "capabilities": ["carrier_signals", "risk_score", "reasoning"],
        "model_tier": "small",
        "success_rate": 0.89,
        "avg_cost_usd": 0.012,
        "p95_latency_ms": 3600,
        "max_concurrency": 12,
        "system_prompt": (
            "你是承运商风险巡检员。根据各档位的延迟率与平均延迟，指出最需要处置的承运商，"
            "给出三条可执行动作，并说明判断依据的具体数字。"
        ),
    },
    # --- 履约诊断域 ---
    {
        "code": "fulfillment-analyst",
        "name": "区域履约诊断智能体",
        "stage": "fulfillment",
        "description": "按地区与运输方式拆解履约指标，定位薄弱环节并给出整改方案。",
        "capabilities": ["fulfillment_stats", "segment_analysis", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.93,
        "avg_cost_usd": 0.045,
        "p95_latency_ms": 8800,
        "max_concurrency": 6,
        "system_prompt": (
            "你是供应链履约诊断专家。给定某地区的履约指标与运输方式拆解，"
            "请指出最需要整改的环节，并给出可执行的三步整改方案。"
            "要求：先给结论，再列依据（引用具体数字），最后给动作；不要泛泛而谈。"
        ),
    },
]

SKILLS = [
    ("order_status_query", "订单状态查询", "data", "builtin", "查询订单与物流状态"),
    ("customer_impact_assess", "客户影响评估", "analysis", "builtin", "计算异常对客户的影响等级"),
    ("notify_customer", "客户通知", "notify", "builtin", "发送延迟致歉与补偿通知"),
    ("inventory_query", "库存可用量查询", "data", "builtin", "查询可用库存与在途"),
    ("supplier_score", "供应商评分", "analysis", "builtin", "计算供应商综合评分"),
    # 履约诊断域技能
    ("region_fulfillment_stats", "区域履约指标", "analysis", "builtin", "按地区聚合延迟率、平均延迟与订单量"),
    # 补货与承运商风险
    ("demand_forecast", "需求预测", "analysis", "builtin", "按品类用真实订单日销量做移动平均外推"),
    ("inventory_snapshot", "库存快照", "data", "builtin", "读取调用方提供的库存与在途（无 WMS）"),
    ("replenish_calc", "补货量计算", "analysis", "builtin", "预测需求 + 安全库存 − 可用库存"),
    ("carrier_signals", "承运商履约信号", "data", "builtin", "按运输方式聚合延迟率与平均延迟"),
    ("risk_score", "承运商风险评分", "analysis", "builtin", "延迟率与延迟深度加权成 0–100 分"),
    ("issue_disposal", "生成处置单", "notify", "builtin", "把风险排序与建议落成处置单产物"),
    ("po_draft", "生成 PO 草稿", "notify", "builtin", "把补货建议落成采购单草稿产物"),
    ("segment_breakdown", "薄弱环节拆解", "analysis", "builtin", "按运输方式与品类拆解，定位最差环节"),
    ("issue_rectification", "下发整改单", "notify", "builtin", "把诊断结论落成整改单产物"),
]

ORDER_DELAY_GRAPH = {
    "entry": "start",
    "required_capabilities": ["order_query", "impact_assess"],
    "nodes": [
        {"id": "start", "type": "start", "next": "fetch_order"},
        {"id": "fetch_order", "type": "skill", "skill": "order_status_query", "next": "assess_impact"},
        {
            "id": "assess_impact",
            "type": "skill",
            "skill": "customer_impact_assess",
            "input_from": ["fetch_order"],
            "next": "evaluate",
        },
        {
            "id": "evaluate",
            "type": "agent",
            "agent_code": "$dispatch",
            "input_from": ["fetch_order", "assess_impact"],
            "next": "gate",
        },
        {
            "id": "gate",
            "type": "condition",
            "expr": "assess_impact.impact_score >= 3",
            "on_true": "approve_remedy",
            "on_false": "notify",
        },
        {"id": "approve_remedy", "type": "approval", "role": "operator", "next": "notify"},
        {
            "id": "notify",
            "type": "skill",
            "skill": "notify_customer",
            "input_from": ["fetch_order"],
            "next": "end",
        },
        {"id": "end", "type": "end"},
    ],
}

# 科研域工作流：用来证明矩阵与调度层不绑定供应链业务
FULFILLMENT_REVIEW_GRAPH = {
    "entry": "start",
    "required_capabilities": ["fulfillment_stats", "segment_analysis"],
    "nodes": [
        {"id": "start", "type": "start", "next": "region_stats"},
        {
            "id": "region_stats",
            "type": "skill",
            "skill": "region_fulfillment_stats",
            "next": "segment",
        },
        {
            "id": "segment",
            "type": "skill",
            "skill": "segment_breakdown",
            "input_from": ["region_stats"],
            "next": "diagnose",
        },
        {
            "id": "diagnose",
            "type": "agent",
            "agent_code": "$dispatch",
            "input_from": ["region_stats", "segment"],
            "next": "gate",
        },
        {
            "id": "gate",
            "type": "condition",
            "expr": "segment.worst_segment.late_rate >= 0.5",
            "on_true": "approve_remedy",
            "on_false": "issue",
        },
        {"id": "approve_remedy", "type": "approval", "role": "operator", "next": "issue"},
        {
            "id": "issue",
            "type": "skill",
            "skill": "issue_rectification",
            "input_from": ["region_stats", "segment", "diagnose"],
            "next": "end",
        },
        {"id": "end", "type": "end"},
    ],
}

REPLENISHMENT_GRAPH = {
    "entry": "start",
    "required_capabilities": ["demand_forecast", "replenish_calc"],
    "nodes": [
        {"id": "start", "type": "start", "next": "forecast"},
        {"id": "forecast", "type": "skill", "skill": "demand_forecast", "next": "inventory"},
        {
            "id": "inventory",
            "type": "skill",
            "skill": "inventory_snapshot",
            "next": "calc",
        },
        {
            "id": "calc",
            "type": "skill",
            "skill": "replenish_calc",
            "input_from": ["forecast", "inventory"],
            "next": "gate",
        },
        {
            "id": "gate",
            "type": "condition",
            "expr": "calc.need_replenish == true",
            "on_true": "approve_plan",
            "on_false": "end",
        },
        {"id": "approve_plan", "type": "approval", "role": "operator", "next": "approve_purchase"},
        {"id": "approve_purchase", "type": "approval", "role": "admin", "next": "po"},
        {
            "id": "po",
            "type": "skill",
            "skill": "po_draft",
            "input_from": ["forecast", "calc"],
            "next": "end",
        },
        {"id": "end", "type": "end"},
    ],
}

SUPPLIER_RISK_GRAPH = {
    "entry": "start",
    "required_capabilities": ["carrier_signals", "risk_score"],
    "nodes": [
        {"id": "start", "type": "start", "next": "signals"},
        {"id": "signals", "type": "skill", "skill": "carrier_signals", "next": "score"},
        {
            "id": "score",
            "type": "skill",
            "skill": "risk_score",
            "input_from": ["signals"],
            "next": "diagnose",
        },
        {
            "id": "diagnose",
            "type": "agent",
            "agent_code": "$dispatch",
            "input_from": ["signals", "score"],
            "next": "gate",
        },
        {
            "id": "gate",
            "type": "condition",
            "expr": "score.worst_score >= 60",
            "on_true": "approve_disposal",
            "on_false": "end",
        },
        {"id": "approve_disposal", "type": "approval", "role": "operator", "next": "disposal"},
        {
            "id": "disposal",
            "type": "skill",
            "skill": "issue_disposal",
            "input_from": ["signals", "score", "diagnose"],
            "next": "end",
        },
        {"id": "end", "type": "end"},
    ],
}

WORKFLOW_SPECS = [
    {
        "code": "order_delay_exception",
        "name": "订单延迟异常闭环",
        "description": "查询订单与物流 → 评估影响 → 智能体诊断 → 条件分流 → 人工审批 → 通知客户",
        "stage": "fulfillment",
        "graph": ORDER_DELAY_GRAPH,
        "variables_schema": {
            "order_id": {
                "type": "string",
                "required": True,
                "label": "订单号",
                "placeholder": "SO-20261122-0001",
                "default": "SO-20261122-0001",
            },
            "quantity": {
                "type": "integer",
                "required": False,
                "label": "订单数量",
                "default": 120,
            },
            "destination": {
                "type": "string",
                "required": False,
                "label": "目的仓",
                "default": "上海中心仓",
            },
        },
    },
    {
        "code": "fulfillment_review",
        "name": "区域履约诊断与整改",
        "description": "聚合区域履约指标 → 拆解薄弱环节 → 智能体诊断 → 条件分流 → 人工审批 → 下发整改单",
        "stage": "fulfillment",
        "graph": FULFILLMENT_REVIEW_GRAPH,
        "variables_schema": {
            "region": {
                "type": "string",
                "required": False,
                "label": "地区（留空自动选延迟最严重的）",
                "placeholder": "Western Europe",
                "default": "",
            },
        },
    },
    {
        "code": "replenishment_weekly",
        "name": "周度补货建议",
        "description": "需求预测 → 库存与在途 → 补货量计算 → 条件分流 → 计划与采购双人审批 → 生成 PO 草稿",
        "stage": "demand",
        "graph": REPLENISHMENT_GRAPH,
        "variables_schema": {
            "category": {
                "type": "string",
                "required": False,
                "label": "品类（留空自动选销量最高）",
                "placeholder": "Men's Footwear",
                "default": "",
            },
            "on_hand": {
                "type": "integer",
                "required": False,
                "label": "当前库存（无 WMS，留空按 0）",
                "default": 0,
            },
        },
    },
    {
        "code": "supplier_risk_patrol",
        "name": "承运商风险巡检",
        "description": "聚合承运商履约信号 → 风险评分 → 智能体诊断 → 高风险审批 → 生成处置单",
        "stage": "logistics",
        "graph": SUPPLIER_RISK_GRAPH,
        "variables_schema": {
            "region": {
                "type": "string",
                "required": False,
                "label": "地区（留空统计全部）",
                "placeholder": "Western Europe",
                "default": "",
            },
        },
    },
]


def seed_users(db) -> int:
    created = 0
    for email, name, role in USERS:
        if db.scalars(select(User).where(User.email == email)).first():
            continue
        db.add(
            User(
                email=email,
                name=name,
                role=role,
                password_hash=hash_password(DEMO_PASSWORD),
                status="active",
            )
        )
        created += 1
    db.commit()
    return created


def seed_skills(db) -> int:
    created = 0
    for code, name, category, type_, description in SKILLS:
        if db.scalars(select(Skill).where(Skill.code == code)).first():
            continue
        db.add(
            Skill(
                code=code,
                name=name,
                category=category,
                type=type_,
                description=description,
                input_schema={"type": "object"},
                output_schema={"type": "object"},
                config={},
                timeout_sec=30,
                status="active",
            )
        )
        created += 1
    db.commit()
    return created


def seed_agents(db, owner_id: str | None) -> int:
    created = 0
    for spec in AGENTS:
        existing = db.scalars(select(Agent).where(Agent.code == spec["code"])).first()
        if existing:
            continue
        agent = Agent(
            code=spec["code"],
            name=spec["name"],
            description=spec["description"],
            stage=spec["stage"],
            capabilities=spec["capabilities"],
            status="active",
            owner_id=owner_id,
            model_tier=spec["model_tier"],
            max_concurrency=spec["max_concurrency"],
            success_rate=spec["success_rate"],
            avg_cost_usd=spec["avg_cost_usd"],
            p95_latency_ms=spec["p95_latency_ms"],
        )
        db.add(agent)
        db.flush()
        db.add(
            AgentVersion(
                agent_id=agent.id,
                version=1,
                system_prompt=spec["system_prompt"],
                model_config={"tier": spec["model_tier"], "provider": "mock"},
                skill_ids=[],
                io_schema={"input": {"type": "object"}, "output": {"type": "object"}},
                guardrails={"max_steps": 8, "allowed_skills": []},
                status="published",
                changelog="初始版本",
                published_at=datetime.now(timezone.utc),
            )
        )
        created += 1
    db.commit()
    return created


def seed_workflows(db, owner_id: str | None) -> int:
    """按需创建工作流/新版本，返回新建的版本总数。

    已发布版本不可变：图有变化时新建版本，而不是原地修改。
    """
    created = 0
    for spec in WORKFLOW_SPECS:
        workflow = db.scalars(select(Workflow).where(Workflow.code == spec["code"])).first()

        if workflow is None:
            workflow = Workflow(
                code=spec["code"],
                name=spec["name"],
                description=spec["description"],
                stage=spec["stage"],
                status="active",
                owner_id=owner_id,
            )
            db.add(workflow)
            db.flush()
            db.add(
                WorkflowVersion(
                    workflow_id=workflow.id,
                    version=1,
                    graph=spec["graph"],
                    variables_schema=spec["variables_schema"],
                    sla_sec=600,
                    changelog="初始版本",
                    status="published",
                    published_at=datetime.now(timezone.utc),
                )
            )
            db.commit()
            created += 1
            continue

        latest = db.scalars(
            select(WorkflowVersion)
            .where(WorkflowVersion.workflow_id == workflow.id)
            .order_by(WorkflowVersion.version.desc())
        ).first()
        if latest is not None and latest.graph == spec["graph"] and latest.variables_schema == spec["variables_schema"]:
            continue

        db.add(
            WorkflowVersion(
                workflow_id=workflow.id,
                version=(latest.version + 1) if latest else 1,
                graph=spec["graph"],
                variables_schema=spec["variables_schema"],
                sla_sec=600,
                changelog="图定义更新",
                status="published",
                published_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
        created += 1

    return created


def seed_alert_rules(db) -> int:
    """默认告警规则；已存在同名规则则跳过。"""
    from app.services.alerts import DEFAULT_RULES

    created = 0
    for spec in DEFAULT_RULES:
        if db.scalars(select(AlertRule).where(AlertRule.name == spec["name"])).first():
            continue
        db.add(AlertRule(**spec))
        created += 1
    db.commit()
    return created


# 已下线的科研域：产品定位为纯供应链，这些记录在 seed 时清除（幂等）
DEPRECATED_WORKFLOWS = ("literature_review",)
DEPRECATED_AGENTS = ("literature-scout", "research-writer")
DEPRECATED_SKILLS = ("literature_search", "relevance_screen", "save_report")


def cleanup_deprecated(db) -> dict[str, int]:
    """移除已下线的科研域数据：工作流（含任务）、智能体、技能。"""
    from sqlalchemy import delete

    removed = {"tasks": 0, "workflows": 0, "agents": 0, "skills": 0}

    for code in DEPRECATED_WORKFLOWS:
        wf = db.scalars(select(Workflow).where(Workflow.code == code)).first()
        if wf is None:
            continue
        # 先删任务（runs / steps / approvals / artifacts 由外键级联）
        result = db.execute(delete(Task).where(Task.workflow_id == wf.id))
        removed["tasks"] += result.rowcount or 0
        db.execute(delete(Workflow).where(Workflow.id == wf.id))
        removed["workflows"] += 1

    for code in DEPRECATED_AGENTS:
        agent = db.scalars(select(Agent).where(Agent.code == code)).first()
        if agent is None:
            continue
        db.execute(delete(Agent).where(Agent.id == agent.id))
        removed["agents"] += 1

    for code in DEPRECATED_SKILLS:
        skill = db.scalars(select(Skill).where(Skill.code == code)).first()
        if skill is None:
            continue
        db.execute(delete(Skill).where(Skill.id == skill.id))
        removed["skills"] += 1

    db.commit()
    return removed


def main() -> int:
    db = SessionLocal()
    try:
        cleaned = cleanup_deprecated(db)
        users = seed_users(db)
        skills = seed_skills(db)
        admin = db.scalars(select(User).where(User.role == "admin")).first()
        agents = seed_agents(db, admin.id if admin else None)
        workflow_versions = seed_workflows(db, admin.id if admin else None)
        alert_rules = seed_alert_rules(db)
        print(
            f"种子完成：新增用户 {users}、技能 {skills}、智能体 {agents}、"
            f"工作流版本 {workflow_versions}、告警规则 {alert_rules}"
        )
        if any(cleaned.values()):
            print(
                f"清理下线科研域：工作流 {cleaned['workflows']}、任务 {cleaned['tasks']}、"
                f"智能体 {cleaned['agents']}、技能 {cleaned['skills']}"
            )
        print(f"演示账号密码：{DEMO_PASSWORD}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
