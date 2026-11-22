import { useMemo } from 'react';
import type { RunStep, WorkflowGraph } from '../api';

const NODE_W = 168;
const NODE_H = 48;
const COL_GAP = 34;
const ROW_GAP = 38;
const PAD = 20;

const STATUS_COLOR: Record<string, { fill: string; stroke: string; text: string }> = {
  succeeded: { fill: '#ecfdf3', stroke: '#16a34a', text: '#0f172a' },
  running: { fill: '#eff5ff', stroke: '#2563eb', text: '#0f172a' },
  queued: { fill: '#eff5ff', stroke: '#2563eb', text: '#0f172a' },
  waiting_approval: { fill: '#fffbeb', stroke: '#d97706', text: '#0f172a' },
  retrying: { fill: '#fffbeb', stroke: '#d97706', text: '#0f172a' },
  failed: { fill: '#fef2f2', stroke: '#dc2626', text: '#0f172a' },
  pending: { fill: '#ffffff', stroke: '#cbd5e1', text: '#0f172a' },
  skipped: { fill: '#f3f4f6', stroke: '#6b7280', text: '#0f172a' },
  none: { fill: '#ffffff', stroke: '#cbd5e1', text: '#94a3b8' },
};

const TYPE_LABEL: Record<string, string> = {
  start: '开始',
  end: '结束',
  skill: '技能',
  agent: '智能体',
  condition: '条件',
  approval: '审批',
};

type Edge = { from: string; to: string; label?: string };

/** 计算每个节点的层级（从入口出发的最长路径），用于分层布局 */
function computeDepth(edges: Edge[], ids: string[]): Map<string, number> {
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!incoming.has(edge.to)) continue;
    incoming.get(edge.to)!.push(edge.from);
  }

  // 迭代松弛，最多 N 轮；有环时也能收敛（不无限增长）
  for (let round = 0; round < ids.length; round += 1) {
    let changed = false;
    for (const edge of edges) {
      const fromDepth = depth.get(edge.from);
      const toDepth = depth.get(edge.to);
      if (fromDepth === undefined || toDepth === undefined) continue;
      if (toDepth < fromDepth + 1) {
        depth.set(edge.to, fromDepth + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

export function DagChart({
  graph,
  steps,
  selectedNodeId,
  onSelectNode,
}: {
  graph: WorkflowGraph;
  steps: RunStep[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}) {
  // 同一节点可能有多条步骤（重试），用最后一条代表当前状态
  const statusByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const step of steps) map.set(step.node_id, step.status);
    return map;
  }, [steps]);

  const { positions, edges, width, height } = useMemo(() => {
    const nodes = graph.nodes ?? [];
    const ids = nodes.map((n) => n.id);

    const collected: Edge[] = [];
    for (const node of nodes) {
      if (node.type === 'condition') {
        if (node.on_true) collected.push({ from: node.id, to: node.on_true, label: '真' });
        if (node.on_false) collected.push({ from: node.id, to: node.on_false, label: '假' });
      } else if (node.next) {
        collected.push({ from: node.id, to: node.next });
      }
    }

    const depth = computeDepth(collected, ids);

    // 纵向布局：层级决定行，同层节点横向并排（分支自然展开）
    const columns = new Map<number, string[]>();
    for (const node of nodes) {
      const d = depth.get(node.id) ?? 0;
      if (!columns.has(d)) columns.set(d, []);
      columns.get(d)!.push(node.id);
    }

    const pos = new Map<string, { x: number; y: number }>();
    let maxCols = 1;
    for (const [depthValue, columnNodes] of columns) {
      maxCols = Math.max(maxCols, columnNodes.length);
      columnNodes.forEach((id, index) => {
        pos.set(id, {
          x: PAD + index * (NODE_W + COL_GAP),
          y: PAD + depthValue * (NODE_H + ROW_GAP),
        });
      });
    }

    const maxDepth = Math.max(0, ...columns.keys());
    return {
      positions: pos,
      edges: collected,
      width: PAD * 2 + maxCols * NODE_W + (maxCols - 1) * COL_GAP,
      height: PAD * 2 + (maxDepth + 1) * NODE_H + maxDepth * ROW_GAP,
    };
  }, [graph]);

  return (
    <div className="dag-wrap">
      <svg width={width} height={height} className="dag-svg" role="img" aria-label="工作流图">
        <defs>
          <marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
          </marker>
        </defs>

        {edges.map((edge) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          // 纵向布局：从源节点底部连到目标节点顶部
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const midY = (y1 + y2) / 2;
          return (
            <g key={`${edge.from}->${edge.to}`}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={1.5}
                markerEnd="url(#dag-arrow)"
              />
              {edge.label && (
                <text x={(x1 + x2) / 2 + 6} y={midY + 3} fontSize={10} fill="#94a3b8">
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {(graph.nodes ?? []).map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const status = statusByNode.get(node.id) ?? 'none';
          const color = STATUS_COLOR[status] ?? STATUS_COLOR.none;
          const isSelected = selectedNodeId === node.id;
          const detail =
            node.type === 'skill'
              ? node.skill ?? ''
              : node.type === 'agent'
                ? node.agent_code ?? ''
                : node.type === 'approval'
                  ? node.role ?? ''
                  : '';

          return (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={() => onSelectNode?.(node.id)}
              style={{ cursor: onSelectNode ? 'pointer' : 'default' }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={color.fill}
                stroke={isSelected ? '#1f6feb' : color.stroke}
                strokeWidth={isSelected ? 2.5 : 1.5}
              />
              <text x={10} y={19} fontSize={12} fontWeight={600} fill={color.text}>
                {node.id.length > 18 ? `${node.id.slice(0, 17)}…` : node.id}
              </text>
              <text x={10} y={35} fontSize={10} fill="#64748b">
                {TYPE_LABEL[node.type] ?? node.type}
                {detail ? ` · ${detail}` : ''}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="dag-legend">
        {(['succeeded', 'running', 'waiting_approval', 'failed', 'pending'] as const).map((status) => (
          <span key={status} className="dag-legend-item">
            <span
              className="dag-legend-dot"
              style={{ background: STATUS_COLOR[status].fill, borderColor: STATUS_COLOR[status].stroke }}
            />
            {{
              succeeded: '成功',
              running: '运行中',
              waiting_approval: '待审批',
              failed: '失败',
              pending: '未执行',
            }[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
