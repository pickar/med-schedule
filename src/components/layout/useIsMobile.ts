/**
 * 订阅移动端断点。
 *
 * 用 `useSyncExternalStore` 而不是 `useState + useEffect`：
 * matchMedia 是典型的外部可变源，走官方订阅通道才能保证并发渲染下
 * 读到的永远是**当前**这一帧的匹配结果，不会出现「已经窄屏了但还渲染着桌面版」的撕裂。
 *
 * SSR / 无 DOM 环境（烟测走 `renderToStaticMarkup`）一律返回 false：
 * 服务端拿不到视口宽度，按桌面端渲染再由客户端订阅纠正，是唯一不会闪烁的口径。
 */

import { useSyncExternalStore } from 'react';
import { MOBILE_QUERY } from '../../constants/breakpoints';

/** 懒创建并复用同一个 MediaQueryList，避免每次 getSnapshot 都新建对象 */
let cached: MediaQueryList | null = null;

function queryList(): MediaQueryList | null {
  if (cached !== null) {
    return cached;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  cached = window.matchMedia(MOBILE_QUERY);
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const list = queryList();
  if (list === null) {
    return () => undefined;
  }
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return queryList()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

/** 当前视口是否处于移动端断点（≤ MOBILE_MAX） */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
