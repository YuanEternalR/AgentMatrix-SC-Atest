# 真实数据接入

> 平台接入**两个真实数据源**：订单履约（DataCo，65,752 单，
> **运行时读真表**，业务看板、订单查询与履约诊断均使用它）与产业链关联度
> （国家统计局 2020 年投入产出表，153 部门，**离线计算**，作为矩阵阶段划分与
> 履约系数的依据）。两者均由真实数据计算。
>
> 注：原「文献检索（OpenAlex）」章节已随科研域下线一并移除，产品定位为纯供应链。
>
> 仍无真实数据的部分在「明确没有真实数据的地方」一节逐条列出；原始数据文件与派生 CSV 不入库（见第 3 节）。

## 1. 订单履约：DataCo Smart Supply Chain

| 项 | 值 |
|---|---|
| 原始来源 | Kaggle: *DataCo SMART SUPPLY CHAIN FOR BIG DATA ANALYSIS*（`https://www.kaggle.com/datasets/shashwatwork/dataco-smart-supply-chain-for-big-data-analysis`） |
| 下载方式 | Kaggle 需登录；本机首次获取时经 GitHub 镜像（`ghproxy.net` 中转）。**原始 CSV 与 `data/` 下的派生 CSV 不入库**，公开克隆需按第 3 节自行下载复现 |
| 原始规模 | 180,519 行 × 53 列（订单**明细**级，一行一个商品） |
| 聚合后 | **65,752 个订单**（按 Order Id 聚合） |
| 源文件 SHA256 | `fa6d022ed437155e1a2f0378710602848703c8a7f203f7ff5d77805bf8480aa6` |
| 时间范围 | 2015-01 至 2018-01 |
| 覆盖区域 | LATAM / Europe / Pacific Asia / USCA / Africa，23 个地区 |

### 关键统计（2026-11-23 从 `/orders/stats` 实测，全部从数据算出）

| 指标 | 值 | 说明 |
|---|---|---|
| 准时交付 | 11,722 单 | `Delivery Status = Shipping on time` |
| 延迟交付 | 36,048 单 | `Late delivery` |
| 提前送达 | 15,127 单 | `Advance shipping` |
| 已取消 | 2,855 单 | `Shipping canceled`（三类合计 62,897，加此项为 65,752） |
| **准时率（`otif_rate` 字段）** | **17.83%** | `Delivery Status = Shipping on time` / 总单 = 11,722 / 65,752；**不是严格 OTIF**（in-full 未计算，见下） |
| **延迟率** | **54.82%** | — |
| 平均延迟 | 0.567 天 | `delay = 实际运输天数 - 承诺天数`，范围 −2 ~ +4 天 |

> **`otif_rate` 的口径**：严格 OTIF = On-Time **In-Full**，要求同一订单同时满足
> "按时"与"整单齐发"。DataCo 只提供订单级的 `Delivery Status`，没有行级齐套信息，所以
> 系统里的 `otif_rate` 实际是**准时率**：`Shipping on time` 单数 ÷ 总单数 = 11,722 / 65,752 = 17.83%。
> 它**不含 in-full 维度**，对外表述为"准时率（字段名沿用 `otif_rate`）"，不作为严格 OTIF。

### 按运输方式的真实差异

| 运输方式 | 订单数 | 平均延迟 |
|---|---|---|
| Standard Class | 39,324 | −0.003 天（几乎不延迟） |
| **Second Class** | 12,778 | **+2.002 天（最差）** |
| First Class | 10,079 | +1.000 天 |
| Same Day | 3,571 | +0.484 天 |

Second Class 的平均延迟是标准配送的 600 倍以上，属于经典的服务分层问题，可直接写入论文结论。

### 字段映射

| DataCo 字段 | 本系统表里的列 | 用途 |
|---|---|---|
| `Order Id` | `supply_orders.order_id` | 主键 |
| `Days for shipping (real)` | `days_real` | 实际运输天数 |
| `Days for shipment (scheduled)` | `days_scheduled` | 承诺天数 |
| 两者之差 | `delay_days` | 延迟天数（负值为提前） |
| `Delivery Status` | `delivery_status` | 准时/延迟/提前 |
| `Late_delivery_risk` | `late_risk` | 0/1 风险标记 |
| `Order Region / City / Country` | `order_region` 等 | 地理维度 |
| `Shipping Mode` | `shipping_mode` | 运输方式 |
| `Category / Department Name` | `category_name` / `department_name` | 品类维度 |
| `Order Item Quantity` | `quantity` | 按订单求和 |
| `Sales` / `Order Profit Per Order` | `sales` / `profit` | 按订单求和 |

## 2. 产业链：中国 2020 年投入产出表

