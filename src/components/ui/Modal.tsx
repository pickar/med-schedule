/**
 * 模态对话框，以及被 Drawer 复用的 `Overlay` 基座。
 *
 * `Overlay` 集中处理四件所有浮层都必须做、又最容易漏做的事：
 * 1. **Portal 到 body**：否则父级的 `overflow: hidden`（排班表滚动容器到处都是）
 *    会把浮层裁掉一角。
 * 2. **焦点管理**：打开时把焦点移进面板，Tab 在面板内循环，关闭时还给触发元素。
 *    不做这件事，键盘用户按 Tab 会跑到被遮罩盖住的背景里，从此再也回不来。
 * 3. **Esc 关闭 + 遮罩点击关闭**（可关）。
 * 4. **body 滚动锁**，用计数器兜住「弹窗上再开弹窗」的嵌套情况。
 *
 * 关闭时直接返回 null（不做退场动画）：本应用的浮层都不承载过场叙事，
 * 留在 DOM 里等动画反而会让焦点归还时机变得难以推理。
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let scrollLockCount = 0;
let previousBodyOverflow = '';

function lockBodyScroll(): () => void {
  scrollLockCount += 1;
  if (scrollLockCount === 1) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  return () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
    }
  };
}

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** 根容器类名，决定面板的定位方式（居中 / 贴右） */
  rootClassName: string;
  panelClassName: string;
  panelStyle?: CSSProperties;
  /** 标题元素 id，供 aria-labelledby */
  labelledBy?: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  /** 点击遮罩是否关闭，破坏性确认框应设为 false */
  dismissOnScrim?: boolean;
  children: ReactNode;
}

export function Overlay(props: OverlayProps): React.ReactElement | null {
  const {
    open,
    onClose,
    rootClassName,
    panelClassName,
    panelStyle,
    labelledBy,
    describedBy,
    role = 'dialog',
    dismissOnScrim = true,
    children,
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const releaseScroll = lockBodyScroll();

    // 打开后把焦点送进面板：优先第一个可聚焦元素，没有就聚焦面板本身
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const head = nodes[0];
      const tail = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      releaseScroll();
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className={rootClassName}>
      <div
        className="overlay__scrim"
        onClick={dismissOnScrim ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={panelClassName}
        style={panelStyle}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 标题下方的一行补充说明 */
  subtitle?: ReactNode;
  size?: ModalSize;
  /** 底部操作区，通常放 `<Button>` */
  footer?: ReactNode;
  /** 隐藏右上角关闭按钮（确认类弹窗只允许走明确的两个按钮） */
  hideClose?: boolean;
  dismissOnScrim?: boolean;
  role?: 'dialog' | 'alertdialog';
  titleId: string;
  children?: ReactNode;
}

const MODAL_WIDTH: Record<ModalSize, string> = { sm: '360px', md: '480px', lg: '640px' };

export function Modal(props: ModalProps): React.ReactElement | null {
  const {
    open,
    onClose,
    title,
    subtitle,
    size = 'md',
    footer,
    hideClose = false,
    dismissOnScrim = true,
    role = 'dialog',
    titleId,
    children,
  } = props;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      role={role}
      rootClassName="overlay overlay--center"
      panelClassName="modal"
      panelStyle={{ width: MODAL_WIDTH[size] }}
      labelledBy={titleId}
      dismissOnScrim={dismissOnScrim}
    >
      <header className="modal__header">
        <div className="modal__heading">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          {subtitle && <p className="modal__subtitle">{subtitle}</p>}
        </div>
        {!hideClose && <IconButton icon="close" label="关闭" variant="ghost" size="sm" onClick={onClose} />}
      </header>
      {children !== undefined && <div className="modal__body">{children}</div>}
      {footer && <footer className="modal__footer">{footer}</footer>}
    </Overlay>
  );
}
