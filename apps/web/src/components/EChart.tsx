import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, LineChart, SankeyChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, ECharts } from 'echarts/core';

// 按需注册，避免把整个 echarts 打进包里
echarts.use([
  BarChart,
  LineChart,
  GraphChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

export type { ECharts };

/**
 * ECharts 薄封装。
 *
 * ``onReady`` 把实例交给上层：导出 PNG 需要 ``getDataURL``，只有拿到实例才行。
 * 用 ref 保存回调，避免父组件每次渲染都触发重绘。
 */
export function EChart({
  option,
  height = 260,
  onReady,
}: {
  option: EChartsCoreOption;
  height?: number;
  /** 实例就绪/销毁时回调；销毁给 null，调用方不必自己判空 */
  onReady?: (chart: ECharts | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chart.setOption(option);
    readyRef.current?.(chart);

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      // 实例销毁后置空：否则导出按钮会拿着一张已 dispose 的图去取像素
      readyRef.current?.(null);
    };
  }, [option]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
