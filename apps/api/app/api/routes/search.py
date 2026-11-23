"""全局搜索：Ctrl/Cmd + K 的数据源。

为什么放在后端而不是前端逐个过滤器去查：
1. 每个列表接口都有自己的分页与权限，前端并行拼五份响应既慢又容易漏；
2. 搜索要能匹配**编号**（任务 id、运行 id），这在列表页里根本拿不到；
3. 结果里带 `route`，前端只负责渲染与跳转，不重复维护路由规则。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Agent, Run, Skill, Task, User, Workflow

router = APIRouter(prefix="/search", tags=["search"])

# 运行状态的中文文案放在后端：搜索结果要在前端直接展示，别让前端再维护一份
_RUN_STATUS = {
    "queued": "排队中",
    "running": "运行中",
    "waiting_approval": "待审批",
    "succeeded": "成功",
    "failed": "失败",
    "canceled": "已取消",
    "timed_out": "超时",
}
_TASK_STATUS = {
    "pending": "待处理",
    "dispatching": "分配中",
    "queued": "排队中",
    "running": "运行中",
    "waiting_approval": "待审批",
    "succeeded": "成功",
    "failed": "失败",
    "canceled": "已取消",
}


@router.get("")
def global_search(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    q: str = Query(min_length=1, max_length=60),
    limit: int = Query(default=5, ge=1, le=20),
) -> dict:
    like = f"%{q}%"
    groups: list[dict] = []

    tasks = db.scalars(
        select(Task)
        .where(or_(Task.title.ilike(like), Task.id.ilike(like)))
        .order_by(Task.created_at.desc())
        .limit(limit)
    ).all()
    if tasks:
        groups.append(
            {
                "kind": "task",
                "label": "任务",
                "items": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "subtitle": _TASK_STATUS.get(t.status, t.status),
                        "route": f"/tasks/{t.id}",
                    }
                    for t in tasks
                ],
            }
        )

    runs = db.scalars(
        select(Run)
        .where(or_(Run.id.ilike(like), Run.trace_id.ilike(like)))
        .order_by(Run.created_at.desc())
        .limit(limit)
    ).all()
    if runs:
        groups.append(
            {
                "kind": "run",
                "label": "运行",
                "items": [
                    {
                        "id": r.id,
                        "title": f"运行 {r.id[:8]}",
                        "subtitle": _RUN_STATUS.get(r.status, r.status),
                        "route": f"/runs/{r.id}",
                    }
                    for r in runs
                ],
            }
        )

    agents = db.scalars(
        select(Agent)
        .where(or_(Agent.name.ilike(like), Agent.code.ilike(like)))
        .order_by(Agent.stage, Agent.code)
        .limit(limit)
    ).all()
    if agents:
        groups.append(
            {
                "kind": "agent",
                "label": "智能体",
                "items": [
                    {
                        "id": a.code,
                        "title": a.name,
                        "subtitle": a.description or a.code,
                        "route": f"/agents/{a.code}",
                    }
                    for a in agents
                ],
            }
        )

    skills = db.scalars(
        select(Skill)
        .where(or_(Skill.name.ilike(like), Skill.code.ilike(like)))
        .order_by(Skill.code)
        .limit(limit)
    ).all()
    if skills:
        groups.append(
            {
                "kind": "skill",
                "label": "技能",
                "items": [
                    {
                        "id": s.code,
                        "title": s.name,
                        "subtitle": s.description or s.code,
                        "route": f"/skills/{s.code}",
                    }
                    for s in skills
                ],
            }
        )

    workflows = db.scalars(
        select(Workflow)
        .where(or_(Workflow.name.ilike(like), Workflow.code.ilike(like)))
        .order_by(Workflow.code)
        .limit(limit)
    ).all()
    if workflows:
        groups.append(
            {
                "kind": "workflow",
                "label": "工作流",
                "items": [
                    {
                        "id": w.code,
                        "title": w.name,
                        "subtitle": "打开编排器",
                        "route": f"/workflows/{w.code}/design",
                    }
                    for w in workflows
                ],
            }
        )

    return {
        "query": q,
        "groups": groups,
        "total": sum(len(group["items"]) for group in groups),
    }
