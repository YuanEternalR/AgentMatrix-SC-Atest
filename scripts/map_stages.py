"""把 153 个投入产出部门映射到智能体矩阵的七个阶段，并按阶段汇总关联度。

为什么要做这件事：矩阵的七行（需求计划/采购寻源/仓储库存/运输物流/履约交付/
合规风控/科研流程）原本是经验划分。这里用真实的产业关联度数据回答
"哪一行更关键、缺口落在哪一行影响更大"。

映射规则是**有序关键字匹配**，第一条命中即归类；最后必须覆盖全部部门，
否则脚本报错退出（不允许静默丢弃部门）。

用法：
    python scripts/map_stages.py --io data/io_2020_153.csv --chain docs/experiments/io_2020_153.json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

# 矩阵的七个阶段，顺序即展示顺序
STAGES = [
    ("demand_planning", "需求计划"),
    ("procurement", "采购寻源"),
    ("warehousing", "仓储库存"),
    ("transportation", "运输物流"),
    ("fulfillment", "履约交付"),
    ("compliance", "合规风控"),
    ("research", "科研流程"),
]

# 有序规则：(阶段, 关键字元组)。先匹配先归类，所以"更具体"的放前面。
RULES: list[tuple[str, tuple[str, ...]]] = [
    # 科研与知识服务（最具体，先归）
    ("research", ("研究和试验发展", "科技推广", "教育", "软件服务", "信息技术服务")),
    # 合规与金融服务
    ("compliance", ("货币金融", "资本市场", "保险", "商务服务", "公共管理", "房地产", "租赁")),
    # 仓储（先于运输，避免"装卸搬运和仓储"被运输规则吃掉）
    ("warehousing", ("装卸搬运和仓储",)),
    # 运输物流
    ("transportation", ("运输", "多式联运", "邮政", "城市公共交通")),
    # 需求侧
    ("demand_planning", ("批发", "零售", "住宿", "餐饮", "居民服务", "其他服务")),
    # 能源与基础原材料 → 采购寻源
    (
        "procurement",
        (
            "农产品", "林产品", "畜牧产品", "渔产品", "农林牧渔服务",
            "开采", "矿采选", "精炼石油", "煤炭加工", "基础化学", "肥料", "农药",
            "涂料", "合成材料", "专用化学", "日用化学", "化学纤维", "橡胶制品",
            "塑料制品", "水泥", "石膏", "砖瓦", "玻璃", "陶瓷", "耐火材料",
            "石墨", "钢", "铁及铁合金", "有色金属", "金属制品", "废弃资源",
            "电力、热力", "燃气生产", "水的生产",
        ),
    ),
]

# 兜底：剩下的都是制造与建筑，归履约交付
DEFAULT_STAGE = "fulfillment"

STAGE_NAME = dict(STAGES)


def classify(sector: str) -> str:
    for stage, keywords in RULES:
        if any(k in sector for k in keywords):
            return stage
    return DEFAULT_STAGE


def load_chain(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "influence" not in data or "sensitivity" not in data:
        raise SystemExit(f"{path} 不是 industry_chain.py 的输出（缺 influence/sensitivity）")
    return data


def load_outputs(path: Path) -> tuple[list[str], list[float]]:
    rows = list(csv.reader(path.open(encoding="utf-8-sig")))
    header = rows[0]
    idx = header.index("总产出") - 1
    names, outputs = [], []
    for row in rows[1:]:
        if not row or not row[0].strip():
            continue
        names.append(row[0].strip())
        outputs.append(float(row[1:][idx]))
    return names, outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--io", type=Path, required=True)
    parser.add_argument("--chain", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    chain = load_chain(args.chain)
    names, outputs = load_outputs(args.io)

    if len(names) != len(outputs):
        raise SystemExit("部门数与总产出数不一致")

    missing = [n for n in names if n not in chain["influence"]]
    if missing:
        raise SystemExit(f"以下部门在关联度结果里找不到：{missing[:5]}")

    total_output = sum(outputs)
    buckets: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    for name, go in zip(names, outputs):
        stage = classify(name)
        buckets[stage].append((name, go, chain["influence"][name]))
        buckets[stage][-1] = (name, go, chain["influence"][name])

    # 校验：每个部门都必须落到某个阶段
    assigned = sum(len(v) for v in buckets.values())
    if assigned != len(names):
        raise SystemExit(f"映射覆盖不全：{assigned}/{len(names)}")

    rows = []
    for code, label in STAGES:
        items = buckets.get(code, [])
        if not items:
            rows.append(
                {
                    "stage": code,
                    "label": label,
                    "sectors": 0,
                    "output_share": 0.0,
                    "influence": 0.0,
                    "sensitivity": 0.0,
                    "top_sectors": [],
                }
            )
            continue
        output_sum = sum(go for _, go, _ in items)
        weights = [go / output_sum if output_sum else 0.0 for _, go, _ in items]
        influence = sum(w * chain["influence"][n] for (n, _, _), w in zip(items, weights))
        sensitivity = sum(w * chain["sensitivity"][n] for (n, _, _), w in zip(items, weights))
        top = sorted(
            ((n, chain["sensitivity"][n]) for n, _, _ in items),
            key=lambda kv: kv[1],
            reverse=True,
        )[:3]
        rows.append(
            {
                "stage": code,
                "label": label,
                "sectors": len(items),
                "output_share": round(output_sum / total_output, 4),
                "influence": round(influence, 4),
                "sensitivity": round(sensitivity, 4),
                "top_sectors": [{"name": n, "sensitivity": round(v, 3)} for n, v in top],
            }
        )

    # 关键度 = 影响力 + 感应度，用于给出优先级排序（口径写明，可被质疑但可复现）
    for row in rows:
        row["criticality"] = round(row["influence"] + row["sensitivity"], 4)
    ranked = sorted(rows, key=lambda r: r["criticality"], reverse=True)

    print(f"{'阶段':<8}{'部门数':>6}{'产出占比':>10}{'影响力':>10}{'感应度':>10}{'关键度':>10}")
    for r in rows:
        print(
            f"{r['label']:<8}{r['sectors']:>6}{r['output_share']*100:>9.1f}%"
            f"{r['influence']:>10.3f}{r['sensitivity']:>10.3f}{r['criticality']:>10.3f}"
        )
    print("\n关键度排序：" + " > ".join(f"{r['label']}({r['criticality']:.2f})" for r in ranked))

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps({"stages": rows, "ranking": [r["stage"] for r in ranked]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n已写出：{args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
