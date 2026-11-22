"""真实文献检索：OpenAlex 为主，Crossref 兜底。

此前 `literature_search` 用模板拼论文标题（8 条固定句式），那只是占位。
这里改成真的查学术 API：

- **OpenAlex**（https://api.openalex.org）：免费、无需 Key、元数据最全
  （标题、作者、期刊、年份、DOI、被引数、摘要倒排索引）；
- **Crossref**（https://api.crossref.org）：兜底源，覆盖期刊更广。

失败分类遵循平台约定：网络/超时/5xx 抛 ``TransientError``（可重试），
两个源都查不到则返回空列表（业务上的"没有结果"，不是故障）。
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from app.services.errors import TransientError

MAILTO = "agentmatrix@example.com"  # 学术 API 的礼貌池标识，便于对方统计
TIMEOUT = 12.0

# OpenAlex / Crossref 以英文文献为主，纯中文查询几乎检不到东西
# （实测「智能体调度策略」只返回 1 篇、相关度 1%）。这里用一张领域术语表
# 把中文关键词扩展成英文再检索，命中后仍以原主题展示给用户。
GLOSSARY: dict[str, str] = {
    "智能体": "agent",
    "多智能体": "multi-agent",
    "大模型": "large language model",
    "大语言模型": "large language model",
    "调度": "scheduling",
    "调度策略": "scheduling strategy",
    "任务分解": "task decomposition",
    "工具调用": "tool use",
    "规划": "planning",
    "供应链": "supply chain",
    "库存": "inventory",
    "履约": "fulfillment",
    "物流": "logistics",
    "文献综述": "literature review",
    "检索增强": "retrieval augmented generation",
    "工作流": "workflow",
    "编排": "orchestration",
    "异常检测": "anomaly detection",
    "强化学习": "reinforcement learning",
    "成本优化": "cost optimization",
}

Fetcher = Callable[[str], dict[str, Any]]


def expand_query(topic: str) -> tuple[str, list[str]]:
    """把中文主题扩展成英文检索式。返回 (检索式, 命中的术语列表)。

    没有命中术语时原样返回，避免把本来就该是英文的查询改坏。
    """
    hits = [en for zh, en in GLOSSARY.items() if zh in topic]
    if not hits:
        return topic, []
    # 去重并按出现顺序保留
    unique: list[str] = []
    for term in hits:
        if term not in unique:
            unique.append(term)
    return " ".join(unique), unique


def _http_get_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"AgentMatrix-SC/0.1 (mailto:{MAILTO})",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code >= 500 or exc.code == 429:
            raise TransientError(f"文献 API 暂时不可用（HTTP {exc.code}）") from exc
        raise ValueError(f"文献 API 拒绝了请求（HTTP {exc.code}）") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise TransientError(f"文献 API 连接失败：{exc}") from exc


def rebuild_abstract(inverted: dict[str, list[int]] | None) -> str:
    """OpenAlex 的摘要是倒排索引 {词: [位置]}，还原成正常文本。"""
    if not inverted:
        return ""
    positions: list[tuple[int, str]] = []
    for word, indexes in inverted.items():
        for index in indexes:
            positions.append((index, word))
    positions.sort()
    return " ".join(word for _, word in positions)


def _tokenize(text: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9\u4e00-\u9fff]+", text.lower()) if len(t) > 1}


def score_relevance(topic: str, title: str, abstract: str, citations: int) -> float:
    """相关性 = 关键词命中率 0.7 + 被引数（对数归一）0.3，取值 0~1。

    这是可解释的启发式，不是模型打分：给定同样的输入必然得到同样的分数。
    """
    topic_tokens = _tokenize(topic)
    if not topic_tokens:
        return 0.0
    haystack = _tokenize(f"{title} {abstract}")
    hit = len(topic_tokens & haystack) / len(topic_tokens)
    citation_part = min(1.0, (citations or 0) ** 0.5 / 30.0)
    return round(min(1.0, 0.7 * hit + 0.3 * citation_part), 3)


def search_openalex(query: str, limit: int, fetch: Fetcher = _http_get_json) -> list[dict]:
    params = {
        "search": query,
        "per-page": str(limit),
        "sort": "relevance_score:desc",
        "mailto": MAILTO,
    }
    payload = fetch(f"https://api.openalex.org/works?{urllib.parse.urlencode(params)}")
    results = []
    for work in payload.get("results", []):
        source = ((work.get("primary_location") or {}).get("source") or {})
        results.append(
            {
                "id": str(work.get("id", "")).rsplit("/", 1)[-1],
                "title": (work.get("title") or "(无标题)").strip(),
                "authors": [
                    (a.get("author") or {}).get("display_name", "")
                    for a in (work.get("authorships") or [])[:4]
                ],
                "venue": source.get("display_name") or "",
                "year": work.get("publication_year"),
                "citations": int(work.get("cited_by_count") or 0),
                "doi": (work.get("doi") or "").replace("https://doi.org/", ""),
                "abstract": rebuild_abstract(work.get("abstract_inverted_index"))[:600],
                "source": "openalex",
            }
        )
    return results


def search_crossref(query: str, limit: int, fetch: Fetcher = _http_get_json) -> list[dict]:
    params = {"query": query, "rows": str(limit), "mailto": MAILTO}
    payload = fetch(f"https://api.crossref.org/works?{urllib.parse.urlencode(params)}")
    items = (payload.get("message") or {}).get("items") or []
    results = []
    for item in items:
        year = None
        parts = ((item.get("issued") or {}).get("date-parts") or [[None]])[0]
        if parts:
            year = parts[0]
        title = (item.get("title") or ["(无标题)"])[0]
        results.append(
            {
                "id": item.get("DOI", ""),
                "title": title.strip(),
                "authors": [
                    f"{a.get('given', '')} {a.get('family', '')}".strip()
                    for a in (item.get("author") or [])[:4]
                ],
                "venue": (item.get("container-title") or [""])[0],
                "year": year,
                "citations": int(item.get("is-referenced-by-count") or 0),
                "doi": item.get("DOI", ""),
                "abstract": re.sub(r"<[^>]+>", "", item.get("abstract", ""))[:600],
                "source": "crossref",
            }
        )
    return results


def search_literature(
    topic: str,
    limit: int = 8,
    fetch: Fetcher = _http_get_json,
) -> dict[str, Any]:
    """先查 OpenAlex；失败则降级到 Crossref。两个都不可用才抛错。"""
    errors: list[str] = []
    query, expanded = expand_query(topic)

    for name, fn in (("openalex", search_openalex), ("crossref", search_crossref)):
        try:
            papers = fn(query, limit, fetch)
        except (TransientError, ValueError) as exc:
            errors.append(f"{name}: {exc}")
            continue

        for paper in papers:
            # 用扩展后的检索式打分：实际检索用的是它，用它比才反映真实匹配度
            paper["relevance"] = score_relevance(
                query, paper["title"], paper["abstract"], paper["citations"]
            )
        papers.sort(key=lambda p: p["relevance"], reverse=True)
        return {
            "topic": topic,
            "query_used": query,
            "expanded_terms": expanded,
            "count": len(papers),
            "provider": name,
            "papers": papers,
        }

    raise TransientError("文献检索失败：" + "；".join(errors))
