/**
 * 骨架屏：列表加载时占位，避免"加载中…"文字造成的布局跳变。
 *
 * 尺寸刻意贴近真实行高，切换时视觉上不跳动——这是骨架屏相对 loading 文案的唯一意义。
 */

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: '6px 0' }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div className="row" key={rowIndex} style={{ gap: 14, marginBottom: 12, flexWrap: 'nowrap' }}>
          {Array.from({ length: cols }).map((__, colIndex) => (
            <div
              key={colIndex}
              className="skeleton"
              style={{ height: 14, flex: colIndex === 0 ? 2.4 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 6, height = 128 }: { count?: number; height?: number }) {
  return (
    <div className="skill-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid-4" style={{ marginBottom: 16 }} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: 86 }} />
      ))}
    </div>
  );
}
