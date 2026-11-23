"""智能体：注册、草稿/发布版本、在线测试、运行记录。

规格 5.2 的落点。三个关键决定：

1. **运行锁定版本**。执行器只认 ``status='published'`` 的最新版本，
   编辑中的草稿不会影响线上行为——这是"版本不可变"的实际意义。
2. **在线测试就是真的跑一遍**：先按绑定技能逐个执行（工具轨迹有真实耗时），
   再把输入与技能结果交给模型。Mock 与真实模型走同一条代码路径，只是 Provider 不同。
3. **测试可以不发布**：先测草稿、满意再发布，避免"为了测一下先污染线上版本"。
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import Agent, AgentVersion, RunStep, Skill, User
from app.services.audit import AuditCtx, record, request_ctx
from app.services.errors import ErrorCode, NodeError
from app.services.llm.gateway import build_gateway
from app.services.skill_runtime import execute_skill

router = APIRouter(prefix="/agents", tags=["agents"])

# 与 dispatch 层的 ModelTier 一致
TIER_LABELS = {"large": "大模型", "small": "小模型", "tool": "工具"}


class AgentIn(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=500)
    stage: str = Field(default="fulfillment", max_length=32)
    capabilities: list[str] = Field(default_factory=list)
    model_tier: str = Field(default="small", pattern="^(large|small|tool)$")
    max_concurrency: int = Field(default=8, ge=1, le=64)
    p95_latency_ms: int = Field(default=2000, ge=50)
    avg_cost_usd: float = Field(default=0.01, ge=0)
    success_rate: float = Field(default=0.9, ge=0, le=1)
    # 初始内容：不发布时就是草稿
    system_prompt: str = Field(default="", max_length=8000)
    skill_ids: list[str] = Field(default_factory=list)


class AgentPatch(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    stage: str | None = Field(default=None, max_length=32)
    capabilities: list[str] | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|disabled)$")
    model_tier: str | None = Field(default=None, pattern="^(large|small|tool)$")
    max_concurrency: int | None = Field(default=None, ge=1, le=64)
    p95_latency_ms: int | None = Field(default=None, ge=50)
    avg_cost_usd: float | None = Field(default=None, ge=0)
    success_rate: float | None = Field(default=None, ge=0, le=1)


class AgentVersionIn(BaseModel):
    system_prompt: str = Field(min_length=1, max_length=8000)
    # 注意：字段不能叫 model_config —— 那是 Pydantic v2 的保留配置名，
    # 直接定义会与 ConfigDict 冲突（TypeError: 'FieldInfo' object is not iterable）。
    # 对外仍用 model_config 这个名字，靠 alias 保持一致。
    llm_config: dict = Field(default_factory=dict, alias="model_config")
    skill_ids: list[str] = Field(default_factory=list)
    io_schema: dict = Field(default_factory=dict)
    guardrails: dict = Field(default_factory=dict)
    changelog: str = Field(default="", max_length=500)
    # False = 只存草稿；True = 立即发布并归档上一个已发布版本
    publish: bool = True


class AgentTestIn(BaseModel):
    input: dict = Field(default_factory=dict)
    # use_mock=true 时强制走 Mock Provider，便于离线演示
    use_mock: bool = False


def _version_dict(version: AgentVersion | None) -> dict | None:
    if version is None:
        return None
    return {
        "id": version.id,
        "version": version.version,
        "status": version.status,
        "system_prompt": version.system_prompt,
        "model_config": version.model_config or {},
        "skill_ids": version.skill_ids or [],
        "io_schema": version.io_schema or {},
        "guardrails": version.guardrails or {},
        "changelog": version.changelog,
        "published_at": version.published_at.isoformat() if version.published_at else None,
    }


def _published_version(db: Session, agent_id: str) -> AgentVersion | None:
    return db.scalars(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent_id, AgentVersion.status == "published")
        .order_by(AgentVersion.version.desc())
    ).first()


def _latest_any(db: Session, agent_id: str) -> AgentVersion | None:
    return db.scalars(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version.desc())
    ).first()


def _resolve_skills(db: Session, skill_ids: list[str]) -> list[dict]:
    if not skill_ids:
        return []
    rows = db.scalars(select(Skill).where(Skill.code.in_(skill_ids))).all()
    by_code = {s.code: s for s in rows}
    return [
        {
            "code": code,
            "name": by_code[code].name if code in by_code else "（技能不存在）",
            "type": by_code[code].type if code in by_code else "",
            "exists": code in by_code,
        }
        for code in skill_ids
    ]


@router.get("")
def list_agents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    q: str | None = Query(default=None, max_length=100),
    stage: str | None = Query(default=None, max_length=32),
) -> list[dict]:
    stmt = select(Agent)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Agent.name.ilike(pattern) | Agent.code.ilike(pattern))
    if stage:
        stmt = stmt.where(Agent.stage == stage)
    agents = db.scalars(stmt.order_by(Agent.stage, Agent.code)).all()

    published: dict[str, AgentVersion] = {}
    for version in db.scalars(
        select(AgentVersion).where(AgentVersion.status == "published")
    ).all():
        current = published.get(version.agent_id)
        if current is None or version.version > current.version:
            published[version.agent_id] = version

    return [
        {
            "code": a.code,
            "name": a.name,
            "description": a.description,
            "stage": a.stage,
            "capabilities": a.capabilities or [],
            "status": a.status,
            "model_tier": a.model_tier,
            "tier_label": TIER_LABELS.get(a.model_tier, a.model_tier),
            "success_rate": a.success_rate,
            "avg_cost_usd": a.avg_cost_usd,
            "p95_latency_ms": a.p95_latency_ms,
            "max_concurrency": a.max_concurrency,
            "published_version": published[a.id].version if a.id in published else None,
            "skill_count": len(published[a.id].skill_ids or []) if a.id in published else 0,
        }
        for a in agents
    ]


@router.get("/{code}")
def get_agent(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    agent = db.scalars(select(Agent).where(Agent.code == code)).first()
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "智能体不存在")

    versions = db.scalars(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent.id)
        .order_by(AgentVersion.version.desc())
    ).all()
    published = next((v for v in versions if v.status == "published"), None)
    draft = next((v for v in versions if v.status == "draft"), None)

    steps = db.scalars(
        select(RunStep)
        .where(RunStep.agent_version_id.in_([v.id for v in versions] or [""]))
        .order_by(RunStep.started_at.desc())
        .limit(10)
    ).all()

    return {
        "code": agent.code,
        "name": agent.name,
        "description": agent.description,
        "stage": agent.stage,
        "capabilities": agent.capabilities or [],
        "status": agent.status,
        "model_tier": agent.model_tier,
        "tier_label": TIER_LABELS.get(agent.model_tier, agent.model_tier),
        "success_rate": agent.success_rate,
        "avg_cost_usd": agent.avg_cost_usd,
        "p95_latency_ms": agent.p95_latency_ms,
        "max_concurrency": agent.max_concurrency,
        "published": _version_dict(published),
        "draft": _version_dict(draft),
        "skills": _resolve_skills(db, (published or draft).skill_ids if (published or draft) else []),
        "versions": [
            {
                **_version_dict(v),
                "prompt_length": len(v.system_prompt or ""),
            }
            for v in versions
        ],
        "recent_steps": [
            {
                "step_id": step.id,
                "run_id": step.run_id,
                "node_id": step.node_id,
                "status": step.status,
                "tokens": step.tokens,
                "cost_usd": float(step.cost_usd or 0),
                "started_at": step.started_at.isoformat() if step.started_at else None,
            }
            for step in steps
        ],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_agent(
    body: AgentIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    if db.scalars(select(Agent).where(Agent.code == body.code)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"智能体编码已存在：{body.code}")

    unknown = [c for c in body.skill_ids if db.scalars(select(Skill).where(Skill.code == c)).first() is None]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"技能不存在：{', '.join(unknown)}")

    agent = Agent(
        code=body.code,
        name=body.name,
        description=body.description,
        stage=body.stage,
        capabilities=body.capabilities,
        status="draft",
        owner_id=user.id,
        model_tier=body.model_tier,
        max_concurrency=body.max_concurrency,
        p95_latency_ms=body.p95_latency_ms,
        avg_cost_usd=body.avg_cost_usd,
        success_rate=body.success_rate,
    )
    db.add(agent)
    db.flush()

    # 新建即给一个草稿版本：没有版本号的智能体在界面上无从下手
    db.add(
        AgentVersion(
            agent_id=agent.id,
            version=1,
            system_prompt=body.system_prompt or f"你是{body.name}，负责{body.description or '供应链相关工作'}。",
            model_config={"temperature": 0.2},
            skill_ids=body.skill_ids,
            io_schema={},
            guardrails={"max_steps": 8},
            status="draft",
            changelog="初始草稿",
        )
    )
    record(
        db,
        "agent.create",
        user=user,
        resource_type="agent",
        resource_id=body.code,
        summary=f"{user.name} 新建智能体「{body.name}」（阶段 {body.stage}）",
        after={"name": body.name, "stage": body.stage, "skills": body.skill_ids},
        ctx=ctx,
    )
    db.commit()
    return get_agent(body.code, db, user)


@router.patch("/{code}")
def patch_agent(
    code: str,
    body: AgentPatch,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    agent = db.scalars(select(Agent).where(Agent.code == code)).first()
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "智能体不存在")

    before: dict = {}
    changed: dict = {}
    for field, value in body.model_dump(exclude_none=True).items():
        before[field] = getattr(agent, field)
        setattr(agent, field, value)
        changed[field] = value

    if changed:
        record(
            db,
            "agent.update",
            user=user,
            resource_type="agent",
            resource_id=code,
            summary=f"{user.name} 修改智能体「{agent.name}」",
            before={k: before[k] for k in changed},
            after=changed,
            ctx=ctx,
        )
    db.commit()
    return get_agent(code, db, user)


@router.post("/{code}/versions", status_code=status.HTTP_201_CREATED)
def create_agent_version(
    code: str,
    body: AgentVersionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    agent = db.scalars(select(Agent).where(Agent.code == code)).first()
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "智能体不存在")

    unknown = [c for c in body.skill_ids if db.scalars(select(Skill).where(Skill.code == c)).first() is None]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"技能不存在：{', '.join(unknown)}")

    latest = _latest_any(db, agent.id)
    next_version = (latest.version + 1) if latest else 1

    row = AgentVersion(
        agent_id=agent.id,
        version=next_version,
        system_prompt=body.system_prompt,
        model_config=body.llm_config or {"temperature": 0.2},
        skill_ids=body.skill_ids,
        io_schema=body.io_schema,
        guardrails=body.guardrails or {"max_steps": 8},
        status="published" if body.publish else "draft",
        changelog=body.changelog or ("发布" if body.publish else "保存草稿"),
        published_at=datetime.now(timezone.utc) if body.publish else None,
    )
    db.add(row)

    if body.publish:
        # 只允许一个已发布版本：老的归档，运行侧就不会有歧义
        for old in db.scalars(
            select(AgentVersion).where(
                AgentVersion.agent_id == agent.id, AgentVersion.status == "published"
            )
        ).all():
            old.status = "archived"
        agent.status = "active"
        record(
            db,
            "agent.publish",
            user=user,
            resource_type="agent",
            resource_id=code,
            summary=f"{user.name} 发布智能体「{agent.name}」v{next_version}（绑定 {len(body.skill_ids)} 个技能）",
            before={"version": latest.version if latest else None},
            after={
                "version": next_version,
                "skills": body.skill_ids,
                "prompt_length": len(body.system_prompt),
            },
            ctx=ctx,
        )

    db.commit()
    return get_agent(code, db, user)


@router.post("/{code}/test")
def test_agent(
    code: str,
    body: AgentTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    """在线测试：逐个调用绑定技能（工具轨迹），再让模型给结论。

    轨迹里的每一步都是真的执行了一次——耗时是计时器量的，Token 是模型返回的用量。
    没有绑技能时就只有一步模型调用，这一点会在 ``note`` 里说明。
    """
    agent = db.scalars(select(Agent).where(Agent.code == code)).first()
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "智能体不存在")

    version = _published_version(db, agent.id) or _latest_any(db, agent.id)
    if version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "智能体没有任何版本，无法测试")

    trace: list[dict] = []
    tool_results: dict[str, dict] = {}

    # 轨迹上的标签用中文技能名：界面上出现 skill 编码等于没做本地化
    skill_ids = version.skill_ids or []
    skill_names = {
        s.code: s.name
        for s in db.scalars(select(Skill).where(Skill.code.in_(skill_ids or [""]))).all()
    }

    for skill_code in skill_ids:
        started = time.perf_counter()
        label = f"调用技能「{skill_names.get(skill_code, skill_code)}」"
        try:
            execution = execute_skill(db, skill_code, body.input, source="test")
            db.commit()
            trace.append(
                {
                    "kind": "tool",
                    "name": skill_code,
                    "label": label,
                    "ok": True,
                    "duration_ms": execution.duration_ms,
                    "tokens": 0,
                    "output": execution.output,
                }
            )
            tool_results[skill_code] = execution.output
        except NodeError as exc:
            db.commit()
            trace.append(
                {
                    "kind": "tool",
                    "name": skill_code,
                    "label": label,
                    "ok": False,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "tokens": 0,
                    "error": str(exc),
                    "error_code": exc.code.value if isinstance(exc.code, ErrorCode) else str(exc.code),
                }
            )

    user_input = (
        f"输入参数：{body.input}\n\n"
        f"技能返回：{tool_results or '（该智能体未绑定技能）'}\n\n"
        "请基于以上信息给出结论与建议。"
    )
    gateway = build_gateway("mock" if body.use_mock else None)
    started = time.perf_counter()
    try:
        result = gateway.complete(
            system_prompt=version.system_prompt,
            user_input=user_input,
            tier=agent.model_tier,
            agent_code=code,
        )
    except NodeError as exc:
        trace.append(
            {
                "kind": "llm",
                "name": "模型调用",
                "label": "模型分析",
                "ok": False,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "tokens": 0,
                "error": str(exc),
                "error_code": exc.code.value,
            }
        )
        return {
            "ok": False,
            "version": version.version,
            "version_status": version.status,
            "trace": trace,
            "output": "",
            "error": str(exc),
        }

    llm_ms = round((time.perf_counter() - started) * 1000, 1)
    trace.append(
        {
            "kind": "llm",
            "name": result.model,
            "label": f"模型分析（{result.provider}）",
            "ok": True,
            "duration_ms": llm_ms,
            "tokens": result.token_input + result.token_output,
            "token_input": result.token_input,
            "token_output": result.token_output,
            "cost_usd": result.cost_usd,
        }
    )

    return {
        "ok": True,
        "version": version.version,
        "version_status": version.status,
        "trace": trace,
        "output": result.text,
        "provider": result.provider,
        "model": result.model,
        "tokens": sum(step.get("tokens", 0) for step in trace),
        "cost_usd": round(sum(step.get("cost_usd", 0) for step in trace), 6),
        "duration_ms": round(sum(step.get("duration_ms", 0) for step in trace), 1),
        "note": "" if version.skill_ids else "该版本未绑定技能，只有一步模型调用",
    }
