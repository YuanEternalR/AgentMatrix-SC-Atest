"""工作流图校验。

保存新版本前必须过这一关：宁可拒绝保存，也不要把一张跑不通的图发布出去。
所有错误都带 ``code`` 与 ``node_id``，前端可以直接定位到节点。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

VALID_NODE_TYPES = {"start", "end", "skill", "agent", "condition", "approval"}


@dataclass
class ValidationIssue:
    code: str
    message: str
    node_id: str | None = None

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "node_id": self.node_id}


@dataclass
class ValidationResult:
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": [e.as_dict() for e in self.errors],
            "warnings": [w.as_dict() for w in self.warnings],
        }


def _targets(node: dict[str, Any]) -> list[str]:
    """节点指向的下一跳（条件节点有两条边）。"""
    if node.get("type") == "condition":
        return [t for t in (node.get("on_true"), node.get("on_false")) if t]
    target = node.get("next")
    return [target] if target else []


def validate_graph(graph: dict[str, Any]) -> ValidationResult:
    result = ValidationResult()

    nodes = graph.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        result.errors.append(ValidationIssue("EMPTY_GRAPH", "工作流至少需要一个节点"))
        return result

    by_id: dict[str, dict[str, Any]] = {}
    for raw in nodes:
        if not isinstance(raw, dict) or not raw.get("id"):
            result.errors.append(ValidationIssue("NODE_INVALID", "存在缺少 id 的节点"))
            continue
        node_id = str(raw["id"])
        if node_id in by_id:
            result.errors.append(
                ValidationIssue("DUPLICATE_NODE_ID", f"节点 id 重复：{node_id}", node_id)
            )
        by_id[node_id] = raw

    entry = graph.get("entry")
    if not entry:
        result.errors.append(ValidationIssue("ENTRY_MISSING", "缺少入口节点 entry"))
    elif entry not in by_id:
        result.errors.append(
            ValidationIssue("ENTRY_NOT_FOUND", f"入口节点不存在：{entry}", str(entry))
        )

    starts = [n for n in by_id.values() if n.get("type") == "start"]
    ends = [n for n in by_id.values() if n.get("type") == "end"]
    if not starts:
        result.errors.append(ValidationIssue("NO_START", "缺少 start 节点"))
    if not ends:
        result.errors.append(ValidationIssue("NO_END", "缺少 end 节点"))

    for node_id, node in by_id.items():
        node_type = node.get("type")
        if node_type not in VALID_NODE_TYPES:
            result.errors.append(
                ValidationIssue("BAD_NODE_TYPE", f"未知节点类型：{node_type}", node_id)
            )
            continue

        if node_type == "skill" and not node.get("skill"):
            result.errors.append(
                ValidationIssue("SKILL_MISSING", "技能节点未指定 skill", node_id)
            )
        if node_type == "agent" and not node.get("agent_code"):
            result.errors.append(
                ValidationIssue("AGENT_MISSING", "智能体节点未指定 agent_code", node_id)
            )
        if node_type == "approval" and not node.get("role"):
            result.errors.append(
                ValidationIssue("ROLE_MISSING", "审批节点未指定 role", node_id)
            )
        if node_type == "condition":
            if not node.get("expr"):
                result.errors.append(
                    ValidationIssue("EXPR_MISSING", "条件节点缺少 expr", node_id)
                )
            if not node.get("on_true") or not node.get("on_false"):
                result.errors.append(
                    ValidationIssue("BRANCH_MISSING", "条件节点缺少 on_true / on_false", node_id)
                )
        if node_type == "end":
            if node.get("next"):
                result.errors.append(
                    ValidationIssue("END_HAS_NEXT", "end 节点不应有 next", node_id)
                )

        for target in _targets(node):
            if target not in by_id:
                result.errors.append(
                    ValidationIssue(
                        "DANGLING_EDGE", f"节点 {node_id} 指向不存在的节点：{target}", node_id
                    )
                )

    # --- 环检测 ---
    color: dict[str, int] = {}  # 0 未访问 / 1 访问中 / 2 完成

    def visit(node_id: str, path: list[str]) -> None:
        state = color.get(node_id, 0)
        if state == 2:
            return
        if state == 1:
            cycle = " → ".join(path[path.index(node_id) :] + [node_id])
            result.errors.append(ValidationIssue("CYCLE", f"存在环：{cycle}", node_id))
            return
        color[node_id] = 1
        for target in _targets(by_id.get(node_id, {})):
            if target in by_id:
                visit(target, path + [node_id])
        color[node_id] = 2

    for node_id in by_id:
        visit(node_id, [])

    # --- 可达性（警告而非错误：允许先画后连）---
    if entry in by_id:
        reachable: set[str] = set()
        stack = [entry]
        while stack:
            current = stack.pop()
            if current in reachable or current not in by_id:
                continue
            reachable.add(current)
            stack.extend(t for t in _targets(by_id[current]) if t in by_id)
        for node_id in by_id:
            if node_id not in reachable:
                result.warnings.append(
                    ValidationIssue("UNREACHABLE", f"节点 {node_id} 从入口不可达", node_id)
                )

    return result
