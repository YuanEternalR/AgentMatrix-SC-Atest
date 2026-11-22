import { useEffect, useMemo, useState } from 'react';
import { api, type BusinessData, type CollaborationData, type SankeyData } from '../api';
import { EChart } from '../components/EChart';

const AGENT_COLOR = '#7c3aed';
const SKILL_COLOR = '#0ea5e9';

export function Analytics() {
  const [collab, setCollab] = useState<CollaborationData | null>(null);
  const [sankey, setSankey] = useState<SankeyData | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getCollaboration(), api.getSankey(), api.getBusiness(30)])
      .then(([c, s, b]) => {
        setCollab(c);
        setSankey(s);
        setBusiness(b);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const collabOption = useMemo(() => {
    if (!collab || collab.nodes.length === 0) return {};
    return {
      tooltip: {
        formatter: (params: { dataType?: string; data?: { name?: string; value?: number; source?: string; target?: string } }) => {
          const d = params.data ?? {};
          if (params.dataType === 'edge') return `${d.source} → ${d.target}：${d.value} 次`;
          return `${d.name}：${d.value ?? 0} 次调用`;
        },
      },
      legend: { data: ['智能体', '技能'], top: 0, right: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          force: { repulsion: 320, edgeLength: [90, 150] },
          label: { show: true, fontSize: 11, color: '#0f172a' },
          categories: [{ name: '智能体' }, { name: '技能' }],
          data: collab.nodes.map((n) => ({
            id: n.id,
            name: n.name,
            value: n.calls,
            category: n.kind === 'agent' ? 0 : 1,
            symbolSize: Math.max(26, Math.min(60, 22 + n.calls * 0.8)),
            itemStyle: { color: n.kind === 'agent' ? AGENT_COLOR : SKILL_COLOR },
          })),
          links: collab.edges.map((e) => ({
            source: e.source,
            target: e.target,
            value: e.weight,
            lineStyle: { width: Math.max(1, Math.min(6, e.weight / 2)), curveness: 0.18, opacity: 0.55 },
          })),
          lineStyle: { color: 'source' },
          emphasis: { focus: 'adjacency' },
        },
      ],
    };
  }, [collab]);

  const sankeyOption = useMemo(() => {
    if (!sankey || sankey.nodes.length === 0) return {};
    return {
      tooltip: { trigger: 'item', triggerOn: 'mousemove' },
      series: [
        {
          type: 'sankey',
          left: 8,
          right: 120,
          top: 12,
          bottom: 12,
          nodeAlign: 'left',
          nodeGap: 10,
          nodeWidth: 14,
          label: { fontSize: 11, color: '#334155' },
          lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
          data: sankey.nodes.map((n) => ({ name: n.name })),
          links: sankey.links.map((l) => ({ source: l.source, target: l.target, value: l.value })),
        },
      ],
    };
  }, [sankey]);

  const businessOption = useMemo(() => {
    if (!business) return {};
    return {
      grid: { left: 46, right: 46, top: 34, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, right: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: business.days,
        axisLabel: { fontSize: 10, color: '#94a3b8', interval: 4 },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      yAxis: [
        {
          type: 'value',
          name: 'OTIF / 缺货率',
          nameTextStyle: { fontSize: 10, color: '#94a3b8' },
          axisLabel: { fontSize: 10, color: '#94a3b8', formatter: (v: number) => `${Math.round(v * 100)}%` },
          splitLine: { lineStyle: { color: '#f1f5f9' } },
        },
        {
          type: 'value',
          name: '成本($)',
          nameTextStyle: { fontSize: 10, color: '#94a3b8' },
          axisLabel: { fontSize: 10, color: '#94a3b8' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'OTIF',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: business.otif_rate,
          itemStyle: { color: '#16a34a' },
          lineStyle: { width: 2 },
        },
        {
          name: '缺货率',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: business.stockout_rate,
          itemStyle: { color: '#dc2626' },
          lineStyle: { width: 2 },
        },
        {
          name: '物流成本',
          type: 'bar',
          yAxisIndex: 1,
          data: business.logistics_cost_usd,
          itemStyle: { color: '#bfdbfe' },
          barMaxWidth: 14,
        },
      ],
    };
  }, [business]);

  const riskOption = useMemo(() => {
    if (!business) return {};
    return {
      grid: { left: 40, right: 16, top: 34, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, right: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: business.days,
        axisLabel: { fontSize: 10, color: '#94a3b8', interval: 4 },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { fontSize: 10, color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      series: [
        {
          name: '高风险',
          type: 'bar',
          stack: 'risk',
          data: business.supplier_risk.high,
          itemStyle: { color: '#dc2626' },
          barMaxWidth: 16,
        },
        {
          name: '中风险',
          type: 'bar',
          stack: 'risk',
          data: business.supplier_risk.medium,
          itemStyle: { color: '#d97706' },
          barMaxWidth: 16,
        },
        {
          name: '低风险',
          type: 'bar',
          stack: 'risk',
          data: business.supplier_risk.low,
          itemStyle: { color: '#16a34a' },
          barMaxWidth: 16,
        },
      ],
    };
  }, [business]);

  if (error) return <div className="alert">{error}</div>;
  if (!collab || !sankey || !business) return <div className="empty">加载中…</div>;

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">OTIF 准时足量交付</div>
          <div className="value" style={{ color: 'var(--success)' }}>
            {(business.latest.otif_rate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="kpi">
          <div className="label">库存周转</div>
          <div className="value">{business.latest.inventory_turnover.toFixed(2)}</div>
        </div>
        <div className="kpi">
          <div className="label">缺货率</div>
          <div className="value" style={{ color: 'var(--failed)' }}>
            {(business.latest.stockout_rate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="kpi">
          <div className="label">当日物流成本</div>
          <div className="value">${Math.round(business.latest.logistics_cost_usd).toLocaleString()}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">智能体协作拓扑</h3>
          <p className="card-sub">
            节点大小表示调用次数，边粗细表示相邻调用频次；数据来自 {collab.run_count} 次运行。
          </p>
          {collab.nodes.length === 0 ? (
            <div className="empty">还没有运行记录</div>
          ) : (
            <EChart option={collabOption} height={320} />
          )}
        </div>

        <div className="card">
          <h3 className="card-title">任务流转桑基图</h3>
          <p className="card-sub">来源 → 执行智能体 → 结果，宽度表示任务数。</p>
          {sankey.nodes.length === 0 ? (
            <div className="empty">还没有任务</div>
          ) : (
            <EChart option={sankeyOption} height={320} />
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">业务趋势</h3>
          <p className="card-sub">
            OTIF 与缺货率按左轴（百分比），物流成本按右轴。
            <span style={{ color: 'var(--muted)' }}>（业务指标为种子数据）</span>
          </p>
          <EChart option={businessOption} height={260} />
        </div>

        <div className="card">
          <h3 className="card-title">供应商风险分布</h3>
          <p className="card-sub">按日统计高 / 中 / 低风险供应商数量。</p>
          <EChart option={riskOption} height={260} />
        </div>
      </div>
    </>
  );
}
