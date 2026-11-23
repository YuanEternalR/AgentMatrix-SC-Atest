import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SearchResult } from '../api';

/**
 * 全局搜索面板（Ctrl / Cmd + K）。
 *
 * 交互约定跟主流工作台一致：输入即搜（防抖）、↑↓ 选择、Enter 跳转、Esc 关闭。
 * 搜索本身走后端（`/search`），因为要能按编号匹配任务与运行——那是列表页给不了的。
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦并清空，避免上次的关键词留在框里
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setData(null);
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 防抖：每敲一个字就请求一次会把后端打成筛子
  useEffect(() => {
    if (!open) return;
    const keyword = query.trim();
    if (!keyword) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .search(keyword)
        .then((result) => {
          setData(result);
          setActive(0);
        })
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const flat = useMemo(
    () => (data?.groups ?? []).flatMap((group) => group.items.map((item) => ({ group, item }))),
    [data],
  );

  if (!open) return null;

  function go(index: number) {
    const target = flat[index];
    if (!target) return;
    navigate(target.item.route);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(flat.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      go(active);
    }
  }

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <span className="cmdk-icon">⌕</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            placeholder="搜索任务、运行、智能体、技能、工作流…（编号也可以）"
            onChange={(event) => setQuery(event.target.value)}
            data-testid="cmdk-input"
          />
          <span className="cmdk-hint">Esc 关闭</span>
        </div>

        <div className="cmdk-body">
          {!query.trim() && (
            <div className="cmdk-empty">
              试试搜索「订单」「运价」，或直接粘贴任务编号 / 运行编号
            </div>
          )}
          {query.trim() && loading && <div className="cmdk-empty">搜索中…</div>}
          {query.trim() && !loading && flat.length === 0 && (
            <div className="cmdk-empty">没有匹配结果</div>
          )}

          {(data?.groups ?? []).map((group) => (
            <div key={group.kind}>
              <div className="cmdk-group">{group.label}</div>
              {group.items.map((item) => {
                const index = flat.findIndex(
                  (row) => row.group.kind === group.kind && row.item.id === item.id,
                );
                return (
                  <button
                    key={`${group.kind}-${item.id}`}
                    type="button"
                    className={`cmdk-item ${index === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(index)}
                    data-testid="cmdk-item"
                  >
                    <span className="cmdk-item-title">{item.title}</span>
                    <span className="cmdk-item-sub">{item.subtitle}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cmdk-footer">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
