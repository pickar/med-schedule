/**
 * 应用根 Provider：状态、派生数据、toast、持久化、快捷键的唯一装配点。
 *
 * 四件事在这里发生：
 * 1. **三层 Context 下发**（见 contexts.ts 的拆分论证）。
 * 2. **水合**：首帧后从 localStorage 读回数据；读失败不清空、只提示。
 * 3. **自动保存**：数据变更后防抖 500ms 写盘。写失败**绝不静默**——
 *    弹常驻 toast 并按 `StorageError.code` 给出可操作的解释（隐私模式 / 配额满）。
 * 4. **撤销重做快捷键**：Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y，
 *    光标在输入框内时让位给浏览器自带的文本撤销。
 *
 * 派生数据走 `useDeferredValue`：统计与校验是 O(天数 × 医生数) 的重活，
 * 让它比主状态晚一帧，换取输入框和单元格点选的即时反馈。
 * 四个字段**从同一个 deferred 快照里取**，避免出现「医生已更新、排班还没更新」
 * 的撕裂状态导致统计出现一帧的错值。
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DataSnapshot } from '../types/state';
import type { StorageErrorCode } from '../lib/storage';
import { isStorageAvailable, loadAllDetailed, saveAllSafe } from '../lib/storage';
import { SAVE_DEBOUNCE_MS } from '../constants/defaults';
import { TEXTS } from '../constants/texts';
import { useDebouncedEffect } from '../lib/debounce';
import { createId } from '../lib/id';
import { computeDerived } from '../core/stats';
import { ToastViewport } from '../components/ui/Toast';
import type { ToastApi, ToastData, ToastInput } from './contexts';
import {
  AppDispatchContext,
  AppStateContext,
  DerivedContext,
  SaveRetryContext,
  ToastContext,
} from './contexts';
import { createInitialState, reducer } from './reducer';
import { isSameSnapshot, snapshotOf } from './history';
import { EMPTY_MONTH_SCHEDULE } from './selectors';

/** 同屏最多堆 4 条 toast，再多就把最旧的挤掉 */
const MAX_TOASTS = 4;

/** 存储失败的补充说明：给一句用户**能照着做**的话，而不是抛个错误码 */
function detailForCode(code: StorageErrorCode | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'unavailable':
      return TEXTS.storageFailedPrivate;
    case 'quota':
      return TEXTS.storageFailedQuota;
    default:
      return fallback ?? TEXTS.storageFailedUnknown;
  }
}

