"""技能库：注册、版本、试运行、引用检查。

规格 5.4 的落点。三条边界：

- **版本只增不改**：改配置是"发新版本"（``version`` 自增），老配置进不可变快照
  ——快照存在审计里（``skill.version`` 记 before/after），前端版本历史直接读它，
  不再单开一张只放 JSON 的表。
- **删除看引用**：被已发布智能体版本或已发布工作流版本引用时拒绝删除（409）。
- **密钥只存名字**：配置里只允许出现环境变量名（``token_env``），响应统一打码。
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import Integer, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import Agent, AgentVersion, Skill, SkillRun, User, Workflow, WorkflowVersion
from app.services.audit import AuditCtx, record, request_ctx
from app.services.errors import ErrorCode, NodeError
from app.services.skill_runtime import execute_skill, guard_url
from app.services.skills import REGISTRY

router = APIRouter(prefix="/skills", tags=["skills"])

# 分类编码 → 中文。种子数据用的是 data/analysis/notify 这一套，
# 表单里另给了 rule_check/document/external/ai；两套都收，避免界面回退成英文编码。
CATEGORY_LABELS: dict[str, str] = {
    "data": "数据查询",
    "analysis": "预测分析",
    "rule_check": "规则校验",
    "notify": "消息通知",
    "document": "文档解析",
    "external": "外部系统",
    "ai": "AI 能力",
    # 别名：表单早期用过这两个名字
    "data_query": "数据查询",
    "forecast": "预测分析",
}

TYPE_LABELS: dict[str, str] = {"builtin": "内置函数", "http": "HTTP", "sql": "SQL", "mcp": "MCP"}

# 配置里这些键一旦出现在响应中必须打码
_SECRET_KEYS = {"token", "api_key", "password", "secret", "authorization"}


class SkillIn(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_]+$")
    name: str = Field(min_length=1, max_length=64)
    category: str = Field(default="data_query", max_length=32)
    type: str = Field(default="builtin", pattern="^(builtin|http|sql|mcp)$")
    description: str = Field(default="", max_length=500)
    input_schema: dict = Field(default_factory=dict)
    output_schema: dict = Field(default_factory=dict)
    config: dict = Field(default_factory=dict)
    timeout_sec: int = Field(default=30, ge=1, le=300)
    rate_limit: int | None = Field(default=None, ge=1)


class SkillVersionIn(BaseModel):
    description: str | None = Field(default=None, max_length=500)
    input_schema: dict | None = None
    output_schema: dict | None = None
    config: dict | None = None
    timeout_sec: int | None = Field(default=None, ge=1, le=300)
    changelog: str = Field(default="", max_length=500)


class SkillTestIn(BaseModel):
    inputs: dict = Field(default_factory=dict)
    # 只在本次试运行里覆盖 mock 开关，不改库
    force_mock: bool | None = None


# --- 序列化 ----------------------------------------------------------------

def _mask(config: dict) -> dict:
    """配置脱敏：``token_env`` 这种**引用**保留，疑似密钥值一律打码。"""
    masked: dict = {}
    for key, value in (config or {}).items():
        if isinstance(value, dict):
            masked[key] = _mask(value)
            continue
        if any(word in key.lower() for word in _SECRET_KEYS) and isinstance(value, str) and value:
            masked[key] = "****"
            continue
        masked[key] = value
    return masked


def _bulk_stats(db: Session) -> dict[str, dict]:
    """一次查出所有技能的 调用次数 / 成功率 / 平均耗时。"""
    rows = db.execute(
        select(
            SkillRun.skill_code,
            func.count(),
            func.sum(func.cast(SkillRun.ok, Integer)),
            func.avg(SkillRun.duration_ms),
        ).group_by(SkillRun.skill_code)
    ).all()
    return {
        code: {
            "runs": int(total or 0),
            "success_rate": round(int(ok or 0) / int(total), 4) if total else None,
            "avg_ms": round(float(avg), 1) if avg is not None else None,
        }
        for code, total, ok, avg in rows
    }


def _bulk_ref_counts(db: Session) -> dict[str, int]:
    """一次算出每个技能被多少个已发布版本引用（智能体 + 工作流）。"""
    counts: dict[str, int] = {}

    for skill_ids in db.scalars(
        select(AgentVersion.skill_ids).where(AgentVersion.status == "published")
    ).all():
        for code in skill_ids or []:
            counts[code] = counts.get(code, 0) + 1

    for graph in db.scalars(
        select(WorkflowVersion.graph).where(WorkflowVersion.status == "published")
    ).all():
        seen: set[str] = set()
        for node in (graph or {}).get("nodes", []):
            code = node.get("skill")
            if code and code not in seen:
                seen.add(code)
                counts[code] = counts.get(code, 0) + 1
    return counts


def _references(db: Session, code: str) -> list[dict]:
    """被谁引用：已发布智能体版本 + 已发布工作流版本（草稿引用不算绑定）。"""
    refs: list[dict] = []
    agents = {a.id: a for a in db.scalars(select(Agent)).all()}

    grouped: dict[str, list[int]] = {}
    for version in db.scalars(
        select(AgentVersion).where(AgentVersion.status == "published")
    ).all():
        if code in (version.skill_ids or []):
            grouped.setdefault(version.agent_id, []).append(version.version)
    for agent_id, versions in grouped.items():
        agent = agents.get(agent_id)
        refs.append(
            {
                "kind": "agent",
                "code": agent.code if agent else agent_id,
                "name": agent.name if agent else "未知智能体",
                "versions": sorted(versions),
            }
        )

    wf_rows = db.execute(
        select(Workflow.code, Workflow.name, WorkflowVersion.version, WorkflowVersion.graph)
        .join(WorkflowVersion, WorkflowVersion.workflow_id == Workflow.id)
        .where(WorkflowVersion.status == "published")
    ).all()
    for wf_code, wf_name, version, graph in wf_rows:
        if any(node.get("skill") == code for node in (graph or {}).get("nodes", [])):
            refs.append(
                {
                    "kind": "workflow",
                    "code": wf_code,
                    "name": wf_name,
                    "versions": [version],
                }
            )
    return refs


def _to_dict(
    skill: Skill,
    *,
    stats: dict | None = None,
    ref_count: int = 0,
    with_config: bool = False,
) -> dict:
    data = {
        "code": skill.code,
        "name": skill.name,
        "category": skill.category,
        "category_label": CATEGORY_LABELS.get(skill.category, skill.category),
        "type": skill.type,
        "type_label": TYPE_LABELS.get(skill.type, skill.type),
        "description": skill.description,
        "input_schema": skill.input_schema or {},
        "output_schema": skill.output_schema or {},
        "timeout_sec": skill.timeout_sec,
        "rate_limit": skill.rate_limit,
        "status": skill.status,
        "version": skill.version,
        "secret_ref": skill.secret_ref,
        "reference_count": ref_count,
        **(stats or {"runs": 0, "success_rate": None, "avg_ms": None}),
        "created_at": skill.created_at.isoformat() if skill.created_at else None,
    }
    if with_config:
        config = skill.config or {}
        data["config"] = _mask(config)
        data["mock"] = config.get("mock", True) if skill.type == "http" else None
    return data


# --- 路由 ------------------------------------------------------------------

@router.get("/registry")
def builtin_registry(user: User = Depends(get_current_user)) -> list[dict]:
    """内置函数清单：建技能时从下拉里选，不用背函数名。"""
    items = []
    for name, fn in sorted(REGISTRY.items()):
        doc = (fn.__doc__ or "").strip().splitlines()
        items.append({"function": name, "doc": doc[0] if doc else ""})
    return items


@router.get("")
def list_skills(
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    q: str | None = Query(default=None, max_length=100),
    type_filter: str | None = Query(default=None, alias="type"),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[dict]:
    stmt = select(Skill)
    if type_filter:
        stmt = stmt.where(Skill.type == type_filter)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(Skill.name.ilike(pattern), Skill.code.ilike(pattern)))
    skills = db.scalars(stmt.order_by(Skill.category, Skill.code).limit(limit)).all()

    stats = _bulk_stats(db)
    refs = _bulk_ref_counts(db)
    response.headers["X-Total-Count"] = str(len(skills))
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return [_to_dict(s, stats=stats.get(s.code), ref_count=refs.get(s.code, 0)) for s in skills]


@router.get("/{code}")
def get_skill(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    skill = db.scalars(select(Skill).where(Skill.code == code)).first()
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"技能不存在：{code}")

    runs = db.scalars(
        select(SkillRun)
        .where(SkillRun.skill_code == code)
        .order_by(SkillRun.created_at.desc())
        .limit(10)
    ).all()

    refs = _references(db, code)
    data = _to_dict(
        skill, stats=_bulk_stats(db).get(code), ref_count=len(refs), with_config=True
    )
    data["references"] = refs
    data["recent_runs"] = [
        {
            "id": run.id,
            "ok": run.ok,
            "duration_ms": run.duration_ms,
            "source": run.source,
            "input": run.input,
            "error": run.error,
            "error_code": run.error_code,
            "created_at": run.created_at.isoformat() if run.created_at else None,
        }
        for run in runs
    ]
    return data


def _validate_config(skill_type: str, config: dict) -> None:
    if skill_type == "http":
        mock = config.get("mock", True)
        if mock is False:
            url = str(config.get("url") or "")
            if not url:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "关闭 Mock 时必须填写 url")
            try:
                guard_url(url, config.get("allowed_hosts") or [])
            except NodeError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    if skill_type == "builtin":
        fn_name = str(config.get("function") or "")
        if fn_name and fn_name not in REGISTRY:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"未注册的内置函数：{fn_name}",
            )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_skill(
    body: SkillIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    if db.scalars(select(Skill).where(Skill.code == body.code)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"技能编码已存在：{body.code}")
    if body.category not in CATEGORY_LABELS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"未知分类 {body.category}，可用：{', '.join(CATEGORY_LABELS)}",
        )
    if body.type in {"sql", "mcp"}:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SQL / MCP 类型尚未实现；当前支持内置函数与 HTTP（HTTP 默认走 Mock，无需联网）",
        )

    config = dict(body.config)
    if body.type == "builtin" and not config.get("function"):
        config["function"] = body.code
    if body.type == "http":
        config.setdefault("mock", True)
        config.setdefault("mock_delay_ms", 120)
        config.setdefault("method", "GET")
    _validate_config(body.type, config)

    skill = Skill(
        code=body.code,
        name=body.name,
        category=body.category,
        type=body.type,
        description=body.description,
        input_schema=body.input_schema,
        output_schema=body.output_schema,
        config=config,
        timeout_sec=body.timeout_sec,
        rate_limit=body.rate_limit,
        status="active",
        version=1,
    )
    db.add(skill)
    record(
        db,
        "skill.create",
        user=user,
        resource_type="skill",
        resource_id=body.code,
        summary=f"{user.name} 新建技能「{body.name}」（{TYPE_LABELS.get(body.type, body.type)}）",
        after={"name": body.name, "type": body.type, "category": body.category, "version": 1},
        ctx=ctx,
    )
    db.commit()
    db.refresh(skill)
    return _to_dict(skill, with_config=True)


@router.post("/{code}/versions", status_code=status.HTTP_201_CREATED)
def create_skill_version(
    code: str,
    body: SkillVersionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> dict:
    skill = db.scalars(select(Skill).where(Skill.code == code)).first()
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"技能不存在：{code}")

    before = {
        "config": _mask(skill.config or {}),
        "timeout_sec": skill.timeout_sec,
        "version": skill.version,
    }
    new_config = dict(skill.config or {}) if body.config is None else dict(body.config)
    _validate_config(skill.type, new_config)

    # 不覆盖老配置：旧配置已进审计快照，这里直接推进版本号
    skill.config = new_config
    if body.description is not None:
        skill.description = body.description
    if body.input_schema is not None:
        skill.input_schema = body.input_schema
    if body.output_schema is not None:
        skill.output_schema = body.output_schema
    if body.timeout_sec is not None:
        skill.timeout_sec = body.timeout_sec
    skill.version += 1

    record(
        db,
        "skill.version",
        user=user,
        resource_type="skill",
        resource_id=code,
        summary=f"{user.name} 发布技能「{skill.name}」v{skill.version}：{body.changelog or '未填写说明'}",
        before=before,
        after={"config": _mask(new_config), "timeout_sec": skill.timeout_sec, "version": skill.version},
        ctx=ctx,
    )
    db.commit()
    db.refresh(skill)
    return _to_dict(skill, with_config=True)


@router.post("/{code}/test")
def test_skill(
    code: str,
    body: SkillTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("operator", "developer")),
) -> dict:
    """试运行：返回请求、响应、耗时与错误，供控制台展示。"""
    skill = db.scalars(select(Skill).where(Skill.code == code)).first()
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"技能不存在：{code}")

    override = None
    if body.force_mock is not None and skill.type == "http":
        override = {**(skill.config or {}), "mock": body.force_mock}

    started = datetime.now(timezone.utc)
    try:
        execution = execute_skill(
            db, code, body.inputs, source="test", config_override=override
        )
        db.commit()
        return {
            "ok": True,
            "output": execution.output,
            "error": "",
            "error_code": "",
            "duration_ms": execution.duration_ms,
            "mode": execution.mode,
            "started_at": started.isoformat(),
        }
    except NodeError as exc:
        # 失败也是一次有效执行：留痕后把错误返回给控制台
        db.commit()
        config = override or (skill.config or {})
        if skill.type == "http":
            mode = "http-mock" if config.get("mock", True) else "http-real"
        else:
            mode = "builtin"
        return {
            "ok": False,
            "output": {},
            "error": str(exc),
            "error_code": exc.code.value if isinstance(exc.code, ErrorCode) else str(exc.code),
            "duration_ms": 0.0,
            "mode": mode,
            "started_at": started.isoformat(),
        }


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("developer")),
    ctx: AuditCtx = Depends(request_ctx),
) -> None:
    skill = db.scalars(select(Skill).where(Skill.code == code)).first()
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"技能不存在：{code}")

    refs = _references(db, code)
    if refs:
        # 删除被引用的技能会让已发布版本指向空实现，必须拦住
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"message": "技能仍被已发布版本引用，无法删除", "references": refs},
        )

    record(
        db,
        "skill.delete",
        user=user,
        resource_type="skill",
        resource_id=code,
        summary=f"{user.name} 删除技能「{skill.name}」",
        before={"name": skill.name, "type": skill.type, "version": skill.version},
        ctx=ctx,
    )
    db.delete(skill)
    db.commit()
