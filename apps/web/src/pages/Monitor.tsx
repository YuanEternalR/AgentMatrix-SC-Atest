import { useEffect, useMemo, useState } from 'react';
import {
  AGENT_LABEL,
  ERROR_CODE_LABEL,
  label,
  STATUS_TEXT,
  WORKFLOW_LABEL,
} from '../labels';
import { api, type MetricsData } from '../api';
import { EChart } from '../components/EChart';

function formatMs(ms: number): string {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function Monitor() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [error, setError] = useState('');
  const [hours, setHours] = useState(24);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getMetrics(hours)
        .then((m) => alive && setData(m))
        .catch((err: Error) => alive && setError(err.message));
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [hours]);

  const trendOption = useMemo(() => {
    if (!data) return {};
    return {
      grid: { left: 40, right: 16, top: 36, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: { top: 4, right: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: data.trend.map((t) => t.hour),
        axisLabel: { fontSize: 10, color: '#94a3b8', interval: Math.max(0, Math.floor(data.trend.length / 8)) },
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
          name: '成功',
          type: 'bar',
          stack: 'total',
          data: data.trend.map((t) => t.succeeded),
          itemStyle: { color: '#16a34a', borderRadius: [0, 0, 0, 0] },
          barMaxWidth: 18,
        },
        {
          name: '失败',
          type: 'bar',
          stack: 'total',
          data: data.trend.map((t) => t.failed),
          itemStyle: { color: '#dc2626' },
          barMaxWidth: 18,
        },
        {
          name: '其他',
          type: 'bar',
          stack: 'total',
          data: data.trend.map((t) => t.other),
          itemStyle: { color: '#94a3b8' },
          barMaxWidth: 18,
        },
      ],
    };
  }, [data]);

  const agentOption = useMemo(() => {
    if (!data || data.by_agent.length === 0) return {};
    const rows = [...data.by_agent].reverse();
    return {
      grid: { left: 120, right: 40, top: 20, bottom: 24 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10, color: '#94a3b8' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      yAxis: {
        type: 'category',
        data: rows.map((r) => AGENT_LABEL[r.agent_code] ?? r.agent_code),
        axisLabel: { fontSize: 10, color: '#475569' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: [
        {
          name: '成功',
          type: 'bar',
          stack: 'a',
          data: rows.map((r) => r.succeeded),
          itemStyle: { color: '#2563eb' },
          barMaxWidth: 14,
        },
        {
          name: '失败',
          type: 'bar',
          stack: 'a',
          data: rows.map((r) => r.failed),
          itemStyle: { color: '#dc2626' },
          barMaxWidth: 14,
        },
      ],
    };
  }, [data]);

  if (error) return <div className="alert">{error}</div>;
  if (!data) return <div className="empty">加载中…</div>;

  const t = data.totals;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          运行监控
        </h2>
        <div className="row">
          <span className="step-meta">时间窗口</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ width: 120 }}>
            <option value={24}>最近 24 小时</option>
            <option value={72}>最近 3 天</option>
            <option value={168}>最近 7 天</option>
          </select>
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">运行总数</div>
          <div className="value">{t.runs}</div>
          <div className="step-meta" style={{ marginTop: 4 }}>
            进行中 {t.running} · 待审批 {t.waiting_approval}
          </div>
        </div>
        <div className="kpi">
          <div className="label">成功率</div>
          <div className="value" style={{ color: t.success_rate >= 0.9 ? 'var(--success)' : undefined }}>
            {(t.success_rate * 100).toFixed(1)}%
          </div>
          <div className="step-meta" style={{ marginTop: 4 }}>
            成功 {t.succeeded} · 失败 {t.failed}
          </div>
        </div>
        <div className="kpi">
          <div className="label">P95 执行耗时</div>
          <div className="value">{formatMs(t.p95_active_ms)}</div>
          <div className="step-meta" style={{ marginTop: 4 }}>
            端到端 P95 {formatMs(t.p95_ms)}（含审批等待）
          </div>
        </div>
        <div className="kpi">
          <div className="label">累计成本</div>
          <div className="value">${t.cost_usd.toFixed(4)}</div>
          <div className="step-meta" style={{ marginTop: 4 }}>
            单次均值 ${t.avg_cost_usd.toFixed(4)} · {t.tokens} tokens
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">运行趋势</h3>
          <p className="card-sub">按小时分桶，堆叠展示成功 / 失败 / 其他。</p>
          <EChart option={trendOption} height={240} />
        </div>

        <div className="card">
          <h3 className="card-title">智能体调用分布</h3>
          <p className="card-sub">成功与失败次数，用于识别过载或质量偏低的执行者。</p>
          {data.by_agent.length === 0 ? (
            <div className="empty">还没有调用记录</div>
          ) : (
            <EChart option={agentOption} height={240} />
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">按工作流统计</h3>
          <p className="card-sub">用于对比两条业务链路的吞吐与稳定性。</p>
          {data.by_workflow.length === 0 ? (
            <div className="empty">还没有数据</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>工作流</th>
                  <th>运行</th>
                  <th>成功</th>
                  <th>失败</th>
                </tr>
              </thead>
              <tbody>
                {data.by_workflow.map((w) => (
                  <tr key={w.workflow_code} style={{ cursor: 'default' }}>
                    <td>{w.workflow_name ?? label(WORKFLOW_LABEL, w.workflow_code)}</td>
                    <td>{w.runs}</td>
                    <td style={{ color: 'var(--success)' }}>{w.succeeded}</td>
                    <td style={{ color: w.failed ? 'var(--failed)' : undefined }}>{w.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">最近失败</h3>
          <p className="card-sub">错误码对应执行器的错误分类。</p>
          {data.recent_failures.length === 0 ? (
            <div className="empty">没有失败记录</div>
          ) : (
            data.recent_failures.map((f) => (
              <div className="rejected-item" key={f.run_id}>
                <strong style={{ color: 'var(--text)', minWidth: 96 }}>{f.run_id.slice(0, 8)}</strong>
                <span>
                  {label(f.error_code ? ERROR_CODE_LABEL : STATUS_TEXT, f.error_code ?? f.status)} · {f.created_at ? new Date(f.created_at).toLocaleString('zh-CN') : '—'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
