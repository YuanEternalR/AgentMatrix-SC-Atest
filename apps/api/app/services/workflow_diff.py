"""工作流版本对比。

回答"这个版本和上一个版本差在哪里"：节点增删、字段变更、连线变化。
布局坐标（pos）不参与语义对比，否则挪个位置也会被当成变更。
"""

from __future__ import annotations

from typing import Any

# 不参与语义对比的字段
NON_SEMANTIC_FIELDS = {"pos"}


def _nodes_by_id(graph: dict[str, Any]) -> dict[str, dict]:
    return {str(n.get("id")): n for n in (graph.get("nodes") or []) if n.get("id")}


def _edges(graph: dict[str, Any]) -> set[tuple[str, str, str]]:
    """边集合：(source, target, branch)；branch 为 next / true / false。"""
    result: set[tuple[str, str, str]] = set()
    for node in graph.get("nodes") or []:
        node_id = str(node.get("id") or "")
        if not node_id:
            continue
        if node.get("type") == "condition":
            if node.get("on_true"):
                result.add((node_id, str(node["on_true"]), "true"))
            if node.get("on_false"):
                result.add((node_id, str(node["on_false"]), "false"))
        elif node.get("next"):
            result.add((node_id, str(node["next"]), "next"))
    return result


def diff_graphs(old: dict[str, Any], new: dict[str, Any]) -> dict:
    old_nodes = _nodes_by_id(old)
    new_nodes = _nodes_by_id(new)

    added = sorted(set(new_nodes) - set(old_nodes))
    removed = sorted(set(old_nodes) - set(new_nodes))

    changed = []
    for node_id in sorted(set(old_nodes) & set(new_nodes)):
        before = old_nodes[node_id]
        after = new_nodes[node_id]
        field_changes = []
        for key in sorted(set(before) | set(after)):
            if key in NON_SEMANTIC_FIELDS:
                continue
            if before.get(key) != after.get(key):
                field_changes.append({"field": key, "from": before.get(key), "to": after.get(key)})
        if field_changes:
            changed.append({"node_id": node_id, "fields": field_changes})

    old_edges = _edges(old)
    new_edges = _edges(new)

    def _fmt(edge: tuple[str, str, str]) -> dict:
        source, target, branch = edge
        return {"source": source, "target": target, "branch": branch}

    entry_changed = old.get("entry") != new.get("entry")

    return {
        "summary": {
            "nodes_added": len(added),
            "nodes_removed": len(removed),
            "nodes_changed": len(changed),
            "edges_added": len(new_edges - old_edges),
            "edges_removed": len(old_edges - new_edges),
            "entry_changed": entry_changed,
        },
        "nodes_added": added,
        "nodes_removed": removed,
        "nodes_changed": changed,
        "edges_added": [_fmt(e) for e in sorted(new_edges - old_edges)],
        "edges_removed": [_fmt(e) for e in sorted(old_edges - new_edges)],
        "entry": {"from": old.get("entry"), "to": new.get("entry"), "changed": entry_changed},
    }
