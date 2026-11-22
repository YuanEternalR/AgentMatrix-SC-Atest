import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type GraphIssue,
  type GraphNode,
  type WorkflowDiff,
  type WorkflowGraph,
} from '../api';
import { DagChart } from '../components/DagChart';

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'skill', label: '技能' },
  { value: 'agent', label: '智能体' },
  { value: 'approval', label: '人工审批' },
  { value: 'condition', label: '条件分支' },
];

function clone(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

export function WorkflowDesigner() {
  const { code = '' } = useParams();
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [workflowName, setWorkflowName] = useState('');
  const [latestVersion, setLatestVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'select' | 'connect'>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ errors: GraphIssue[]; warnings: GraphIssue[] } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [versions, setVersions] = useState<{ version: number; changelog: string }[]>([]);
  const [diff, setDiff] = useState<WorkflowDiff | null>(null);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await api.getWorkflow(code);
      if (!detail.graph) {
        setError('该工作流还没有已发布版本');
        return;
      }
      setGraph(clone(detail.graph));
      setWorkflowName(detail.name);
      setLatestVersion(detail.latest_version);
      setVersions(detail.versions.map((v) => ({ version: v.version, changelog: v.changelog })));
      if (detail.versions.length >= 2) {
        setDiffTo(detail.versions[0].version);
        setDiffFrom(detail.versions[1].version);
      }
      setDirty(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = graph?.nodes ?? [];
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selected) ?? null,
    [nodes, selected],
  );

  function patchNode(id: string, patch: Partial<GraphNode>) {
    setGraph((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
          }
        : prev,
    );
    setDirty(true);
    setIssues(null);
    setMessage('');
  }

  function handleNodeClick(nodeId: string) {
    if (mode === 'connect') {
      if (!connectFrom) {
        setConnectFrom(nodeId);
        setMessage(`已选择起点「${nodeId}」，再点一个节点作为终点`);
        return;
      }
      if (connectFrom === nodeId) {
        setConnectFrom(null);
        setMessage('已取消连线');
        return;
      }
      const source = nodes.find((n) => n.id === connectFrom);
      if (!source) return;

      if (source.type === 'condition') {
        // 条件节点有两条出边：优先填空的分支
        if (!source.on_true) patchNode(source.id, { on_true: nodeId });
        else if (!source.on_false) patchNode(source.id, { on_false: nodeId });
        else patchNode(source.id, { on_true: nodeId });
      } else {
        patchNode(source.id, { next: nodeId });
      }
      setMessage(`已连线：${connectFrom} → ${nodeId}`);
      setConnectFrom(null);
      setMode('select');
      return;
    }
    setSelected(nodeId);
  }

  function addNode(type: string) {
    if (!graph) return;
    const base = `node_${nodes.length + 1}`;
    let id = base;
    let index = 2;
    while (nodes.some((n) => n.id === id)) {
      id = `${base}_${index}`;
      index += 1;
    }

    const node: GraphNode = { id, type };
    if (type === 'skill') node.skill = '';
    if (type === 'agent') node.agent_code = '$dispatch';
    if (type === 'approval') node.role = 'operator';

    setGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelected(id);
    setDirty(true);
    setIssues(null);
    setMessage(`已添加节点 ${id}，用「连线」把它接进流程`);
  }

  function deleteNode() {
    if (!graph || !selected) return;
    if (selectedNode?.type === 'start' || selectedNode?.type === 'end') {
      setError('start / end 节点不允许删除');
      return;
    }
    const rest = graph.nodes
      .filter((n) => n.id !== selected)
      .map((n) => {
        const copy = { ...n };
        if (copy.next === selected) copy.next = selectedNode?.next;
        if (copy.on_true === selected) copy.on_true = undefined;
        if (copy.on_false === selected) copy.on_false = undefined;
        return copy;
      });
    setGraph({ ...graph, nodes: rest });
    setSelected(null);
    setDirty(true);
    setIssues(null);
    setError('');
    setMessage(`已删除节点 ${selected}`);
  }

  async function loadDiff() {
    if (diffFrom == null || diffTo == null) return;
    setBusy(true);
    try {
      const result = await api.getWorkflowDiff(code, diffFrom, diffTo);
      setDiff(result);
      setShowDiff(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '对比失败');
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    if (!graph) return;
    setBusy(true);
    try {
      const result = await api.validateGraph(code, graph);
      setIssues({ errors: result.errors, warnings: result.warnings });
      setMessage(result.ok ? '校验通过' : `校验未通过：${result.errors.length} 个错误`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '校验失败');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!graph) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.saveWorkflowVersion(code, graph, '设计器保存');
      setLatestVersion(result.version);
      setDirty(false);
      setIssues(null);
      setMessage(`已保存为 v${result.version}（新任务将使用该版本）`);
    } catch (err) {
      // 422 会带校验明细
      setError(err instanceof Error ? err.message : '保存失败');
      await validate();
    } finally {
      setBusy(false);
    }
  }

  if (error && !graph) return <div className="alert">{error}</div>;
  if (!graph) return <div className="empty">加载中…</div>;

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: 16 }}>
              {workflowName} · 设计器
            </h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              当前线上版本 v{latestVersion ?? '—'}
              {dirty && <span style={{ color: 'var(--waiting)' }}> · 有未保存修改</span>}
            </p>
          </div>
          <div className="row">
            <Link to="/workflows">
              <button>返回列表</button>
            </Link>
            <button disabled={busy} onClick={() => void validate()}>
              校验
            </button>
            <button className="primary" disabled={busy || !dirty} onClick={() => void save()}>
              保存为新版本
            </button>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <span className="step-meta">添加节点</span>
          {TYPE_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => addNode(opt.value)}>
              + {opt.label}
            </button>
          ))}
          <button
            className={mode === 'connect' ? 'primary' : ''}
            onClick={() => {
              setMode(mode === 'connect' ? 'select' : 'connect');
              setConnectFrom(null);
              setMessage(mode === 'connect' ? '' : '连线模式：先点起点，再点终点');
            }}
          >
            {mode === 'connect' ? '退出连线' : '连线'}
          </button>
          <button className="danger" disabled={!selected} onClick={deleteNode}>
            删除选中节点
          </button>
          <span style={{ flex: 1 }} />
          <span className="step-meta">版本对比</span>
          <select
            data-testid="diff-from"
            value={diffFrom ?? ''}
            onChange={(e) => setDiffFrom(Number(e.target.value))}
            style={{ width: 96 }}
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
          <span className="step-meta">→</span>
          <select
            data-testid="diff-to"
            value={diffTo ?? ''}
            onChange={(e) => setDiffTo(Number(e.target.value))}
            style={{ width: 96 }}
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
          <button disabled={busy || diffFrom == null || diffTo == null} onClick={() => void loadDiff()}>
            对比
          </button>
        </div>

        {message && (
          <div className="card-sub" style={{ marginTop: 10, color: 'var(--primary)' }}>
            {message}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="designer-grid">
        <div className="card">
          <h3 className="card-title">流程画布</h3>
          <p className="card-sub">
            点击节点编辑；「连线」模式下点两个节点即可建立连线；节点可直接拖动调整位置。
          </p>
          <DagChart
            graph={graph}
            steps={[]}
            selectedNodeId={connectFrom ?? selected}
            onSelectNode={handleNodeClick}
            draggable
            onNodeMove={(nodeId, x, y) => patchNode(nodeId, { pos: { x, y } })}
          />
        </div>

        <div className="card">
          <h3 className="card-title">节点配置</h3>
          {!selectedNode ? (
            <div className="empty">在画布上选择一个节点</div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="mono">{selectedNode.id}</span>
                <span className="badge queued">{selectedNode.type}</span>
              </div>

              {selectedNode.type === 'skill' && (
                <div className="field">
                  <label className="field">技能编码</label>
                  <input
                    value={selectedNode.skill ?? ''}
                    onChange={(e) => patchNode(selectedNode.id, { skill: e.target.value })}
                    placeholder="order_status_query"
                  />
                </div>
              )}

              {selectedNode.type === 'agent' && (
                <div className="field">
                  <label className="field">智能体（$dispatch 表示由调度决策决定）</label>
                  <input
                    value={selectedNode.agent_code ?? ''}
                    onChange={(e) => patchNode(selectedNode.id, { agent_code: e.target.value })}
                  />
                </div>
              )}

              {selectedNode.type === 'approval' && (
                <div className="field">
                  <label className="field">审批角色</label>
                  <select
                    value={selectedNode.role ?? 'operator'}
                    onChange={(e) => patchNode(selectedNode.id, { role: e.target.value })}
                  >
                    <option value="operator">运营</option>
                    <option value="developer">开发者</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
              )}

              {selectedNode.type === 'condition' && (
                <>
                  <div className="field">
                    <label className="field">条件表达式（受限语法，不执行代码）</label>
                    <input
                      value={selectedNode.expr ?? ''}
                      onChange={(e) => patchNode(selectedNode.id, { expr: e.target.value })}
                      placeholder="assess_impact.impact_score >= 3"
                    />
                  </div>
                  <div className="grid-2" style={{ gap: 10 }}>
                    <div>
                      <label className="field">为真时跳转</label>
                      <select
                        value={selectedNode.on_true ?? ''}
                        onChange={(e) => patchNode(selectedNode.id, { on_true: e.target.value })}
                      >
                        <option value="">（未设置）</option>
                        {nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field">为假时跳转</label>
                      <select
                        value={selectedNode.on_false ?? ''}
                        onChange={(e) => patchNode(selectedNode.id, { on_false: e.target.value })}
                      >
                        <option value="">（未设置）</option>
                        {nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {selectedNode.type !== 'condition' && selectedNode.type !== 'end' && (
                <div className="field" style={{ marginTop: 10 }}>
                  <label className="field">下一节点</label>
                  <select
                    value={selectedNode.next ?? ''}
                    onChange={(e) =>
                      patchNode(selectedNode.id, { next: e.target.value || undefined })
                    }
                  >
                    <option value="">（结束流程）</option>
                    {nodes
                      .filter((n) => n.id !== selectedNode.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.id}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showDiff && diff && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              版本对比 v{diff.from} → v{diff.to}
            </h3>
            <button className="ghost" onClick={() => setShowDiff(false)}>
              收起
            </button>
          </div>
          <p className="card-sub">
            v{diff.from}「{diff.from_changelog}」 → v{diff.to}「{diff.to_changelog}」
          </p>

          <div className="row" style={{ gap: 18, marginBottom: 12 }}>
            <span className="badge succeeded">新增节点 {diff.summary.nodes_added}</span>
            <span className="badge failed">删除节点 {diff.summary.nodes_removed}</span>
            <span className="badge waiting_approval">修改节点 {diff.summary.nodes_changed}</span>
            <span className="badge queued">
              连线 +{diff.summary.edges_added} / -{diff.summary.edges_removed}
            </span>
            {diff.entry.changed && (
              <span className="badge failed">
                入口 {diff.entry.from} → {diff.entry.to}
              </span>
            )}
          </div>

          {diff.nodes_added.length === 0 &&
            diff.nodes_removed.length === 0 &&
            diff.nodes_changed.length === 0 &&
            diff.edges_added.length === 0 &&
            diff.edges_removed.length === 0 && <div className="empty">两个版本完全一致</div>}

          {diff.nodes_added.length > 0 && (
            <div className="rejected-item">
              <strong style={{ color: 'var(--success)', minWidth: 92 }}>新增节点</strong>
              <span>{diff.nodes_added.join('、')}</span>
            </div>
          )}
          {diff.nodes_removed.length > 0 && (
            <div className="rejected-item">
              <strong style={{ color: 'var(--failed)', minWidth: 92 }}>删除节点</strong>
              <span>{diff.nodes_removed.join('、')}</span>
            </div>
          )}
          {diff.nodes_changed.map((change) => (
            <div className="rejected-item" key={change.node_id}>
              <strong style={{ color: 'var(--text)', minWidth: 92 }}>{change.node_id}</strong>
              <span>
                {change.fields
                  .map((f) => `${f.field}: ${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`)
                  .join('；')}
              </span>
            </div>
          ))}
          {diff.edges_added.map((e) => (
            <div className="rejected-item" key={`ea-${e.source}-${e.target}-${e.branch}`}>
              <strong style={{ color: 'var(--success)', minWidth: 92 }}>新增连线</strong>
              <span>
                {e.source} → {e.target}（{e.branch}）
              </span>
            </div>
          ))}
          {diff.edges_removed.map((e) => (
            <div className="rejected-item" key={`er-${e.source}-${e.target}-${e.branch}`}>
              <strong style={{ color: 'var(--failed)', minWidth: 92 }}>删除连线</strong>
              <span>
                {e.source} → {e.target}（{e.branch}）
              </span>
            </div>
          ))}
        </div>
      )}

      {issues && (
        <div className="card">
          <h3 className="card-title">校验结果</h3>
          {issues.errors.length === 0 && issues.warnings.length === 0 && (
            <div className="empty" style={{ color: 'var(--success)' }}>
              没有发现问题
            </div>
          )}
          {issues.errors.map((issue) => (
            <div className="rejected-item" key={`e-${issue.code}-${issue.node_id}-${issue.message}`}>
              <span className="badge failed" style={{ marginRight: 8 }}>
                错误
              </span>
              <span style={{ color: 'var(--text)' }}>{issue.message}</span>
            </div>
          ))}
          {issues.warnings.map((issue) => (
            <div className="rejected-item" key={`w-${issue.code}-${issue.node_id}-${issue.message}`}>
              <span className="badge waiting_approval" style={{ marginRight: 8 }}>
                警告
              </span>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
