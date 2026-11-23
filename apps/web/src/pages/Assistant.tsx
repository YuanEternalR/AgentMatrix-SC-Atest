import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { STRATEGY_LABEL } from '../labels';
import { toast } from '../components/Toast';
import { CardSkeleton } from '../components/Skeleton';

/**
 * 场景助手页。
 *
 * 为什么要有这一页：桌面工作台的每个场景右边都挂一个 AI 面板，而工作台外壳
 * （改造自 luanyujia-workbench 模板）自带的 `harness` 面板依赖 DSH 引擎目录与引擎 token，
 * 本机拿不到。于是这里做一个**真正能用**的助手页，用已跑通的 `/workbench/ask`：
 *   - 模型拿到的是后端实时快照（任务/运行/审批/矩阵/策略），数字对得上数据库；
 *   - 问题里带上场景，所以同一个助手在不同场景有不同侧重；
 *   - 页面本身走深色变量层，嵌进深色工作台不突兀。
 */

type Message = { role: 'user' | 'assistant' | 'meta'; text: string };

type SceneKey = 'overview' | 'matrix' | 'delivery' | 'governance';

const SCENES: Record<SceneKey, { name: string; hints: string[] }> = {
  overview: {
    name: '工作台总览',
    hints: ['现在最该处理什么？', '待审批的两条，先批哪条？', '今天的业务量正常吗？'],
  },
  matrix: {
    name: '能力矩阵',
    hints: ['哪些格子还是空的？', '先补哪个缺口最划算？', '覆盖率 81% 算健康吗？'],
  },
  delivery: {
    name: '交付追踪',
    hints: ['最近失败的运行是什么原因？', '这条死信该重试还是人工处理？', '有没有卡住的批处理？'],
  },
  governance: {
    name: '治理与策略',
    hints: ['当前策略合适吗？', '权重该怎么调？', '哪些技能还没被任何智能体用到？'],
  },
};

function sceneFromUrl(): SceneKey {
  const raw = new URLSearchParams(window.location.search).get('scene') ?? '';
  return (['overview', 'matrix', 'delivery', 'governance'] as SceneKey[]).includes(raw as SceneKey)
    ? (raw as SceneKey)
    : 'overview';
}

export default function Assistant() {
  const scene = sceneFromUrl();
  const meta = SCENES[scene];
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [facts, setFacts] = useState<null | {
    waiting: number;
    failed: number;
    ok: number;
    gaps: number;
    covered: number;
    total: number;
    strategy: string;
  }>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .workbenchContext()
      .then((ctx) =>
        setFacts({
          waiting: ctx.pending_approvals,
          failed: ctx.tasks?.failed ?? 0,
          ok: ctx.runs_24h?.succeeded ?? 0,
          gaps: ctx.matrix?.gap_count ?? 0,
          covered: ctx.matrix?.covered_cells ?? 0,
          total: ctx.matrix?.total_cells ?? 0,
          strategy: ctx.dispatch?.strategy ?? '—',
        }),
      )
      .catch(() => setFacts(null));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const result = await api.askWorkbench({ scenario: scene, scenario_name: meta.name, question: q });
      if (!result.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `模型调用失败：${result.error ?? '未知原因'}` },
        ]);
        toast.error('助手调用失败');
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: result.answer },
        {
          role: 'meta',
          text: `${result.provider}/${result.model} · ${result.tokens} tokens · $${Number(
            result.cost_usd ?? 0,
          ).toFixed(6)} · ${result.duration_ms}ms`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `请求失败：${err instanceof Error ? err.message : String(err)}` },
      ]);
      toast.error('助手请求失败');
    } finally {
      setBusy(false);
    }
  }

  if (facts === null) {
    return (
      <div className="page">
        <CardSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="page assistant-page">
      <div className="assistant-head">
        <div>
          <h1 className="page-title">{meta.name} · 场景助手</h1>
          <p className="page-sub">
            它看到的是后端实时快照：待审批 {facts.waiting} · 24h 成功 {facts.ok} · 失败{' '}
            {facts.failed} · 矩阵覆盖 {facts.covered}/{facts.total}（缺口 {facts.gaps}）· 策略{' '}
            {STRATEGY_LABEL[facts.strategy] ?? facts.strategy}
          </p>
        </div>
      </div>

      <div className="assistant-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="assistant-empty">
            <p>这个场景里最值得问的三件事：</p>
            <div className="assistant-hints">
              {meta.hints.map((hint) => (
                <button key={hint} className="assistant-hint" onClick={() => void ask(hint)}>
                  {hint}
                </button>
              ))}
            </div>
            <p className="assistant-note">
              回答依据是平台的实时快照与这个场景的记忆；快照里没有的，它会直接说没有。
            </p>
          </div>
        )}

        {messages.map((msg, index) =>
          msg.role === 'meta' ? (
            <div key={index} className="assistant-meta">
              {msg.text}
            </div>
          ) : (
            <div key={index} className={`assistant-msg ${msg.role}`}>
              {msg.text}
            </div>
          ),
        )}

        {busy && <div className="assistant-msg assistant pending">正在分析当前场景…</div>}
      </div>

      <div className="assistant-input">
        <textarea
          value={input}
          placeholder="问这个场景：现在最该做什么？（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
        />
        <button className="btn primary" disabled={busy || !input.trim()} onClick={() => void ask(input)}>
          发送
        </button>
      </div>
    </div>
  );
}
