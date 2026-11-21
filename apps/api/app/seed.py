"""幂等种子数据：用户、技能、智能体、工作流。

可通过 ``python -m app.seed`` 反复执行，不会产生重复记录。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Agent, AgentVersion, AlertRule, Skill, User, Workflow, WorkflowVersion

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
    # --- 科研域：证明矩阵可跨业务域复用 ---
    {
        "code": "literature-scout",
        "name": "文献检索智能体",
        "stage": "research",
        "description": "按主题检索文献并做相关性初筛。",
        "capabilities": ["literature_search", "relevance_screen", "reasoning"],
        "model_tier": "small",
        "success_rate": 0.89,
        "avg_cost_usd": 0.008,
        "p95_latency_ms": 2600,
        "max_concurrency": 12,
        "system_prompt": "围绕研究主题检索文献，按相关性与年份筛选，输出结构化清单。",
    },
    {
        "code": "research-writer",
        "name": "综述撰写智能体",
        "stage": "research",
        "description": "基于文献要点组织综述结构与段落。",
        "capabilities": ["synthesis", "writing", "reasoning"],
        "model_tier": "large",
        "success_rate": 0.94,
        "avg_cost_usd": 0.048,
        "p95_latency_ms": 9000,
        "max_concurrency": 6,
        "system_prompt": "把文献要点归纳为有结构的综述草稿，标注引用来源，避免臆造结论。",
    },
]

SKILLS = [
    ("order_status_query", "订单状态查询", "data", "builtin", "查询订单与物流状态"),
    ("customer_impact_assess", "客户影响评估", "analysis", "builtin", "计算异常对客户的影响等级"),
    ("notify_customer", "客户通知", "notify", "builtin", "发送延迟致歉与补偿通知"),
    ("inventory_query", "库存可用量查询", "data", "builtin", "查询可用库存与在途"),
    ("supplier_score", "供应商评分", "analysis", "builtin", "计算供应商综合评分"),
    # 科研域技能
    ("literature_search", "文献检索", "data", "builtin", "按主题检索候选文献"),
    ("relevance_screen", "相关性筛选", "analysis", "builtin", "按相关性阈值筛选文献"),
    ("save_report", "报告归档", "notify", "builtin", "把生成的综述草稿存为产物"),
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
LITERATURE_GRAPH = {
    "entry": "start",
    "required_capabilities": ["literature_search", "relevance_screen"],
    "nodes": [
        {"id": "start", "type": "start", "next": "search"},
        {"id": "search", "type": "skill", "skill": "literature_search", "next": "screen"},
        {
            "id": "screen",
            "type": "skill",
            "skill": "relevance_screen",
            "input_from": ["search"],
            "next": "extract",
        },
        {
            "id": "extract",
            "type": "agent",
            "agent_code": "$dispatch",
            "input_from": ["search", "screen"],
            "next": "draft",
        },
        {
            "id": "draft",
            "type": "agent",
            "agent_code": "research-writer",
            "input_from": ["extract"],
            "next": "review",
        },
        {"id": "review", "type": "approval", "role": "operator", "next": "publish"},
        {
            "id": "publish",
            "type": "skill",
            "skill": "save_report",
            "input_from": ["draft", "screen"],
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
        "variables_schema": {"order_id": {"type": "string", "required": True}},
    },
    {
        "code": "literature_review",
        "name": "文献检索与综述生成",
        "description": "检索文献 → 相关性筛选 → 智能体提炼要点 → 综述撰写 → 人工审阅 → 归档草稿",
        "stage": "research",
        "graph": LITERATURE_GRAPH,
        "variables_schema": {"topic": {"type": "string", "required": True}},
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
        if latest is not None and latest.graph == spec["graph"]:
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


def main() -> int:
    db = SessionLocal()
    try:
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
        print(f"演示账号密码：{DEMO_PASSWORD}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
