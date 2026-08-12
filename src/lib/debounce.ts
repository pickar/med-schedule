/**
 * 防抖工具与 `useDebouncedEffect` hook。
 *
 * 注：本文件是 `lib/**` 中唯一依赖 React 的例外（hook 天然与 React 绑定），
 * 其余 lib 文件保持零 React 依赖。
 */

import { useEffect, useRef } from 'react';

export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  /** 取消尚未触发的调用 */
  cancel: () => void;
  /** 立即触发尚未执行的调用 */
  flush: () => void;
}

/** 创建防抖函数，`wait` 毫秒内的重复调用只执行最后一次 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const debounced = ((...args: A): void => {
    lastArgs = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      const args2 = lastArgs;
      lastArgs = null;
      if (args2) {
        fn(...args2);
      }
    }, wait);
  }) as DebouncedFn<A>;

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const args = lastArgs;
    lastArgs = null;
    if (args) {
      fn(...args);
    }
  };

  return debounced;
}

/**
 * 防抖版 useEffect：依赖变化后延迟 `delay` 毫秒执行，
 * 期间依赖再次变化则重新计时。返回的清理函数会在卸载时取消定时器。
 *
 * 注意：`effect` 由 ref 持有最新引用，因此无需 `useCallback` 包裹，
 * 也不会因为函数身份变化而反复重启计时。
 */
export function useDebouncedEffect(
  effect: () => void,
  deps: readonly unknown[],
  delay: number,
): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    const timer = setTimeout(() => {
      effectRef.current();
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}
