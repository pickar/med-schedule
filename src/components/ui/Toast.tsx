/**
 * 轻提示。状态由 `AppProvider` 持有并通过 `ToastContext` 下发，
 * 本文件只负责渲染与自动消失计时（保持纯展示，便于单独调样式）。
 *
 * 几个刻意的设计：
 * - **容器是 `aria-live="polite"` 的 region**，读屏用户能听到「已保存」这类反馈。
 *   保存失败用 `alert` 角色（见 `roleOf`），因为那条必须打断当前朗读。
 * - **`duration: 0` 表示常驻**。存储写入失败就该用常驻 toast：
 *   用户可能正要关页面，一条 3 秒后自己消失的警告等于没提示。
 * - 计时器挂在每个 item 自己的 effect 上，鼠标悬停时暂停——
 *   带「重试」按钮的 toast 在用户把鼠标移过去的路上消失是很挫败的。
 */

import { useEffect, useRef, useState } from 'react';
import type { ToastData, ToastTone } from '../../state/contexts';
import { Icon } from './Icons';
import type { IconName } from './Icons';
import { Button, IconButton } from './Button';

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'alert',
  danger: 'alert',
};

/** 默认停留时长；danger 默认常驻，必须由用户处理掉 */
const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 3200,
  success: 2400,
  warning: 5000,
  danger: 0,
};

function roleOf(tone: ToastTone): 'status' | 'alert' {
  return tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
}

export interface ToastViewportProps {
  toasts: readonly ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastViewport(props: ToastViewportProps): React.ReactElement {
  const { toasts, onDismiss } = props;
  return (
    <div className="toast-viewport no-print" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}): React.ReactElement {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const duration = toast.duration ?? DEFAULT_DURATION[toast.tone];

  useEffect(() => {
    if (duration <= 0 || paused) {
      return;
    }
    const timer = setTimeout(() => dismissRef.current(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, paused]);

  return (
    <div
      className={`toast toast--${toast.tone}`}
      role={roleOf(toast.tone)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={TONE_ICON[toast.tone]} size={18} className="toast__icon" />
      <div className="toast__content">
        <p className="toast__message">{toast.message}</p>
        {toast.detail && <p className="toast__detail">{toast.detail}</p>}
      </div>
      {toast.actionLabel && toast.onAction && (
        <Button variant="ghost" size="sm" className="toast__action" onClick={toast.onAction}>
          {toast.actionLabel}
        </Button>
      )}
      <IconButton
        icon="close"
        label="关闭提示"
        variant="ghost"
        size="sm"
        className="toast__close"
        onClick={() => onDismiss(toast.id)}
      />
    </div>
  );
}
