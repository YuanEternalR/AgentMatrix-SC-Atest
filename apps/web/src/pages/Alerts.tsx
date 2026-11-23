import { useCallback, useEffect, useState } from 'react';
import { api, type AlertEventInfo, type AlertRuleInfo } from '../api';

const SEVERITY_LABEL: Record<string, string> = {
  info: '提示',
  warning: '警告',
  critical: '严重',
};

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已恢复',
};

export function Alerts() {
  const [rules, setRules] = useState<AlertRuleInfo[]>([]);
  const [events, setEvents] = useState<AlertEventInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState('');

  const load = useCallback(async () => {
    try {
      const [ruleRows, eventRows] = await Promise.all([api.listAlertRules(), api.listAlertEvents()]);
      setRules(Array.isArray(ruleRows) ? ruleRows : []);
      setEvents(Array.isArray(eventRows) ? eventRows : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function evaluate() {
    setBusy(true);
    try {
      const res = await api.evaluateAlerts();
      setLastAction(
        res.count === 0
          ? '评估完成：条件与当前状态一致，无新增或恢复'
          : res.actions.map((a) => `${a.action === 'triggered' ? '触发' : '恢复'}「${a.rule}」`).join('，'),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '评估失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: AlertRuleInfo) {
    setBusy(true);
    try {
      await api.patchAlertRule(rule.id, { enabled: !rule.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: 'ack' | 'resolve') {
    setBusy(true);
    try {
      if (action === 'ack') await api.ackAlertEvent(id);
      else await api.resolveAlertEvent(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            告警事件
          </h2>
          <button className="primary" disabled={busy} onClick={() => void evaluate()}>
            立即评估
          </button>
        </div>
        <p className="card-sub">
          后台每 30 秒自动评估一次；条件成立时创建告警事件，条件恢复时自动关闭。
          {lastAction && <span style={{ color: 'var(--primary)' }}> {lastAction}</span>}
        </p>

        {events.length === 0 ? (
          <div className="empty">当前没有未关闭告警</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>级别</th>
                <th>内容</th>
                <th>状态</th>
                <th>触发时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} style={{ cursor: 'default' }}>
                  <td>
                    <span className={`badge ${ev.severity === 'critical' ? 'failed' : 'waiting_approval'}`}>
                      {SEVERITY_LABEL[ev.severity] ?? ev.severity}
                    </span>
                  </td>
                  <td style={{ maxWidth: 520 }}>{ev.message}</td>
                  <td>
                    <span className={`badge ${ev.status === 'open' ? 'pending' : 'queued'}`}>
                      {STATUS_LABEL[ev.status] ?? ev.status}
                    </span>
                  </td>
                  <td className="step-meta">
                    {ev.triggered_at ? new Date(ev.triggered_at).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button disabled={busy || ev.status !== 'open'} onClick={() => void act(ev.id, 'ack')}>
                      确认
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void act(ev.id, 'resolve')}
                      style={{ marginLeft: 6 }}
                    >
                      恢复
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">告警规则</h2>
        <p className="card-sub">规则是「指标 + 比较符 + 阈值」，可在数据库中配置，不需要执行任意表达式。</p>

        {rules.length === 0 ? (
          <div className="empty">还没有规则</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>条件</th>
                <th>级别</th>
                <th>状态</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} style={{ cursor: 'default' }}>
                  <td>
                    <strong style={{ fontSize: 13 }}>{rule.name}</strong>
                    <div className="step-meta">{rule.description}</div>
                  </td>
                  <td>
                    <div>
                      <strong>{rule.metric_label}</strong>{' '}
                      <span className="mono">
                        {rule.operator} {rule.threshold_label}
                      </span>
                    </div>
                    <div className="step-meta">
                      当前{' '}
                      {rule.current_label ? (
                        <strong
                          style={{
                            color: rule.firing ? 'var(--danger)' : 'var(--success)',
                          }}
                        >
                          {rule.current_label}
                        </strong>
                      ) : (
                        '—'
                      )}
                      {rule.firing !== null && (
                        <span style={{ marginLeft: 6 }}>
                          {rule.firing ? '已触发' : '未触发'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${rule.severity === 'critical' ? 'failed' : 'waiting_approval'}`}>
                      {SEVERITY_LABEL[rule.severity] ?? rule.severity}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${rule.enabled ? 'succeeded' : 'skipped'}`}>
                      {rule.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="ghost" disabled={busy} onClick={() => void toggle(rule)}>
                      {rule.enabled ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
