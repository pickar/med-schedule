/**
 * 移动端底部 Tab 栏：名册 / 排班 / 洞察。
 *
 * ## 为什么是 Tab 而不是抽屉
 *
 * 手机上三栏挤不下，常见做法有两种：把侧栏做成抽屉，或者做成底部 Tab。
 * 这里选 Tab，理由是排班场景里「看名册」与「看洞察」不是偶发操作，
 * 而是与「改排班」来回穿插的高频动作——抽屉每次都要先点开、再手动关掉，
 * 来回三次就开始烦；Tab 是一次点击直达，且始终显示当前在哪一块。
 *
 * ## 可见性由 CSS 决定，不由 JS 决定
 *
 * 本组件恒定渲染，桌面端由 `layout.css` 的 `display: none` 摘掉。
 * 不用 `useIsMobile()` 做条件渲染，是为了避免「JS 断点」与「CSS 断点」两套判断
 * 在同一帧里给出不同答案，从而出现底部空一条或内容被 Tab 栏压住的错位。
 *
 * ## 键盘
 *
 * 按 WAI-ARIA Tabs 模式实现 roving tabindex：列表里只有选中项可被 Tab 键聚焦，
 * 左右方向键在页签间移动并直接切换（自动激活），Home / End 跳到首尾。
 */

import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useAppDispatch, useAppState } from '../../state/contexts';
import type { MobileTab } from '../../types/state';
import { Icon } from '../ui/Icons';
import type { IconName } from '../ui/Icons';
import { TEXTS } from '../../constants/texts';

/** 页签按钮的 DOM id，供 `aria-controls` / `aria-labelledby` 双向指认 */
export function tabButtonId(tab: MobileTab): string {
  return `mobile-tab-${tab}`;
}

/** 内容区的 DOM id */
export function tabPanelId(tab: MobileTab): string {
  return `mobile-tabpanel-${tab}`;
}

/**
 * 内容区需要挂的一组无障碍属性。
 *
 * `enabled` 为 false（桌面端）时返回空对象：三栏同屏时给它们套 `role="tabpanel"`
 * 是错的——没有可见的 tablist 在控制它们，屏幕阅读器会报出一个不存在的选项卡组，
 * 同时还会把 `<main>` / `<aside>` 原有的地标语义顶掉。
 */
export interface TabPanelA11y {
  id?: string;
  role?: 'tabpanel';
  'aria-labelledby'?: string;
}

export function tabPanelA11y(tab: MobileTab, enabled: boolean): TabPanelA11y {
  if (!enabled) {
    return {};
  }
  return {
    id: tabPanelId(tab),
    role: 'tabpanel',
    'aria-labelledby': tabButtonId(tab),
  };
}

interface TabSpec {
  id: MobileTab;
  label: string;
  icon: IconName;
}

const TABS: readonly TabSpec[] = [
  { id: 'roster', label: TEXTS.mobileTabRoster, icon: 'user' },
  { id: 'schedule', label: TEXTS.mobileTabSchedule, icon: 'calendar' },
  { id: 'insight', label: TEXTS.mobileTabInsight, icon: 'info' },
];

export function BottomTabBar(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const active = state.ui.mobileTab;

  // 方向键切换后要把焦点跟过去，否则焦点留在原按钮上，读屏播报与视觉选中会对不上
  const listRef = useRef<HTMLDivElement | null>(null);

  const select = useCallback(
    (tab: MobileTab): void => {
      dispatch({ type: 'ui/setMobileTab', payload: { tab } });
    },
    [dispatch],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const current = TABS.findIndex((tab) => tab.id === active);
      if (current < 0) {
        return;
      }

      let next = -1;
      if (event.key === 'ArrowRight') {
        next = (current + 1) % TABS.length;
      } else if (event.key === 'ArrowLeft') {
        next = (current - 1 + TABS.length) % TABS.length;
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = TABS.length - 1;
      }

      if (next < 0) {
        return;
      }

      event.preventDefault();
      const target = TABS[next];
      if (target === undefined) {
        return;
      }
      select(target.id);
      listRef.current?.querySelector<HTMLButtonElement>(`#${tabButtonId(target.id)}`)?.focus();
    },
    [active, select],
  );

  return (
    <nav className="app-tabbar no-print" aria-label={TEXTS.mobileTabBarLabel}>
      <div className="app-tabbar__list" role="tablist" ref={listRef} onKeyDown={handleKeyDown}>
        {TABS.map((tab) => {
          const selected = tab.id === active;
          const classes = ['app-tabbar__tab'];
          if (selected) {
            classes.push('is-active');
          }
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabButtonId(tab.id)}
              className={classes.join(' ')}
              aria-selected={selected}
              aria-controls={tabPanelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
            >
              <Icon name={tab.icon} size={20} strokeWidth={selected ? 2 : 1.6} />
              <span className="app-tabbar__label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
