"""产业链关联度计算：投入产出表 → 影响力系数 / 感应度系数 / 上下游强度。

方法说明见 docs/industry-chain.md。输入是一张投入产出表的"中间流量矩阵"与
"总产出向量"，输出各部门的关联度指标，用于判断产业链上的关键节点。

用法：
    python scripts/industry_chain.py --demo
    python scripts/industry_chain.py --csv data/io_2020.csv --out docs/experiments

CSV 约定：第一行是列名（部门名），第一列是行名（部门名），单元格是中间流量 x_ij；
总产出通过 --outputs 指定一列（默认查找名为 "总产出" 的列）。

纯标准库实现（不依赖 numpy），部门数在几百以内都够用。
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path


# ---------------------------------------------------------------------------
# 线性代数：只用标准库
# ---------------------------------------------------------------------------


def mat_inverse(matrix: list[list[float]]) -> list[list[float]]:
    """高斯-约当法求逆。奇异矩阵抛 ValueError（说明表不可用）。"""
    n = len(matrix)
    aug = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(matrix)]

    for col in range(n):
        pivot_row = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot_row][col]) < 1e-12:
            raise ValueError(f"矩阵奇异：第 {col} 列无主元（投入产出表可能不完整）")
        aug[col], aug[pivot_row] = aug[pivot_row], aug[col]

        pivot = aug[col][col]
        aug[col] = [v / pivot for v in aug[col]]

        for row in range(n):
            if row == col:
                continue
            factor = aug[row][col]
            if factor == 0:
                continue
            aug[row] = [v - factor * p for v, p in zip(aug[row], aug[col])]

    return [row[n:] for row in aug]


# ---------------------------------------------------------------------------
# 投入产出计算
# ---------------------------------------------------------------------------


@dataclass
class ChainResult:
    sectors: list[str]
    influence: list[float]        # 影响力系数（后向关联）
    sensitivity: list[float]      # 感应度系数（前向关联）
    total_output: list[float]
    direct_consumption: list[list[float]]

    def as_dict(self) -> dict:
        ranked_influence = sorted(
            zip(self.sectors, self.influence), key=lambda kv: kv[1], reverse=True
        )
        ranked_sensitivity = sorted(
            zip(self.sectors, self.sensitivity), key=lambda kv: kv[1], reverse=True
        )
        return {
            "sectors": self.sectors,
            "influence": {s: round(v, 4) for s, v in zip(self.sectors, self.influence)},
            "sensitivity": {s: round(v, 4) for s, v in zip(self.sectors, self.sensitivity)},
            "top_influence": [{"sector": s, "value": round(v, 4)} for s, v in ranked_influence[:10]],
            "top_sensitivity": [
                {"sector": s, "value": round(v, 4)} for s, v in ranked_sensitivity[:10]
            ],
        }


def compute_chain(
    flows: list[list[float]],
    total_output: list[float],
    sectors: list[str],
) -> ChainResult:
    """由中间流量矩阵计算关联度系数。

    flows[i][j] = 部门 i 的产品被部门 j 消耗的数量（行=供给方，列=需求方）。
    A[i][j] = flows[i][j] / total_output[j]（直接消耗系数）
    L = (I - A)^-1（列昂惕夫逆矩阵）

    影响力系数（部门 j 增加 1 单位最终需求，对全体系的拉动）：
        f_j = (Σ_i L[i][j]) / (1/n · Σ_i Σ_j L[i][j])
    感应度系数（全体系各增 1 单位，部门 i 被拉动多少）：
        e_i = (Σ_j L[i][j]) / (1/n · Σ_i Σ_j L[i][j])
    """
    n = len(flows)
    if n == 0 or len(total_output) != n or len(sectors) != n:
        raise ValueError("矩阵维度不一致")
    if any(x <= 0 for x in total_output):
        raise ValueError("总产出必须为正数（检查表里是否混入了合计行）")

    # 直接消耗系数
    a = [[flows[i][j] / total_output[j] for j in range(n)] for i in range(n)]

    # I - A
    identity_minus_a = [
        [(1.0 if i == j else 0.0) - a[i][j] for j in range(n)] for i in range(n)
    ]
    leontief = mat_inverse(identity_minus_a)

    column_sums = [sum(leontief[i][j] for i in range(n)) for j in range(n)]
    row_sums = [sum(leontief[i][j] for j in range(n)) for i in range(n)]
    grand = sum(column_sums) / n

    influence = [s / grand for s in column_sums]
    sensitivity = [s / grand for s in row_sums]

    return ChainResult(
        sectors=sectors,
        influence=influence,
        sensitivity=sensitivity,
        total_output=list(total_output),
        direct_consumption=a,
    )


# ---------------------------------------------------------------------------
# 示意数据（不是真实统计！用于验证算法）
# ---------------------------------------------------------------------------

DEMO_SECTORS = ["农业", "采矿", "制造业", "电力", "运输", "批发零售", "金融"]
DEMO_OUTPUT = [1000.0, 800.0, 3000.0, 600.0, 900.0, 1200.0, 700.0]
DEMO_FLOWS = [
    [60, 2, 300, 0, 2, 10, 1],
    [10, 90, 240, 120, 10, 5, 1],
    [120, 60, 900, 90, 80, 180, 20],
    [20, 40, 210, 60, 30, 40, 5],
    [30, 30, 300, 20, 90, 70, 10],
    [40, 10, 240, 10, 20, 120, 15],
    [15, 10, 90, 10, 15, 30, 25],
]


def load_csv(path: Path, output_column: str) -> tuple[list[list[float]], list[float], list[str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 3:
        raise ValueError("CSV 至少需要表头 + 两行数据")

    header = rows[0]
    if output_column not in header:
        raise ValueError(f"找不到列「{output_column}」，现有列：{header}")
    output_index = header.index(output_column)

    sectors: list[str] = []
    flows: list[list[float]] = []
    outputs: list[float] = []

    for row in rows[1:]:
        if not row or not row[0].strip():
            continue
        sectors.append(row[0].strip())
        values = [float(cell) if cell.strip() else 0.0 for cell in row[1:]]
        flows.append(values)
        outputs.append(values[output_index - 1])

    return flows, outputs, sectors


def to_markdown(result: ChainResult, title: str) -> str:
    data = result.as_dict()
    lines = [f"# {title}", "", "## 影响力系数 Top（后向关联：拉动上游）", "", "| 部门 | 系数 |", "|---|---|"]
    for item in data["top_influence"]:
        lines.append(f"| {item['sector']} | {item['value']} |")
    lines += ["", "## 感应度系数 Top（前向关联：被下游拉动）", "", "| 部门 | 系数 |", "|---|---|"]
    for item in data["top_sensitivity"]:
        lines.append(f"| {item['sector']} | {item['value']} |")
    lines += [
        "",
        "> 系数 > 1 表示该部门在产业链上的关联度高于平均水平，是结构性关键节点。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="投入产出表 CSV")
    parser.add_argument("--outputs", default="总产出", help="总产出所在列名")
    parser.add_argument("--demo", action="store_true", help="用内置示意数据跑一遍")
    parser.add_argument("--out", type=Path, help="输出目录（写 json + md）")
    args = parser.parse_args()

    if args.demo:
        flows, outputs, sectors = DEMO_FLOWS, DEMO_OUTPUT, DEMO_SECTORS
        title = "产业链关联度（示意数据，非真实统计）"
    elif args.csv:
        flows, outputs, sectors = load_csv(args.csv, args.outputs)
        title = f"产业链关联度：{args.csv.name}"
    else:
        parser.error("需要 --csv 或 --demo")
        return 2

    try:
        result = compute_chain(flows, outputs, sectors)
    except ValueError as exc:
        print(f"计算失败：{exc}", file=sys.stderr)
        return 1

    print(to_markdown(result, title))

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        stem = "industry-chain-demo" if args.demo else args.csv.stem
        (args.out / f"{stem}.json").write_text(
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (args.out / f"{stem}.md").write_text(to_markdown(result, title), encoding="utf-8")
        print(f"\n已写出：{args.out / (stem + '.json')}、{args.out / (stem + '.md')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
