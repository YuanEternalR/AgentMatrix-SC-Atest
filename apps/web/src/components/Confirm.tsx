import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 自定义确认弹窗，替代浏览器原生 `window.confirm`。
 *
 * 原生弹窗会阻塞主线程、样式不可控，而且在 Electron/嵌入场景里越来越受限。
 * 用法：`if (await confirmDialog({...})) { ... }`，调用点写法跟 confirm 一样简单。
 */

type Options = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type Pending = Options & { resolve: (value: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function confirmDialog(options: Options): Promise<boolean> {
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    notify();
  });
}

function settle(value: boolean) {
  const current = pending;
  pending = null;
  notify();
  current?.resolve(value);
}

export function ConfirmHost() {
  const [, force] = useState(0);

  useEffect(() => {
    const render = () => force((n) => n + 1);
    listeners.add(render);
    return () => {
      listeners.delete(render);
    };
  }, []);

  const request = pending;

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false);
      if (event.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  if (!request) return null;

  return createPortal(
    <div className="modal-backdrop" onClick={() => settle(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onClick={(event) => event.stopPropagation()}
        data-testid="confirm-dialog"
      >
        <h3 className="modal-title">{request.title}</h3>
        {request.message && <p className="modal-body">{request.message}</p>}
        <div className="modal-actions">
          <button className="ghost" onClick={() => settle(false)} data-testid="confirm-cancel">
            {request.cancelText ?? '取消'}
          </button>
          <button
            className={request.danger ? 'danger' : 'primary'}
            onClick={() => settle(true)}
            autoFocus
            data-testid="confirm-ok"
          >
            {request.confirmText ?? '确认'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
