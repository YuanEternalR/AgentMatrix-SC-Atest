"""Compare all dispatch strategies offline and write a report.

Usage:
    python scripts/evaluate_strategies.py --count-per-type 8 --out docs/experiments

The output is **simulated** data: no LLM is called. It fixes the random draws
so that every strategy faces the same tasks under the same luck, which is what
makes the arms comparable. Real measurements replace this once the worker has
accumulated `run_steps`.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.services.dispatch import evaluate, to_markdown  # noqa: E402
from app.services.dispatch.fixtures import SEED_AGENTS, mock_planner, seed_scenarios  # noqa: E402
from app.services.dispatch.registry import all_names, build  # noqa: E402


def build_all():
    """Instantiate every registered strategy; s4 gets the offline planner stub."""
    strategies = []
    for name in all_names():
        planner = mock_planner if name == "s4_llm_planner" else None
        strategies.append(build(name, planner=planner))
    return strategies


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--count-per-type",
        type=int,
        default=8,
        help="how many scenarios to generate per task type (4 types)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "docs" / "experiments",
        help="directory for the markdown and csv report",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scenarios = seed_scenarios(args.count_per_type)
    reports = evaluate(build_all(), scenarios, SEED_AGENTS)

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    table = to_markdown(reports)
    heading = (
        f"# 调度策略离线对比（仿真）\n\n"
        f"- 生成时间(UTC): {stamp}\n"
        f"- 场景数: {len(scenarios)}（4 类任务 × {args.count_per_type}）\n"
        f"- 智能体数: {len(SEED_AGENTS)}\n"
        f"- 数据性质: **仿真数据**，未调用真实模型；随机抽样按任务固定，各策略同题同运\n"
        f"- 复现命令: `python scripts/evaluate_strategies.py --count-per-type {args.count_per_type}`\n\n"
        f"{table}\n"
    )
    md_path = args.out / "dispatch-comparison.md"
    md_path.write_text(heading, encoding="utf-8")

    csv_path = args.out / f"dispatch-comparison-{stamp}.csv"
    rows = [report.as_row() for report in reports]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(table)
    print(f"\nmarkdown -> {md_path}")
    print(f"csv      -> {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
