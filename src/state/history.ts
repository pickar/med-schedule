/**
 * 撤销 / 重做：快照式，深度 30。
 *
 * 为什么是快照而不是反向 action（DESIGN 6.4 已论证）：
 * `applyGenerated` / `clearAll` 的逆操作本身就得存全量数据，反向 action 会退化成
 * 快照，还多背一套「每个 action 配一个逆操作」的维护负担，且极易漏写。
 *
 * **内存实际远低于设计文档估算的 2.2MB**：reducer 全程不可变更新，未改动的
 * 月份 / 日期对象在新旧 state 间是同一个引用，30 份快照共享绝大部分结构。
 * 只有真正被改动的那条路径才是新对象。所以这里存引用即可，**不要深拷贝**——
 * 深拷贝会把这个优势彻底抹掉，还会让快照与 state 脱钩。
 *
 * label 约定：`past[i].label` 记录的是「把 `past[i].snapshot` 变成下一个状态的
 * 那次操作」的名字。因此栈顶 label 正是撤销按钮该显示的操作名。
 */

import type { AppState, DataSnapshot, HistoryState } from '../types/state';
import { MAX_HISTORY } from '../constants/defaults';

export function emptyHistory(): HistoryState {
  return { past: [], future: [] };
}

/** 从完整 state 中摘出参与撤销的四个数据字段（不含 UI 与历史本身） */
export function snapshotOf(state: AppState): DataSnapshot {
  return {
    doctors: state.doctors,
    rules: state.rules,
    schedules: state.schedules,
    customShifts: state.customShifts,
  };
}

/** 快照是否与当前状态等价（引用比较即可，reducer 保证不可变） */
export function isSameSnapshot(a: DataSnapshot, b: DataSnapshot): boolean {
  return (
    a.doctors === b.doctors &&
    a.rules === b.rules &&
    a.schedules === b.schedules &&
    a.customShifts === b.customShifts
  );
}

/**
 * 记录一步历史。
 * @param snapshot 操作**之前**的数据快照
 * @param label    本次操作的描述，如「修改 张伟 8/12 班次」
 */
export function pushHistory(
  history: HistoryState,
  snapshot: DataSnapshot,
  label: string,
): HistoryState {
  const past = [...history.past, { snapshot, label }].slice(-MAX_HISTORY);
  // 产生新分支后重做栈必须清空，否则会重做到一条已经不存在的时间线上
  return { past, future: [] };
}

export interface TimeTravelResult {
  history: HistoryState;
  snapshot: DataSnapshot;
  /** 被撤销 / 重做的操作名，用于 toast 或状态提示 */
  label: string;
}

/** 撤销一步；栈空时返回 null */
export function undo(history: HistoryState, current: DataSnapshot): TimeTravelResult | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    return null;
  }
  return {
    history: {
      past: history.past.slice(0, -1),
      // 复用同一个 label：重做的正是刚被撤销的那次操作
      future: [...history.future, { snapshot: current, label: entry.label }],
    },
    snapshot: entry.snapshot,
    label: entry.label,
  };
}

/** 重做一步；栈空时返回 null */
export function redo(history: HistoryState, current: DataSnapshot): TimeTravelResult | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) {
    return null;
  }
  return {
    history: {
      past: [...history.past, { snapshot: current, label: entry.label }],
      future: history.future.slice(0, -1),
    },
    snapshot: entry.snapshot,
    label: entry.label,
  };
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}

/** 下一步撤销的操作名，供按钮 tooltip；栈空时返回 null */
export function undoLabel(history: HistoryState): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

/** 下一步重做的操作名，供按钮 tooltip；栈空时返回 null */
export function redoLabel(history: HistoryState): string | null {
  return history.future[history.future.length - 1]?.label ?? null;
}
