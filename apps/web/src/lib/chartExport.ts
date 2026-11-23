/**
 * 图表导出：PNG 交给 ECharts 自己光栅化，CSV 从 option 里还原成表格。
 *
 * 为什么 CSV 不"另存一份数据"：
 * 导出的必须是**当前图上看到的那份数据**。如果页面另有一份数组，图变了忘了改它，
 * 导出的就是另一回事——这类不一致很难解释。
 * 所以这里统一从 option 反推表格，图上有什么就导出什么。
 */

/** 单元格只允许数字与字符串，避免导出里出现 [object Object] */
export type Cell = string | number;

export type ChartTable = { columns: string[]; rows: Cell[][] };

type Loose = Record<string, unknown>;

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立即 revoke 会让部分浏览器来不及取数据，留一拍
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 时间戳后缀：同一张图导多次不会互相覆盖 */
export function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function escapeCell(value: Cell): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table: ChartTable): string {
  const lines = [table.columns.map(escapeCell).join(',')];
  for (const row of table.rows) lines.push(row.map(escapeCell).join(','));
  // Excel 只有看到 BOM 才按 UTF-8 解析，否则中文列名全是乱码
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, table: ChartTable): void {
  downloadBlob(filename, new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }));
}

export function downloadPng(filename: string, dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function num(value: unknown): Cell {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  // ECharts 允许 data 项写成 { value: 12 }
  if (value && typeof value === 'object' && 'value' in (value as Loose)) {
    const inner = (value as Loose).value;
    return typeof inner === 'number' || typeof inner === 'string' ? inner : '';
  }
  return '';
}

function firstOf(value: unknown): Loose | undefined {
  if (Array.isArray(value)) return value[0] as Loose | undefined;
  if (value && typeof value === 'object') return value as Loose;
  return undefined;
}

/** 从 ECharts option 还原成二维表；认不出结构时返回空表（按钮置灰，而不是导出空文件） */
export function chartTable(option: unknown): ChartTable {
  const opt = (option ?? {}) as Loose;
  const rawSeries = opt.series;
  const series = (Array.isArray(rawSeries) ? rawSeries : rawSeries ? [rawSeries] : []) as Loose[];
  if (series.length === 0) return { columns: [], rows: [] };

  // 关系图（拓扑 / 桑基）：导出边列表，比导出节点更有意义
  const kind = series[0]?.type;
  if (kind === 'sankey' || kind === 'graph') {
    const links = (series[0].links ?? []) as Loose[];
    return {
      columns: ['来源', '目标', '数值'],
      rows: links.map((link) => [String(link.source ?? ''), String(link.target ?? ''), num(link.value)]),
    };
  }

  const axis = firstOf(opt.xAxis);
  const categories = Array.isArray(axis?.data) ? (axis.data as unknown[]) : undefined;
  const length =
    categories?.length ??
    series.reduce((max, s) => Math.max(max, Array.isArray(s.data) ? s.data.length : 0), 0);

  const rows: Cell[][] = [];
  for (let i = 0; i < length; i += 1) {
    const row: Cell[] = [num(categories?.[i] ?? i + 1)];
    for (const s of series) {
      const data = Array.isArray(s.data) ? s.data : [];
      row.push(num(data[i]));
    }
    rows.push(row);
  }

  return {
    columns: [axis?.name ? String(axis.name) : '类别', ...series.map((s, i) => String(s.name ?? `系列${i + 1}`))],
    rows,
  };
}

/** 导出 SVG（工作流图）为 PNG：序列化 → 图片解码 → 画进 canvas，白底 2 倍图 */
export async function exportSvgPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const width = Number(clone.getAttribute('width') ?? svg.clientWidth);
  const height = Number(clone.getAttribute('height') ?? svg.clientHeight);
  const scale = 2;

  const source = new XMLSerializer().serializeToString(clone);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('工作流图渲染失败，无法导出'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 canvas，无法导出图片');
  ctx.scale(scale, scale);
  // SVG 本身透明，直接导出 PNG 会在深色背景上难看清，统一铺白底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  downloadPng(filename, canvas.toDataURL('image/png'));
}