/** 焦点在可编辑元素里时，Ctrl+Z 应该撤销文字输入而不是撤销排班 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function AppProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [toasts, setToasts] = useState<readonly ToastData[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // ---------- toast ----------

  const dismissToast = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((input: ToastInput): string => {
    const id = input.id ?? createId();
    setToasts((prev) => {
      // 同 id 视为「更新那条」而不是再叠一条：反复保存失败只该有一条提示
      const rest = prev.filter((t) => t.id !== id);
      return [...rest, { ...input, id }].slice(-MAX_TOASTS);
    });
    return id;
  }, []);

  const clearToasts = useCallback((): void => setToasts([]), []);

  const toastApi = useMemo<ToastApi>(
    () => ({ show: showToast, dismiss: dismissToast, clear: clearToasts }),
    [showToast, dismissToast, clearToasts],
  );

  // ---------- 持久化 ----------

  const stateRef = useRef(state);
  stateRef.current = state;
  /** 最近一次成功写盘的快照，用于跳过「数据没变也写一遍」 */
  const lastSavedRef = useRef<DataSnapshot | null>(null);
  /** 上次失败的原因码，用于去重 toast */
  const lastErrorRef = useRef<StorageErrorCode | 'none'>('none');
  /** 先声明后赋值：toast 的「重试」按钮要调当时最新的 runSave，闭包直接引会锁死旧快照 */
  const runSaveRef = useRef<() => void>(() => undefined);

  const runSave = useCallback((): void => {
    const snapshot = snapshotOf(stateRef.current);
    dispatch({ type: 'app/saveStatus', payload: { status: 'saving' } });

    const result = saveAllSafe(snapshot);
    if (result.ok) {
      lastSavedRef.current = snapshot;
      if (lastErrorRef.current !== 'none') {
        lastErrorRef.current = 'none';
        dismissToast('storage-error');
      }
      dispatch({ type: 'app/saveStatus', payload: { status: 'saved', at: Date.now() } });
      return;
    }

    dispatch({ type: 'app/saveStatus', payload: { status: 'error', error: result.error } });
    const code = result.code ?? 'unknown';
    // 同一种失败只提示一次，否则每敲一下键盘就弹一条
    if (lastErrorRef.current === code) {
      return;
    }
    lastErrorRef.current = code;
    showToast({
      id: 'storage-error',
      tone: 'danger',
      message: TEXTS.storageFailed,
      detail: detailForCode(result.code, result.error),
      actionLabel: TEXTS.saveRetry,
      onAction: () => runSaveRef.current(),
      duration: 0,
    });
  }, [dismissToast, showToast]);

  runSaveRef.current = runSave;

  /**
   * 顶栏「重试」按钮的入口。走 ref 而不是直接给 `runSave`：
   * 这样 value 的引用永久稳定，订阅它的顶栏不会因为保存状态变化而多渲染一轮。
   */
  const retrySave = useCallback((): void => runSaveRef.current(), []);

  const hydrateOnceRef = useRef(false);
  useEffect(() => {
    // StrictMode 下 effect 会跑两次，读盘只该发生一次
    if (hydrateOnceRef.current) {
      return;
    }
    hydrateOnceRef.current = true;

    const result = loadAllDetailed();
    if (result.snapshot) {
      dispatch({ type: 'app/hydrate', payload: result.snapshot });
      lastSavedRef.current = result.snapshot;
    }
    if (result.error) {
      showToast({
        tone: 'warning',
        message: TEXTS.loadFailed,
        detail: result.error,
        duration: 0,
      });
    } else if (!isStorageAvailable()) {
      // 提前预警：等用户排完一整月才发现存不下，就太晚了
      lastErrorRef.current = 'unavailable';
      showToast({
        id: 'storage-error',
        tone: 'warning',
        message: TEXTS.storageFailed,
        detail: TEXTS.storageFailedPrivate,
        duration: 0,
      });
    }
    setHydrated(true);
  }, [showToast]);

  useDebouncedEffect(
    () => {
      if (!hydrated) {
        return;
      }
      const snapshot = snapshotOf(stateRef.current);
      const previous = lastSavedRef.current;
      if (previous && isSameSnapshot(snapshot, previous)) {
        return;
      }
      runSaveRef.current();
    },
    [hydrated, state.doctors, state.rules, state.schedules],
    SAVE_DEBOUNCE_MS,
  );

  // ---------- 快捷键 ----------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      dispatch({ type: key === 'y' || event.shiftKey ? 'history/redo' : 'history/undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---------- 派生数据 ----------

  const deferredState = useDeferredValue(state);
  const month = deferredState.ui.currentMonth;
  const monthSchedule = deferredState.schedules[month] ?? EMPTY_MONTH_SCHEDULE;
  const doctors = deferredState.doctors;
  const rules = deferredState.rules;

  const derived = useMemo(
    () => computeDerived({ month, schedule: monthSchedule, doctors, rules }),
    [month, monthSchedule, doctors, rules],
  );

  return (
    <AppDispatchContext.Provider value={dispatch}>
      <ToastContext.Provider value={toastApi}>
        <SaveRetryContext.Provider value={retrySave}>
          <AppStateContext.Provider value={state}>
            <DerivedContext.Provider value={derived}>
              {children}
              <ToastViewport toasts={toasts} onDismiss={dismissToast} />
            </DerivedContext.Provider>
          </AppStateContext.Provider>
        </SaveRetryContext.Provider>
      </ToastContext.Provider>
    </AppDispatchContext.Provider>
  );
}