| 项 | 值 |
|---|---|
| 来源 | 国家统计局《中国投入产出表》，经 CRAN 包 `ChinAPIs` 整理 |
| 获取 | `ChinAPIs 0.2.0` 的 `china_io_2020_153_df.rda`（原始 rda 不入库，按第 3 节用 `import_io_table.py` 转 CSV） |
| 规模 | 153 部门 × 153 部门中间流量矩阵 |
| 单位 | 万元 |
| 校验 | 总产出合计 269.9 万亿元（与统计口径一致） |

计算结果见 [industry-chain.md](industry-chain.md)，关键结论：

- **影响力系数 Top（拉动上游）**：计算机 1.4613、视听设备 1.4288、通信设备 1.4098
  ——电子制造是典型的"总装型"高后向关联部门；
- **感应度系数 Top（被下游拉动）**：电力热力 5.0939、电子元器件 4.8286、农产品 4.5521、
  金融 4.1602 ——能源与基础材料是"卡脖子"节点。

## 3. 复现步骤

前置：仓库**不含**原始数据集与 `data/` 派生 CSV——订单数据集需自行从 Kaggle 下载（第 1 节），
投入产出表的 rda 见第 2 节来源；`data/` 下的派生文件被 `.gitignore` 排除，只有
`data/dataco_orders.manifest.json` 该校验清单入库。下载后在**仓库根目录**执行：

```powershell
# 1) 订单数据（原始 CSV 按第 1 节来源下载到 data-raw/）
python scripts/import_dataco.py --csv "data-raw/dataco/DataCo Supply Chain Dataset.csv" --out data/dataco_orders.csv
wsl -d Ubuntu-AgentMatrix -u root -- bash scripts/load_dataco.sh

# 2) 投入产出表（ChinAPIs 包的 rda；下载到 data-raw/ChinAPIs/）
python scripts/import_io_table.py --rda data-raw/ChinAPIs/data/china_io_2020_153_df.rda --out data/io_2020_153.csv
python scripts/industry_chain.py --csv data/io_2020_153.csv --out docs/experiments
```

- 两个导入脚本与 `industry_chain.py` 只用 Python 标准库，宿主机 Python 即可跑（无需额外依赖）；
- `scripts/load_dataco.sh` 通过 `docker compose exec postgres` 导入，**要求平台已起**（`dev up`）——
  环境准备见 [environment-setup.md](environment-setup.md)；
- `import_dataco.py` 会写出 SHA256 清单 `data/dataco_orders.manifest.json`（源文件哈希、行数、
  聚合订单数、关键统计都在里面）；**该清单入库**，是公开仓库里唯一的数据校验凭据；
- 投入产出脚本只写 CSV/JSON/Markdown，不写清单。

## 4. 平台里哪些地方现在读真数据

| 位置 | 数据源 | 说明 |
|---|---|---|
| `GET /orders`、`/orders/stats`、`/orders/{id}` | `supply_orders` | 65,752 单明细与聚合统计 |
| 订单延迟异常工作流的 `fetch_order` 节点 | 同上 | 查不到就返回 `found: false`，不编造数字 |
| `assess_impact` 节点 | 上一步输出 | 用真实延迟天数与销售额算影响分 |
| `GET /business`（业务看板） | `supply_orders` 按日聚合 | 准时率/延迟率/平均延迟/订单量 |
| 前端「可视化 → 履约趋势」 | 同上 | 标注了真实数据来源与总订单数 |

## 5. 明确没有真实数据的地方

本章列出仍无真实数据支撑的部分，避免把仿真数据当作真实数据：

| 项目 | 现状 | 原因 |
|---|---|---|
| 库存周转、缺货率、供应商风险分布 | **已移除**（原实现由哈希生成） | DataCo 没有库存与供应商维度 |
| `inventory_query`、`supplier_score` 技能 | 仍为确定性占位实现 | 需要 WMS/ERP 数据，公开数据集不提供 |
| 智能体的成功率 / 时延 / 均价标签（`agents.*`） | 种子常量，尚未由 `run_steps` 滚动聚合刷新 | 这是"智能体性能"标签，不是业务数据；`docs/architecture.md` §9 已把它列为已知局限 |
| 运行的耗时 / Token / 成本（`runs` / `run_steps`） | 真实执行累计 | 接真实模型后由每次调用计量，成本与耗时是真实产生的 |


## 6. 下一步

1. **库存与供应商**：引入公开的零售库存数据集（如 M5 的补货数据）补齐该维度；
2. **产业链阶段映射**：153 部门已按矩阵的阶段汇总（方法与口径见
   [experiments/matrix-stage-basis.md](experiments/matrix-stage-basis.md)）；其中「生产协同」
   「售后逆向」在投入产出表里没有直接对应部门，后续需补替代依据。
