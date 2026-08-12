/**
 * 窄屏自动折叠侧栏。
 *
 * 只在**进入**窄屏时折叠一次，不做反向自动展开——
 * 用户在窄屏下手动展开侧栏后，不该因为拖动了一下窗口又被收起来。
 * 折叠优先级：先收右栏（洞察是辅助信息），实在放不下再收左栏（名册）。
 */

import { useEffect } from 'react';
import { useAppDispatch } from '../../state/contexts';
import type { UIState } from '../../types/state';
import { MOBILE_QUERY } from '../../constants/breakpoints';

interface CollapseSpec {
  query: string;
  payload: Partial<UIState>;
}

const SPECS: readonly CollapseSpec[] = [
  { query: '(max-width: 1200px)', payload: { insightPanelCollapsed: true } },
  { query: '(max-width: 960px)', payload: { doctorPanelCollapsed: true } },
];

export function useResponsiveCollapse(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    /*
     * 移动端（≤768px）走底部 Tab 单栏，折叠态在那里没有对应的视觉形态。
     * 继续折叠只会留下一份脏状态：用户从手机宽度拉回桌面宽度时，
     * 两侧栏会莫名其妙已经收成竖条。所以窄到移动端就整体停手。
     */
    const mobile = window.matchMedia(MOBILE_QUERY);

    const cleanups = SPECS.map(({ query, payload }) => {
      const list = window.matchMedia(query);
      const onChange = (event: MediaQueryList | MediaQueryListEvent): void => {
        if (event.matches && !mobile.matches) {
          dispatch({ type: 'ui/patch', payload });
        }
      };
      // 首次挂载时用当前匹配情况跑一遍：小窗口直接打开页面也要生效
      onChange(list);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    });

    return () => cleanups.forEach((fn) => fn());
  }, [dispatch]);
}
