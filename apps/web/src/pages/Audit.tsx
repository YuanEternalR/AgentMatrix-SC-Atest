import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, type AuditLogInfo, type AuditSummary } from '../api';
import { TableSkeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { AUDIT_ACTION_LABEL, AUDIT_FIELD_LABEL, label } from '../labels';

const PAGE_SIZE = 20;

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/** 审计里出现的枚举值（级别、决策、状态）翻成中文，避免界面上出现 warning / approved */
const VALUE_LABEL: Record<string, Record<string, string>> = {
  severity: { info: '提示', warning: '警告', critical: '严重' },
  decision: { approved: '通过', rejected: '驳回' },
  status: {
    pending: '待处理',
    running: '运行中',
    queued: '排队中',
    waiting_approval: '待审批',
    succeeded: '成功',
    failed: '失败',
    canceled: '已取消',
    open: '待处理',
    acknowledged: '已确认',
    resolved: '已恢复',
  },
};

function Json({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) {
    return <div className="step-meta">无字段变更（这条记录描述的是动作本身）</div>;
  }
  // 已知字段翻成中文；业务参数（如订单号）保持原样，它是数据不是界面文案
  const named = Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      label(AUDIT_FIELD_LABEL, key),
      typeof inner === 'string' ? VALUE_LABEL[key]?.[inner] ?? inner : inner,
    ]),
  );
  return <pre className="audit-json mono">{JSON.stringify(named, null, 2)}</pre>;
}

/**
 * 审计日志：谁、什么时候、对什么、做了什么，改前改后是什么。
 *
 * 这个页面是**只读**的：没有编辑、没有删除——接口层面也不提供，数据库还有触发器兜底。
 * 因此不用做"确认删除"之类的交互，那反而是误导。
 */
export function AuditLog() {
  const [rows, setRows] = useState<AuditLogInfo[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const [days, setDays] = useState(30);
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pageData, stats] = await Promise.all([
        api.listAuditLogs({
          action: action || undefined,
          q: query || undefined,
          days,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        api.getAuditSummary(days),
      ]);
      setRows(pageData.items);
      setTotal(pageData.total);
      setSummary(stats);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [action, query, days, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 审计是追加写，不追求实时；15 秒刷新一次足够看出"刚发生的事"
  useEffect(() => {
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.downloadAuditCsv({ action: action || undefined, q: query || undefined, days });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stampText = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.href = url;
      link.download = `审计日志-${stampText}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('审计日志已导出（CSV，Excel 可直接打开）');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">近 {days} 天记录</div>
          <div className="value">{summary ? summary.total : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">今日记录</div>
          <div className="value">{summary ? summary.today : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">涉及操作者</div>
          <div className="value">{summary ? summary.actors : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">动作种类</div>
          <div className="value">{summary ? summary.by_action.length : '—'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">审计日志</h2>
            <p className="card-sub">
              只追加、不可删除：接口不提供删除，数据库还有触发器拒绝 UPDATE / DELETE。
              密钥、邮箱、手机号在落库前已脱敏。
            </p>
          </div>
          <div className="chart-actions">
            <button
              className="ghost"
              disabled={exporting}
              onClick={() => void handleExport()}
              data-testid="audit-export"
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </button>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
            style={{ width: 180 }}
            data-testid="audit-action-filter"
          >
            <option value="">全部动作</option>
            {(summary?.actions ?? []).map((item) => (
              <option key={item.action} value={item.action}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(0);
            }}
            style={{ width: 130 }}
          >
            <option value={1}>最近 24 小时</option>
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
            <option value={365}>最近一年</option>
          </select>

          <input
            value={keyword}
            placeholder="搜索摘要、操作者或对象编号"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setQuery(keyword.trim());
                setPage(0);
              }
            }}
            style={{ width: 280 }}
            data-testid="audit-search"
          />
          <button
            onClick={() => {
              setQuery(keyword.trim());
              setPage(0);
            }}
          >
            查询
          </button>
          {(action || query) && (
            <button
              className="ghost"
              onClick={() => {
                setAction('');
                setKeyword('');
                setQuery('');
                setPage(0);
              }}
            >
              清空筛选
            </button>
          )}
          <span className="step-meta" style={{ marginLeft: 'auto' }}>
            共 {total} 条
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : rows.length === 0 ? (
          <div className="empty">当前筛选条件下没有审计记录</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 168 }}>时间</th>
                <th style={{ width: 150 }}>操作者</th>
                <th style={{ width: 132 }}>动作</th>
                <th style={{ width: 130 }}>对象</th>
                <th>摘要</th>
                <th style={{ width: 120 }}>来源 IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    data-testid="audit-row"
                  >
                    <td className="step-meta">{formatTime(row.created_at)}</td>
                    <td>
                      <strong style={{ fontSize: 13 }}>{row.actor_name || '—'}</strong>
                      <div className="step-meta">{row.actor_role_label || '未认证'}</div>
                    </td>
                    <td>
                      <span className="badge queued">
                        {row.action_label || label(AUDIT_ACTION_LABEL, row.action)}
                      </span>
                    </td>
                    <td>
                      {row.resource_type_label || '—'}
                      {row.resource_id && <div className="step-meta mono">{row.resource_id.slice(0, 12)}</div>}
                    </td>
                    <td style={{ maxWidth: 420 }}>{row.summary}</td>
                    <td className="step-meta mono">{row.ip || '—'}</td>
                  </tr>
                  {expanded === row.id && (
                    <tr style={{ cursor: 'default' }}>
                      <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                        <div className="audit-diff">
                          <div>
                            <div className="step-meta" style={{ marginBottom: 6 }}>
                              变更前
                            </div>
                            <Json value={row.before} />
                          </div>
                          <div>
                            <div className="step-meta" style={{ marginBottom: 6 }}>
                              变更后
                            </div>
                            <Json value={row.after} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        <div className="pager">
          <button className="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            上一页
          </button>
          <span className="step-meta">
            第 {page + 1} / {pages} 页
          </span>
          <button
            className="ghost"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </>
  );
}
