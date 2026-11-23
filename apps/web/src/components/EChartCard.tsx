import { useMemo, useRef, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart, type ECharts } from './EChart';
import { chartTable, downloadCsv, downloadPng, stamp } from '../lib/chartExport';

/**
 * 带导出按钮的图表卡片。
 *
 * 规格要求「图表支持导出 PNG/CSV」。把导出能力收进卡片而不是散在各个页面：
 * 每张图都有同样的两个按钮、同样的文件名规则，新增图表不会漏掉导出。
 */
export function EChartCard({
  title,
  sub,
  exportName,
  option,
  height = 260,
  empty,
}: {
  title: string;
  sub?: string;
  /** 导出文件名前缀，通常是图表的中文名 */
  exportName: string;
  option: EChartsCoreOption;
  height?: number;
  /** 无数据时的说明文案；给了就不渲染图表 */
  empty?: string;
}) {
  const chartRef = useRef<ECharts | null>(null);
  const [hint, setHint] = useState('');

  const table = useMemo(() => chartTable(option), [option]);
  const hasChart = !empty;

  function handlePng() {
    const chart = chartRef.current;
    if (!chart) {
      setHint('图表尚未就绪');
      return;
    }
    const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    downloadPng(`${exportName}-${stamp()}.png`, dataUrl);
    setHint('已导出 PNG');
  }

  function handleCsv() {
    if (table.rows.length === 0) {
      setHint('这张图没有可导出的表格数据');
      return;
    }
    downloadCsv(`${exportName}-${stamp()}.csv`, table);
    setHint(`已导出 CSV（${table.rows.length} 行）`);
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{title}</h3>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        <div className="chart-actions">
          {hint && <span className="step-meta">{hint}</span>}
          <button
            className="ghost"
            onClick={handlePng}
            disabled={!hasChart}
            title="导出当前图表为 PNG（2 倍图，白底）"
            data-testid="chart-export-png"
          >
            PNG
          </button>
          <button
            className="ghost"
            onClick={handleCsv}
            disabled={!hasChart || table.rows.length === 0}
            title="导出图上数据为 CSV（Excel 可直接打开）"
            data-testid="chart-export-csv"
          >
            CSV
          </button>
        </div>
      </div>
      {empty ? (
        <div className="empty">{empty}</div>
      ) : (
        <EChart
          option={option}
          height={height}
          onReady={(chart) => {
            chartRef.current = chart;
          }}
        />
      )}
    </div>
  );
}
