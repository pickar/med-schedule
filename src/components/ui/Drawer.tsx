/**
 * 右侧抽屉：承载「排班规则」「编辑医生」「请假登记」三块表单。
 *
 * 复用 `Modal.tsx` 的 `Overlay` 基座（Portal + 焦点陷阱 + Esc + 滚动锁），
 * 差异只在定位与入场动画，因此不重复实现那套无障碍逻辑——
 * 这类代码抄第二遍就一定会漏掉一条。
 *
 * 布局上抽屉是 `header / body / footer` 三段式 flex，
 * **只有 body 滚动**：底部的「保存规则」按钮必须常驻可见，
 * 规则表单在小屏上很长，让按钮跟着滚走会逼用户先滚到底才能提交。
 */

import type { ReactNode } from 'react';
import { Overlay } from './Modal';
import { IconButton } from './Button';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** CSS 宽度值，默认取 --drawer-doctor-w */
  width?: string;
  /** 底部常驻操作区 */
  footer?: ReactNode;
  /** 标题右侧的附加操作，如「删除医生」 */
  headerExtra?: ReactNode;
  dismissOnScrim?: boolean;
  titleId: string;
  children?: ReactNode;
}

export function Drawer(props: DrawerProps): React.ReactElement | null {
  const {
    open,
    onClose,
    title,
    subtitle,
    width = 'var(--drawer-doctor-w)',
    footer,
    headerExtra,
    dismissOnScrim = true,
    titleId,
    children,
  } = props;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      rootClassName="overlay overlay--right"
      panelClassName="drawer"
      panelStyle={{ width }}
      labelledBy={titleId}
      dismissOnScrim={dismissOnScrim}
    >
      <header className="drawer__header">
        <div className="drawer__heading">
          <h2 id={titleId} className="drawer__title">
            {title}
          </h2>
          {subtitle && <p className="drawer__subtitle">{subtitle}</p>}
        </div>
        <div className="drawer__header-actions">
          {headerExtra}
          <IconButton icon="close" label="关闭" variant="ghost" size="sm" onClick={onClose} />
        </div>
      </header>
      <div className="drawer__body">{children}</div>
      {footer && <footer className="drawer__footer">{footer}</footer>}
    </Overlay>
  );
}

/**
 * 抽屉内的分区块。
 * 抽出来是因为三个抽屉都是「标题 + 说明 + 一组控件」的重复结构，
 * 统一在这里定义间距，省得三处各写一遍还对不齐。
 */
export function DrawerSection({
  title,
  hint,
  children,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={className ? `drawer-section ${className}` : 'drawer-section'}>
      {title && <h3 className="drawer-section__title">{title}</h3>}
      {hint && <p className="drawer-section__hint">{hint}</p>}
      <div className="drawer-section__body">{children}</div>
    </section>
  );
}
