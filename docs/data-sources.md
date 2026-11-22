# 真实数据接入

> 结论：平台现在有**两个真实数据源**——订单履约（DataCo，65,752 单）与产业链关联度
> （国家统计局 2020 年投入产出表，153 部门）。业务看板、订单查询与履约诊断都读真表，
> 不再用哈希编造数字。
>
> 注：原「文献检索（OpenAlex）」章节已随科研域下线一并移除，产品定位为纯供应链。
>
> 仍然没有真实数据的地方，本文最后一节逐条列出。

## 1. 订单履约：DataCo Smart Supply Chain

| 项 | 值 |
|---|---|
| 原始来源 | Kaggle: *DataCo SMART SUPPLY CHAIN FOR BIG DATA ANALYSIS* |
| 下载方式 | Kaggle 需登录；本次经 GitHub 镜像（`ghproxy.net` 中转）获取，便于复现 |
| 原始规模 | 180,519 行 × 53 列（订单**明细**级，一行一个商品） |
| 聚合后 | **65,752 个订单**（按 Order Id 聚合） |
| 源文件 SHA256 | `fa6d022ed437155e1a2f0378710602848703c8a7f203f7ff5d77805bf8480aa6` |
| 时间范围 | 2015-01 至 2018-01 |
| 覆盖区域 | LATAM / Europe / Pacific Asia / USCA / Africa，23 个地区 |

### 关键统计（全部从数据算出）

| 指标 | 值 | 说明 |
|---|---|---|
| 准时交付 | 11,722 单 | `Delivery Status = Shipping on time` |
| 延迟交付 | 36,048 单 | `Late delivery` |
| 提前送达 | 15,127 单 | `Advance shipping` |
| **准时率** | **17.83%** | 这个数据集的真实分布，不是我们编的 |
| **延迟率** | **54.82%** | — |
| 平均延迟 | 0.567 天 | `delay = 实际运输天数 - 承诺天数`，范围 −2 ~ +4 天 |

### 按运输方式的真实差异（一个可用的业务发现）

| 运输方式 | 订单数 | 平均延迟 |
|---|---|---|
| Standard Class | 39,324 | −0.003 天（几乎不延迟） |
| **Second Class** | 12,778 | **+2.002 天（最差）** |
| First Class | 10,079 | +1.000 天 |
| Same Day | 3,571 | +0.484 天 |

"付得更快反而更慢"——Second Class 的平均延迟是标准配送的 600 倍以上，
这是一个可以直接写进论文结论的观察（它也是经典的服务分层问题）。

### 字段映射

| DataCo 字段 | 我们表里的列 | 用途 |
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
| 获取 | `ChinAPIs 0.2.0` 的 `china_io_2020_153_df.rda`（1.6 MB） |
| 规模 | 153 部门 × 153 部门中间流量矩阵 |
| 单位 | 万元 |
| 校验 | 总产出合计 269.9 万亿元（与统计口径一致） |

计算结果见 [industry-chain.md](industry-chain.md)，关键结论：

- **影响力系数 Top（拉动上游）**：计算机 1.4613、视听设备 1.4288、通信设备 1.4098
  ——电子制造是典型的"总装型"高后向关联部门；
- **感应度系数 Top（被下游拉动）**：电力热力 5.0939、电子元器件 4.8286、农产品 4.5521、
  金融 4.1602 ——能源与基础材料是"卡脖子"节点。

## 3. 复现步骤

```powershell
# 1) 订单数据（已下载到 data-raw/，可跳过）
python scripts/import_dataco.py --csv "data-raw/dataco/DataCo Supply Chain Dataset.csv" --out data/dataco_orders.csv
wsl -d Ubuntu-AgentMatrix -u root -- bash scripts/load_dataco.sh

# 2) 投入产出表（已下载到 data-raw/ChinAPIs/）
python scripts/import_io_table.py --rda data-raw/ChinAPIs/data/china_io_2020_153_df.rda --out data/io_2020_153.csv
python scripts/industry_chain.py --csv data/io_2020_153.csv --out docs/experiments
```

两个导入脚本都会写出 **SHA256 清单**（`data/dataco_orders.manifest.json`），
保证"数据可再现"这件事有据可查：同一份源文件必然得到同一份统计。

## 4. 平台里哪些地方现在读真数据

| 位置 | 数据源 | 说明 |
|---|---|---|
| `GET /orders`、`/orders/stats`、`/orders/{id}` | `supply_orders` | 65,752 单明细与聚合统计 |
| 订单延迟异常工作流的 `fetch_order` 节点 | 同上 | 查不到就返回 `found: false`，不再编数字 |
| `assess_impact` 节点 | 上一步输出 | 用真实延迟天数与销售额算影响分 |
| `GET /business`（业务看板） | `supply_orders` 按日聚合 | 准时率/延迟率/平均延迟/订单量 |
| 前端「可视化 → 履约趋势」 | 同上 | 标注了真实数据来源与总订单数 |

## 5. 明确没有真实数据的地方

诚实清单，避免把仿真说成真实：

| 项目 | 现状 | 原因 |
|---|---|---|
| 库存周转、缺货率、供应商风险分布 | **已移除**（原来是用哈希编的） | DataCo 没有库存与供应商维度 |
| `inventory_query`、`supplier_score` 技能 | 仍为确定性占位实现 | 需要 WMS/ERP 数据，公开数据集不提供 |
| 智能体成功率 / 时延 / Token 成本 | 种子常量 + 实际执行累计 | 这是"智能体性能"，不是业务数据；但**成本与耗时是真实产生的** |


## 6. 下一步

2. **库存与供应商**：找公开的零售库存数据集（如 M5 的补货数据）补上这一块；
3. **产业链阶段映射**：把 153 部门按我们的七行映射，产出"矩阵行的数据依据表"。
