/**
 * 左右侧栏的通用外壳：标题栏 + 独立滚动区 + 可选底部操作条。
 *
 * 刻意做成**纯 props 组件**（不碰 Context）：侧栏本身是布局件，
 * 折叠态由 App 从 UIState 取好传进来。这样它可以被 T04/T06 直接复用，
 * 也能在不启动整个 Provider 的情况下单独调样式。
 *
 * 折叠后不是 `display:none`，而是缩成一条竖排文字的窄轨（见 `.app-panel__rail`）——
 * 完全消失会让用户找不到「怎么把它弄回来」。
 */

import { IconButton } from '../ui/Button';
import type { ReactNode } from 'react';
import type { TabPanelA11y } from './BottomTabBar';

export interface SidePanelProps {
  side: 'left' | 'right';
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  /** 底部常驻操作条，如「载入示例医生」 */
  footer?: ReactNode;
  /**
   * 移动端底部 Tab 的内容区语义（`tabPanelA11y()` 的产物）。
   * 桌面端传空对象即可——三栏同屏时不该有 tabpanel 角色。
   */
  a11y?: TabPanelA11y;
  children: ReactNode;
}

export function SidePanel(props: SidePanelProps): React.ReactElement {
  const { side, title, collapsed, onToggle, footer, a11y, children } = props;

  const classes = ['app-panel', `app-panel--${side}`, 'no-print'];
  if (collapsed) {
    classes.push('is-collapsed');
  }

  // 折叠按钮的箭头方向要指向「点下去之后面板会往哪走」，否则用户每次都得试一下
  const icon = side === 'left'
    ? (collapsed ? 'panelLeft' : 'chevronLeft')
    : (collapsed ? 'panelRight' : 'chevronRight');

  const toggle = (
    <IconButton
      icon={icon}
      label={collapsed ? `展开${title}` : `收起${title}`}
      variant="ghost"
      size="sm"
      onClick={onToggle}
    />
  );

  return (
    <aside className={classes.join(' ')} aria-label={title} {...a11y}>
      <div className="app-panel__header">
        {side === 'right' && toggle}
        <h2 className="app-panel__title">{title}</h2>
        {side === 'left' && toggle}
        <span className="app-panel__rail" aria-hidden="true">
          {title}
        </span>
      </div>
      <div className="app-panel__scroll">{children}</div>
      {footer && <div className="app-panel__footer">{footer}</div>}
    </aside>
  );
}
