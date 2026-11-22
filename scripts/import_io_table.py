"""把 ChinAPIs 的 R 数据文件（.rda）转成 industry_chain.py 可读的 CSV。

数据来源：国家统计局《中国投入产出表》，经 CRAN 包 ChinAPIs 整理
（https://cran.r-project.org/package=ChinAPIs ）。本脚本只做格式转换，
不改动任何数值。

用法：
    python scripts/import_io_table.py --rda data-raw/ChinAPIs/data/china_io_2020_153_df.rda \
        --out data/io_2020_153.csv

输出 CSV 结构：第一列部门名，其后 153 列是部门间的中间流量，最后一列是"总产出"。
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


def load_rda(path: Path):
    import pyreadr  # 延迟导入，未安装时给出可读的提示

    result = pyreadr.read_r(str(path))
    if not result:
        raise ValueError(f"{path} 里没有可读对象")
    key = next(iter(result))
    return key, result[key]


def detect_layout(df):
    """识别部门列与总产出列。返回 (部门列名列表, 总产出列名)。"""
    meta = [c for c in df.columns if c in ("Code", "Description", "DescriptionInChinese")]
    sector_cols = [c for c in df.columns if c not in meta and c.isdigit() and len(c) == 3]
    if not sector_cols:
        raise ValueError("找不到三位数字编码的部门列（001…153）")
    if "GO" not in df.columns:
        raise ValueError("找不到总产出列 GO")
    return sector_cols, "GO"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rda", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--names", choices=("chinese", "english"), default="chinese")
    args = parser.parse_args()

    key, df = load_rda(args.rda)
    sector_cols, go_col = detect_layout(df)
    n = len(sector_cols)

    # 前 n 行是部门行；其后的 TII / VA* / TVA / TI 是合计行，必须排除
    sectors = df.head(n)
    if len(sectors) != n:
        raise ValueError(f"部门行数不足：期望 {n}，实际 {len(sectors)}")

    name_col = "DescriptionInChinese" if args.names == "chinese" else "Description"
    names = [str(v) for v in sectors[name_col].tolist()]

    flows = sectors[sector_cols].to_numpy(dtype=float)
    outputs = sectors[go_col].to_numpy(dtype=float)

    if (outputs <= 0).any():
        bad = [names[i] for i in range(n) if outputs[i] <= 0]
        raise ValueError(f"总产出非正：{bad[:5]}（数据可能不完整）")

    # 一致性校验：中间投入合计列（TII）应等于流量矩阵的行和
    row_sums = flows.sum(axis=1)
    if "TII" in sectors.columns:
        tii = sectors["TII"].to_numpy(dtype=float)
        max_dev = float(abs(row_sums - tii).max())
        rel = max_dev / max(float(outputs.mean()), 1.0)
        print(f"一致性校验：行和 vs TII 最大偏差 {max_dev:.2f}（相对 {rel:.2e}）")
        if rel > 1e-6:
            print("警告：偏差偏大，请确认表结构", file=sys.stderr)
    else:
        print("未找到 TII 列，跳过一次致性校验")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["部门"] + sector_cols + ["总产出"])
        for i in range(n):
            writer.writerow(
                [names[i]] + [f"{v:.6f}" for v in flows[i]] + [f"{outputs[i]:.6f}"]
            )

    total_output = float(outputs.sum())
    total_flow = float(flows.sum())
    print(f"对象名：{key}")
    print(f"部门数：{n}")
    print(f"中间流量合计：{total_flow:,.0f}   总产出合计：{total_output:,.0f}")
    print(f"已写出：{args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
