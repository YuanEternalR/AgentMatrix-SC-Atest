"""把 DataCo Smart Supply Chain 数据集清洗成订单级 CSV，并记录数据来源指纹。

原始数据是**订单明细级**（180,519 行，一行一个商品），这里按 Order Id 聚合为
**订单级**（延迟、状态、金额取订单代表值，数量与销售额求和），使"订单延迟异常"
场景可以直接按订单查询。

数据来源
--------
Kaggle: DataCo SMART SUPPLY CHAIN FOR BIG DATA ANALYSIS
https://www.kaggle.com/datasets/shashwatwork/dataco-smart-supply-chain-for-big-data-analysis
镜像下载：https://ghproxy.net/ + naak-ktr/Data-Analysis-on-DataCo-Supply-Chain
（Kaggle 需要登录，镜像仅为便于复现；引用时以 Kaggle 原始数据集为准）

用法：
    python scripts/import_dataco.py \
        --csv "path/to/DataCo Supply Chain Dataset.csv" \
        --out data/dataco_orders.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

SOURCE_URL = (
    "https://www.kaggle.com/datasets/shashwatwork/"
    "dataco-smart-supply-chain-for-big-data-analysis"
)

OUT_COLUMNS = [
    "order_id",
    "order_date",
    "shipping_date",
    "days_real",
    "days_scheduled",
    "delay_days",
    "delivery_status",
    "late_risk",
    "market",
    "order_region",
    "order_country",
    "order_city",
    "shipping_mode",
    "customer_segment",
    "department_name",
    "category_name",
    "quantity",
    "sales",
    "profit",
    "item_count",
]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def to_int(value: str | None) -> int | None:
    try:
        return int(float(value)) if value not in (None, "") else None
    except ValueError:
        return None


def to_float(value: str | None) -> float:
    try:
        return float(value) if value not in (None, "") else 0.0
    except ValueError:
        return 0.0


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--encoding", default="latin-1")
    args = parser.parse_args()

    if not args.csv.exists():
        raise SystemExit(f"找不到源文件：{args.csv}")

    source_hash = sha256_of(args.csv)

    orders: "OrderedDict[str, dict]" = OrderedDict()
    raw_rows = 0
    skipped = 0

    with args.csv.open(encoding=args.encoding, newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            raw_rows += 1
            order_id = (row.get("Order Id") or "").strip()
            if not order_id:
                skipped += 1
                continue

            days_real = to_int(row.get("Days for shipping (real)"))
            days_sched = to_int(row.get("Days for shipment (scheduled)"))
            delay = None
            if days_real is not None and days_sched is not None:
                delay = days_real - days_sched

            existing = orders.get(order_id)
            if existing is None:
                orders[order_id] = {
                    "order_id": order_id,
                    "order_date": parse_date(row.get("order date (DateOrders)")),
                    "shipping_date": parse_date(row.get("shipping date (DateOrders)")),
                    "days_real": days_real,
                    "days_scheduled": days_sched,
                    "delay_days": delay,
                    "delivery_status": (row.get("Delivery Status") or "").strip(),
                    "late_risk": to_int(row.get("Late_delivery_risk")) or 0,
                    "market": (row.get("Market") or "").strip(),
                    "order_region": (row.get("Order Region") or "").strip(),
                    "order_country": (row.get("Order Country") or "").strip(),
                    "order_city": (row.get("Order City") or "").strip(),
                    "shipping_mode": (row.get("Shipping Mode") or "").strip(),
                    "customer_segment": (row.get("Customer Segment") or "").strip(),
                    "department_name": (row.get("Department Name") or "").strip(),
                    "category_name": (row.get("Category Name") or "").strip(),
                    "quantity": to_int(row.get("Order Item Quantity")) or 0,
                    "sales": to_float(row.get("Sales")),
                    "profit": to_float(row.get("Order Profit Per Order")),
                    "item_count": 1,
                }
            else:
                existing["quantity"] += to_int(row.get("Order Item Quantity")) or 0
                existing["sales"] += to_float(row.get("Sales"))
                existing["profit"] += to_float(row.get("Order Profit Per Order"))
                existing["item_count"] += 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(OUT_COLUMNS)
        for order in orders.values():
            writer.writerow(
                [
                    order["order_id"],
                    order["order_date"].isoformat(sep=" ") if order["order_date"] else "",
                    order["shipping_date"].isoformat(sep=" ") if order["shipping_date"] else "",
                    order["days_real"] if order["days_real"] is not None else "",
                    order["days_scheduled"] if order["days_scheduled"] is not None else "",
                    order["delay_days"] if order["delay_days"] is not None else "",
                    order["delivery_status"],
                    order["late_risk"],
                    order["market"],
                    order["order_region"],
                    order["order_country"],
                    order["order_city"],
                    order["shipping_mode"],
                    order["customer_segment"],
                    order["department_name"],
                    order["category_name"],
                    order["quantity"],
                    f"{order['sales']:.2f}",
                    f"{order['profit']:.2f}",
                    order["item_count"],
                ]
            )

    delays = [o["delay_days"] for o in orders.values() if o["delay_days"] is not None]
    late = sum(1 for o in orders.values() if o["delivery_status"] == "Late delivery")
    on_time = sum(1 for o in orders.values() if o["delivery_status"] == "Shipping on time")
    advance = sum(1 for o in orders.values() if o["delivery_status"] == "Advance shipping")

    manifest = {
        "dataset": "DataCo Smart Supply Chain",
        "source_url": SOURCE_URL,
        "source_file": args.csv.name,
        "source_sha256": source_hash,
        "source_bytes": args.csv.stat().st_size,
        "imported_at": datetime.now().isoformat(timespec="seconds"),
        "raw_rows": raw_rows,
        "skipped_rows": skipped,
        "orders": len(orders),
        "output_file": args.out.name,
        "output_sha256": sha256_of(args.out),
        "stats": {
            "late_delivery": late,
            "shipping_on_time": on_time,
            "advance_shipping": advance,
            "late_rate": round(late / len(orders), 4) if orders else 0.0,
            "otif_rate": round(on_time / len(orders), 4) if orders else 0.0,
            "delay_days_mean": round(sum(delays) / len(delays), 3) if delays else 0.0,
            "delay_days_max": max(delays) if delays else 0,
            "delay_days_min": min(delays) if delays else 0,
        },
    }
    manifest_path = args.out.with_suffix(".manifest.json")
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"源文件行数：{raw_rows:,}（跳过 {skipped}）")
    print(f"聚合后订单：{len(orders):,}")
    print(
        f"延迟分布：均值 {manifest['stats']['delay_days_mean']} 天，"
        f"范围 {manifest['stats']['delay_days_min']} ~ {manifest['stats']['delay_days_max']} 天"
    )
    print(
        f"交付状态：准时 {on_time:,} / 延迟 {late:,} / 提前 {advance:,}"
        f"（准时率 {manifest['stats']['otif_rate']:.2%}）"
    )
    print(f"源文件 SHA256：{source_hash}")
    print(f"已写出：{args.out}、{manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
