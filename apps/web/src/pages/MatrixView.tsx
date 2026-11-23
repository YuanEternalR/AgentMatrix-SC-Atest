import { useEffect, useState } from 'react';
import { capabilitiesText } from '../labels';
import { api, type MatrixData } from '../api';

const TIER_LABEL: Record<string, string> = {
  large: '大模型',
  small: '小模型',
  tool: '规则/工具',
};

export function MatrixView() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMatrix()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!data) return <div className="empty">加载中…</div>;

  const cellAt = (stage: string, category: string) =>
    data.cells.find((c) => c.stage === stage && c.category === category);

  const activeCell = active ? data.cells.find((c) => `${c.stage}:${c.category}` === active) : null;

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">矩阵覆盖率</div>
          <div className="value" style={{ color: 'var(--primary)' }}>
            {(data.coverage * 100).toFixed(1)}%
          </div>
        </div>
        <div className="kpi">
          <div className="label">已覆盖格子</div>
          <div className="value">
            {data.covered_cells}/{data.total_cells}
          </div>
        </div>
        <div className="kpi">
          <div className="label">在线智能体</div>
          <div className="value">{data.agent_count}</div>
        </div>
        <div className="kpi">
          <div className="label">能力缺口</div>
          <div className="value" style={{ color: data.gap_count ? 'var(--waiting)' : undefined }}>
            {data.gap_count}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">智能体矩阵</h2>
        <p className="card-sub">
          行是供应链八个阶段，列是能力类型。空格代表该能力缺少智能体，点击可查看详情。
        </p>

        <div className="matrix">
          <div className="matrix-row matrix-head">
            <div className="matrix-stage">阶段 \ 能力</div>
            {data.categories.map((c) => (
              <div key={c.code} className="matrix-cell head">
                {c.label}
              </div>
            ))}
          </div>

          {data.stages.map((stage) => (
            <div className="matrix-row" key={stage.code}>
              <div className="matrix-stage">
                {stage.label}
                {stage.industry && (
                  <span
                    className="stage-industry"
                    title={
                      `产业关联度（2020 年投入产出表，${stage.industry.sectors} 个部门，` +
                      `占产出 ${(stage.industry.output_share * 100).toFixed(1)}%）：` +
                      `影响力 ${stage.industry.influence}（拉动上游）、` +
                      `感应度 ${stage.industry.sensitivity}（被上游拖累）`
                    }
                  >
                    影 {stage.industry.influence.toFixed(2)} · 感{' '}
                    {stage.industry.sensitivity.toFixed(2)}
                  </span>
                )}
              </div>
              {data.categories.map((category) => {
                const cell = cellAt(stage.code, category.code);
                const key = `${stage.code}:${category.code}`;
                return (
                  <div
                    key={key}
                    className={`matrix-cell ${cell?.covered ? 'covered' : 'gap'} ${
                      active === key ? 'active' : ''
                    }`}
                    onClick={() => setActive(active === key ? null : key)}
                  >
                    {cell?.covered ? (
                      cell.agents.map((a) => (
                        <span className="agent-chip" key={a.code} title={capabilitiesText(a.capabilities)}>
                          <span className={`tier-dot ${a.model_tier}`} />
                          {a.name}
                        </span>
                      ))
                    ) : (
                      <span className="gap-hint">＋ 能力缺口</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">格子详情</h3>
          <p className="card-sub">点击上方任意格子查看。</p>
          {!activeCell ? (
            <div className="empty">尚未选择格子</div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <strong>
                  {activeCell.stage_label} × {activeCell.category_label}
                </strong>
                {activeCell.covered ? (
                  <span className="badge succeeded">已覆盖</span>
                ) : (
                  <span className="badge waiting_approval">缺口</span>
                )}
              </div>
              {activeCell.covered ? (
                activeCell.agents.map((a) => (
                  <div className="rejected-item" key={a.code}>
                    <strong style={{ color: 'var(--text)', minWidth: 130 }}>{a.name}</strong>
                    <span>
                      {TIER_LABEL[a.model_tier] ?? a.model_tier} · 成功率 {(a.success_rate * 100).toFixed(0)}% ·{' '}
                      {capabilitiesText(a.capabilities)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty">
                  该能力格暂无智能体，相关任务会被硬过滤淘汰。
                  <br />
                  处理方式：注册新智能体，或调整工作流的 required_capabilities。
                </div>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">能力缺口清单</h3>
          <p className="card-sub">这些格子为空，会直接影响依赖该能力的工作流。</p>
          {data.gaps.length === 0 ? (
            <div className="empty">没有缺口，矩阵全覆盖</div>
          ) : (
            data.gaps.map((g) => (
              <div className="rejected-item" key={`${g.stage}:${g.category}`}>
                <strong style={{ color: 'var(--text)', minWidth: 130 }}>{g.stage_label}</strong>
                <span>{g.category_label}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
