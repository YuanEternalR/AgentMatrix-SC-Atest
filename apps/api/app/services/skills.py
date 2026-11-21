"""技能注册表（MVP：内置函数 + 确定性 Mock 实现）。

真实技能（HTTP / SQL / MCP）接入时保持同样的 ``run(inputs, ctx) -> dict`` 契约。
所有实现都必须确定性，保证演示可复现。
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable

from app.services.errors import TransientError

SkillFn = Callable[[dict[str, Any]], dict[str, Any]]


def _stable_delay_hours(order_id: str) -> float:
    digest = hashlib.sha256(order_id.encode("utf-8")).hexdigest()
    return round(2 + int(digest[:2], 16) % 70 / 10, 1)


def order_status_query(inputs: dict[str, Any]) -> dict[str, Any]:
    order_id = str(inputs.get("order_id") or "SO-UNKNOWN")
    delay = _stable_delay_hours(order_id)
    return {
        "order_id": order_id,
        "carrier": "SF-Express",
        "status": "delayed" if delay > 4 else "in_transit",
        "delay_hours": delay,
        "destination": inputs.get("destination", "上海中心仓"),
        "sku": inputs.get("sku", "SKU-10021"),
        "quantity": int(inputs.get("quantity", 120)),
    }


def customer_impact_assess(inputs: dict[str, Any]) -> dict[str, Any]:
    delay = float(inputs.get("delay_hours", 0) or 0)
    quantity = int(inputs.get("quantity", 0) or 0)
    score = min(5.0, round(delay / 3 + quantity / 100, 2))
    return {
        "impact_score": score,
        "affected_orders": 1,
        "risk_level": "high" if score >= 3 else ("medium" if score >= 1.5 else "low"),
        "revenue_at_risk_usd": round(quantity * 12.5, 2),
    }


def notify_customer(inputs: dict[str, Any]) -> dict[str, Any]:
    order_id = str(inputs.get("order_id") or "SO-UNKNOWN")
    attempt = int(inputs.get("_attempt") or 1)

    # 故障注入（仅演示用）：订单号里带 FLAKY / DEAD 标记即可触发
    #   FLAKY  前两次失败、第三次成功          -> 演示"自动重试后恢复"
    #   DEAD   前三次失败、第四次成功          -> 演示"自动重试耗尽进死信，人工重试后恢复"
    marker = order_id.upper()
    if "DEAD" in marker and attempt <= 3:
        raise TransientError(f"通知网关持续不可用（第 {attempt} 次尝试）")
    if "FLAKY" in marker and attempt <= 2:
        raise TransientError(f"通知网关瞬时抖动（第 {attempt} 次尝试失败）")

    return {
        "order_id": order_id,
        "channel": inputs.get("channel", "sms"),
        "template": "delay_apology_v2",
        "sent": True,
        "attempts_used": attempt,
        "message_id": hashlib.sha256(f"notify|{order_id}".encode()).hexdigest()[:16],
    }


def inventory_query(inputs: dict[str, Any]) -> dict[str, Any]:
    sku = str(inputs.get("sku") or "SKU-UNKNOWN")
    digest = hashlib.sha256(sku.encode()).hexdigest()
    on_hand = int(digest[:3], 16) % 900 + 50
    in_transit = int(digest[3:6], 16) % 300
    return {
        "sku": sku,
        "on_hand": on_hand,
        "in_transit": in_transit,
        "available": on_hand + in_transit,
        "safety_stock": 120,
    }


def supplier_score(inputs: dict[str, Any]) -> dict[str, Any]:
    supplier_id = str(inputs.get("supplier_id") or "SUP-UNKNOWN")
    digest = hashlib.sha256(supplier_id.encode()).hexdigest()
    return {
        "supplier_id": supplier_id,
        "delivery_score": round(60 + int(digest[:2], 16) % 40, 1),
        "quality_score": round(60 + int(digest[2:4], 16) % 40, 1),
        "risk_flags": [] if int(digest[4:6], 16) % 3 else ["交付波动"],
    }


# --- 科研域 -----------------------------------------------------------------

_PAPER_TEMPLATES = [
    ("基于多智能体协作的{0}方法", "计算机学报", 2024),
    ("{0}中的调度优化研究综述", "自动化学报", 2023),
    ("面向{0}的检索增强生成框架", "软件学报", 2025),
    ("{0}任务分解与工具调用实证研究", "中文信息学报", 2024),
    ("大模型在{0}场景下的成本-效果权衡", "计算机研究与发展", 2025),
    ("{0}: A Benchmark for Agent Scheduling", "arXiv", 2025),
    ("小模型与技能编排在{0}中的实践", "计算机工程", 2023),
    ("{0}自动化流程的可复现性评估", "情报学报", 2024),
]


def literature_search(inputs: dict[str, Any]) -> dict[str, Any]:
    topic = str(inputs.get("topic") or "未知主题")
    digest = hashlib.sha256(topic.encode("utf-8")).hexdigest()

    papers = []
    for index, (template, venue, year) in enumerate(_PAPER_TEMPLATES):
        seed = digest[index * 2 : index * 2 + 2]
        relevance = round(0.35 + (int(seed, 16) % 65) / 100, 2)
        papers.append(
            {
                "id": f"P{index + 1:03d}",
                "title": template.format(topic),
                "venue": venue,
                "year": year,
                "relevance": relevance,
                "citations": int(seed, 16) % 180,
            }
        )

    return {"topic": topic, "count": len(papers), "papers": papers}


def relevance_screen(inputs: dict[str, Any]) -> dict[str, Any]:
    papers = inputs.get("papers") if isinstance(inputs.get("papers"), list) else []
    threshold = float(inputs.get("threshold", 0.55) or 0.55)

    selected = [p for p in papers if float(p.get("relevance", 0)) >= threshold]
    selected.sort(key=lambda p: float(p.get("relevance", 0)), reverse=True)

    return {
        "threshold": threshold,
        "selected_count": len(selected),
        "selected": selected,
        "dropped_count": len(papers) - len(selected),
    }


def save_report(inputs: dict[str, Any]) -> dict[str, Any]:
    topic = str(inputs.get("topic") or "未命名主题")
    text = str(inputs.get("text") or "")
    digest = hashlib.sha256(f"report|{topic}|{text[:40]}".encode("utf-8")).hexdigest()

    selected = inputs.get("selected") if isinstance(inputs.get("selected"), list) else []
    lines = [f"# {topic} · 综述草稿", "", "> 由 AgentMatrix-SC 自动生成（Mock 模式，内容仅作流程演示）。", ""]

    if selected:
        lines += ["## 参考文献", ""]
        for index, paper in enumerate(selected[:8], start=1):
            lines.append(
                f"{index}. {paper.get('title', '未命名')} — *{paper.get('venue', '')}*, "
                f"{paper.get('year', '')}（相关性 {paper.get('relevance', 0):.2f}）"
            )
        lines.append("")

    lines += ["## 正文要点", "", text or "（正文由撰写智能体生成）", ""]
    content = "\n".join(lines)

    return {
        "artifact_id": f"art-{digest[:12]}",
        "name": f"{topic}-综述草稿.md",
        "mime": "text/markdown",
        "size": len(content.encode("utf-8")),
        "uri": f"artifacts/{digest[:12]}.md",
        "content": content,
        "saved": True,
    }


REGISTRY: dict[str, SkillFn] = {
    "order_status_query": order_status_query,
    "customer_impact_assess": customer_impact_assess,
    "notify_customer": notify_customer,
    "inventory_query": inventory_query,
    "supplier_score": supplier_score,
    "literature_search": literature_search,
    "relevance_screen": relevance_screen,
    "save_report": save_report,
}


def run_skill(code: str, inputs: dict[str, Any]) -> dict[str, Any]:
    fn = REGISTRY.get(code)
    if fn is None:
        raise KeyError(f"未注册的技能：{code}")
    return fn(inputs)
