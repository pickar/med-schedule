/**
 * 三层 Context 拆分 + 消费 hook。
 *
 * ## 为什么必须拆成三层（DESIGN 6.3）
 *
 * 单一 Context 的致命问题：任何一次 dispatch 都会让**全部**消费者重渲染。
 * 本应用最重的一屏是 30 天 × 31 行的排班表，接近 1000 个单元格；
 * 用户在左栏改一个医生姓名，如果整表跟着重渲染，输入框会明显掉帧。
 *
 * 拆分策略：
 * - `AppDispatchContext`：value 是 `useReducer` 返回的 dispatch，**引用永久稳定**。
 *   只要组件不读状态、只发事件（绝大多数按钮），订阅这一层就永不重渲染。
 * - `AppStateContext`：原始数据 + UI 状态。改什么都会变，所以**只给需要的容器组件订阅**。
 * - `DerivedContext`：校验与统计结果，经 `useDeferredValue` 降级，
 *   高频输入时可以落后主状态一帧，不阻塞打字。
 *
 * ## 铁律：叶子节点不订阅 Context
 *
 * `DoctorRow` / `ShiftCell` 一律**不许**调用这里的任何 hook。
 * 它们的数据必须由父级以 props 传下来，配合 `React.memo` 做引用比较才能跳过渲染。
 * 一旦叶子订阅了 Context，memo 就完全失效——Context 变更会强制穿透 memo 边界。
 *
 * 本文件刻意是 `.ts` 而非 `.tsx`：contexts 与 hooks 和组件分居两个文件，
 * 既满足 `react/only-export-components`，也让 AppProvider 能安全走 Fast Refresh。
 */

import { createContext, use } from 'react';
import type { AppDispatch, AppState } from '../types/state';
import type { DerivedData } from '../core/stats';
import { emptyDerived } from '../core/stats';
import { currentMonthKey } from '../lib/date';

// ============ Toast ============

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastData {
  id: string;
  tone: ToastTone;
  message: string;
  /** 次要说明，用于展开错误细节 */
  detail?: string;
  /** 行动按钮文案，如「重试」 */
  actionLabel?: string;
  onAction?: () => void;
  /** 自动消失毫秒数；传 0 表示常驻，必须由用户手动关闭 */
  duration?: number;
}

export type ToastInput = Omit<ToastData, 'id'> & { id?: string };

export interface ToastApi {
  /** 返回 toast id，便于后续手动 dismiss；传入相同 id 会**替换**而不是叠加 */
  show: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const NOOP_TOAST: ToastApi = {
  show: () => '',
  dismiss: () => undefined,
  clear: () => undefined,
};

// ============ Context 定义 ============

function warnMissingProvider(): void {
  if (import.meta.env.DEV) {
    console.warn('[warmshift] dispatch 在 AppProvider 之外被调用，本次操作已忽略');
  }
}

export const AppDispatchContext = createContext<AppDispatch>(warnMissingProvider);
AppDispatchContext.displayName = 'AppDispatchContext';

export const AppStateContext = createContext<AppState | null>(null);
AppStateContext.displayName = 'AppStateContext';

export const DerivedContext = createContext<DerivedData>(emptyDerived(currentMonthKey()));
DerivedContext.displayName = 'DerivedContext';

export const ToastContext = createContext<ToastApi>(NOOP_TOAST);
ToastContext.displayName = 'ToastContext';

/**
 * 立即重试写盘。
 *
 * 与 `ToastContext` 同属「稳定回调层」，而不是第四层状态：value 是 `useCallback`
 * 固定下来的函数，永不触发消费者重渲染。
 *
 * 为什么必须单独下发：自动保存挂在防抖 effect 上，依赖是 `doctors/rules/schedules`。
 * 保存失败后用户什么都没改，那三个依赖不变，effect 就永远不会再跑一次 ——
 * 顶栏那个「重试」按钮如果没有这条通道，点下去只会毫无反应。
 */
export const SaveRetryContext = createContext<() => void>(() => undefined);
SaveRetryContext.displayName = 'SaveRetryContext';

// ============ 消费 hook ============

/**
 * 取 dispatch。**这是最该被优先使用的 hook**：
 * 它的值引用恒定，订阅它的组件不会因为状态变化而重渲染。
 */
export function useAppDispatch(): AppDispatch {
  return use(AppDispatchContext);
}

/**
 * 取完整应用状态。
 * ⚠️ 只在容器组件里用。表格行、单元格等叶子节点请改用 props。
 */
export function useAppState(): AppState {
  const state = use(AppStateContext);
  if (state === null) {
    throw new Error('useAppState 必须在 <AppProvider> 内部使用');
  }
  return state;
}

/** 取 UI 状态切片（仍会随整个 state 重渲染，仅为书写便利） */
export function useUIState(): AppState['ui'] {
  return useAppState().ui;
}

/**
 * 取派生数据（校验结果 + 三类统计）。
 * 该值经 `useDeferredValue` 降级，可能比 `useAppState()` 落后一帧，
 * 这是刻意的：统计面板慢半拍无妨，输入框卡顿不可接受。
 * 需要判断是否落后时比较 `derived.month` 与 `ui.currentMonth`。
 */
export function useDerived(): DerivedData {
  return use(DerivedContext);
}

/** 取 toast API。返回值引用稳定，可安全放进 effect 依赖 */
export function useToast(): ToastApi {
  return use(ToastContext);
}

/** 取「立即重试写盘」回调。引用稳定，可安全放进依赖数组 */
export function useSaveRetry(): () => void {
  return use(SaveRetryContext);
}
