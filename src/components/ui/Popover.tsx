/**
 * 锚定浮层：导出下拉、班次选择器、tooltip 详情都走这一个组件。
 *
 * 定位策略是「fixed + 视口坐标 + 越界翻转」，而不是相对定位：
 * 排班表的滚动容器层层嵌套且都开了 `overflow: hidden`，
 * 相对定位的浮层一旦超出单元格就会被裁掉半边。
 *
 * 首帧不可见（`visibility: hidden`）是刻意的：面板尺寸要先量出来才能算翻转，
 * 直接渲染会让用户看到浮层「先出现在错的位置、再跳到对的位置」。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type PopoverPlacement =
  | 'bottom-start'
  | 'bottom'
  | 'bottom-end'
  | 'top-start'
  | 'top'
  | 'top-end';

/** 浮层与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8;

interface Position {
  top: number;
  left: number;
  ready: boolean;
}

export interface PopoverProps {
  open: boolean;
  /** 锚点元素，通常来自触发按钮的 ref */
  anchor: HTMLElement | null;
  onClose: () => void;
  placement?: PopoverPlacement;
  /** 与锚点的间距，默认 6px */
  offset?: number;
  className?: string;
  labelledBy?: string;
  role?: 'dialog' | 'menu' | 'listbox';
  children: ReactNode;
}

export function Popover(props: PopoverProps): React.ReactElement | null {
  const {
    open,
    anchor,
    onClose,
    placement = 'bottom-start',
    offset = 6,
    className,
    labelledBy,
    role = 'dialog',
    children,
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState<Position>({ top: 0, left: 0, ready: false });

  const reposition = useCallback((): void => {
    const panel = panelRef.current;
    if (!panel || !anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    const wantsTop = placement.startsWith('top');
    const below = rect.bottom + offset;
    const above = rect.top - offset - box.height;
    // 首选方向放不下、反方向放得下时才翻转；两边都放不下就维持首选并靠边裁剪
    const fitsBelow = below + box.height <= viewportH - VIEWPORT_MARGIN;
    const fitsAbove = above >= VIEWPORT_MARGIN;
    const useTop = wantsTop ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    const rawTop = useTop ? above : below;

    let rawLeft = rect.left;
    if (placement.endsWith('-end')) {
      rawLeft = rect.right - box.width;
    } else if (!placement.includes('-')) {
      rawLeft = rect.left + rect.width / 2 - box.width / 2;
    }

    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportW - box.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportH - box.height - VIEWPORT_MARGIN);

    setPosition({
      top: Math.min(Math.max(rawTop, VIEWPORT_MARGIN), maxTop),
      left: Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), maxLeft),
      ready: true,
    });
  }, [anchor, offset, placement]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    reposition();
  }, [open, reposition, children]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onScrollOrResize = (): void => reposition();
    // capture: true —— 祖先滚动容器的滚动事件不冒泡，只能在捕获阶段拿到
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) {
        return;
      }
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, anchor, reposition]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className={className ? `popover ${className}` : 'popover'}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      role={role}
      aria-labelledby={labelledBy}
    >
      {children}
    </div>,
    document.body,
  );
}

/** 浮层内的菜单容器 */
export function PopoverMenu({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="popover-menu">{children}</div>;
}

export interface MenuItemProps {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  /** 危险操作（如删除）用红色文字 */
  danger?: boolean;
  icon?: ReactNode;
}

export function MenuItem(props: MenuItemProps): React.ReactElement {
  const { onClick, children, disabled = false, danger = false, icon } = props;
  const classes = ['popover-menu__item'];
  if (danger) {
    classes.push('is-danger');
  }
  return (
    <button type="button" className={classes.join(' ')} onClick={onClick} disabled={disabled} role="menuitem">
      {icon}
      <span>{children}</span>
    </button>
  );
}
