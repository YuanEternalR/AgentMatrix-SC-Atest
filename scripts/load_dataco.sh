#!/usr/bin/env bash
# 把清洗后的 DataCo 订单 CSV 导入 supply_orders 表。
# 用脚本而不是一行命令，是为了避开 wsl.exe + bash 的多层引号问题。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSV="$REPO/data/dataco_orders.csv"

if [ ! -f "$CSV" ]; then
  echo "找不到 CSV：$CSV（先跑 scripts/import_dataco.py）" >&2
  exit 1
fi

cd "$REPO/infra"
docker compose exec -T postgres psql -U agentmatrix -d agentmatrix -v ON_ERROR_STOP=1 \
  -c "SET client_encoding TO 'UTF8';" \
  -c "\copy supply_orders FROM STDIN WITH (FORMAT csv, HEADER true)" \
  < "$CSV"

echo "导入完成"
docker compose exec -T postgres psql -U agentmatrix -d agentmatrix -c \
  "select count(*) as orders, round(avg(delay_days),3) as avg_delay, round(100.0*count(*) filter (where delivery_status='Shipping on time')/count(*),2) as on_time_pct from supply_orders;"
