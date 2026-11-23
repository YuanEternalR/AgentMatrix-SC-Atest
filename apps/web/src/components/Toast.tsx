import { useEffect, useState } from 'react';

/**
 * 轻量 Toast：替代页面顶部的 alert 条。
 *
 * 为什么不用第三方库：只需要"往上叠、自动消失、点一下关掉"，自己写 60 行，
 * 少一个依赖也少一次构建体积增长。状态用模块级 store + 订阅，
 * 任何模块（含非组件代码）都能 `toast.success(...)`。
 */

export type ToastKind = 'success' | 'error' | 'info';

type Item = { id: number; kind: ToastKind; message: string };

let seq = 0;
let items: Item[] = [];
const listeners = new Set<(next: Item[]) => void>();

function emit() {
  for (const fn of listeners) fn(items);
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, ttl = 3600) {
  const id = (seq += 1);
  items = [...items, { id, kind, message }];
  emit();
  window.setTimeout(() => dismiss(id), ttl);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message, 5200),
  info: (message: string) => push('info', message),
};

export function ToastHost() {
  const [list, setList] = useState<Item[]>(items);

  useEffect(() => {
    listeners.add(setList);
    setList(items);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.kind}`}
          data-testid="toast"
          onClick={() => dismiss(item.id)}
          title="点击关闭"
        >
          <span className="toast-dot" />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
