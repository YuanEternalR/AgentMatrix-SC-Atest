"""文献检索模块的单元测试。

HTTP 全部用注入的假 fetcher，不依赖网络——保证测试确定性。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.services.errors import TransientError  # noqa: E402
from app.services.literature import (  # noqa: E402
    expand_query,
    rebuild_abstract,
    score_relevance,
    search_literature,
)


def test_rebuild_abstract_orders_by_position():
    inverted = {"world": [3], "hello": [0], "brave": [2], "new": [1]}
    assert rebuild_abstract(inverted) == "hello new brave world"


def test_rebuild_abstract_handles_empty():
    assert rebuild_abstract(None) == ""
    assert rebuild_abstract({}) == ""


def test_expand_query_translates_known_terms():
    query, terms = expand_query("智能体调度策略")
    assert "agent" in query
    assert "scheduling" in query
    assert terms


def test_expand_query_keeps_unknown_topic():
    query, terms = expand_query("swarm robotics")
    assert query == "swarm robotics"
    assert terms == []


def test_score_prefers_keyword_hits():
    high = score_relevance("agent scheduling", "Agent scheduling for LLM systems", "", 10)
    low = score_relevance("agent scheduling", "Marine biology of coral reefs", "", 10)
    assert high > low
    assert 0.0 <= low <= 1.0 and 0.0 <= high <= 1.0


def test_score_is_deterministic():
    args = ("supply chain", "Supply chain resilience", "study of logistics", 42)
    assert score_relevance(*args) == score_relevance(*args)


def _openalex_payload():
    return {
        "results": [
            {
                "id": "https://openalex.org/W1",
                "title": "Agent scheduling in multi-agent systems",
                "authorships": [{"author": {"display_name": "Ada Lovelace"}}],
                "primary_location": {"source": {"display_name": "Journal of Agents"}},
                "publication_year": 2024,
                "cited_by_count": 120,
                "doi": "https://doi.org/10.1/abc",
                "abstract_inverted_index": {"scheduling": [0], "matters": [1]},
            }
        ]
    }


def test_openalex_path_parses_and_scores():
    calls = []

    def fake_fetch(url: str):
        calls.append(url)
        return _openalex_payload()

    result = search_literature("智能体调度策略", limit=5, fetch=fake_fetch)

    assert result["provider"] == "openalex"
    assert result["count"] == 1
    paper = result["papers"][0]
    assert paper["title"] == "Agent scheduling in multi-agent systems"
    assert paper["venue"] == "Journal of Agents"
    assert paper["citations"] == 120
    assert paper["doi"] == "10.1/abc"
    assert paper["abstract"] == "scheduling matters"
    assert 0.0 <= paper["relevance"] <= 1.0
    # 中文主题应被扩展后再查
    assert "agent" in calls[0]


def test_falls_back_to_crossref_when_openalex_fails():
    state = {"n": 0}

    def fake_fetch(url: str):
        state["n"] += 1
        if "openalex" in url:
            raise TransientError("openalex down")
        return {
            "message": {
                "items": [
                    {
                        "DOI": "10.2/xyz",
                        "title": ["Scheduling agents"],
                        "author": [{"given": "Alan", "family": "Turing"}],
                        "container-title": ["Nature"],
                        "issued": {"date-parts": [[2023]]},
                        "is-referenced-by-count": 7,
                        "abstract": "<p>An <b>abstract</b></p>",
                    }
                ]
            }
        }

    result = search_literature("agent scheduling", limit=3, fetch=fake_fetch)
    assert result["provider"] == "crossref"
    paper = result["papers"][0]
    assert paper["venue"] == "Nature"
    assert paper["year"] == 2023
    assert "<" not in paper["abstract"]  # HTML 标签被清理


def test_raises_when_both_providers_fail():
    def fake_fetch(url: str):
        raise TransientError("network down")

    with pytest.raises(TransientError):
        search_literature("agent", limit=3, fetch=fake_fetch)
