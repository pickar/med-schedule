/**
 * 排班域 handler：单元格写入、锁定切换、生成结果应用、清空月份。
 *
 * **本文件是整个应用最吃渲染性能的地方**，两条纪律：
 * 1. 改一格只能新建「该月 -> 该日」这一条路径上的对象，其余 30 天必须保持原引用，
 *    否则 `React.memo` 在 `DoctorRow` / `ShiftCell` 上全部失效。
 * 2. 空即删：`shiftType` 为 null 时删掉条目；某日无条目删掉该日；某月无数据删掉该月。
 *    留空壳会让「本月是否有排班」这类判断到处需要额外过滤。
 */

import type { DaySchedule, MonthSchedule, ScheduleEntry, ShiftType } from '../../types/domain';
import type { AppState } from '../../types/state';
import { monthOfDate } from '../../lib/date';
import type { DayOutcome, ShiftCyclePlan } from '../../core/shiftCycle';
import { collectWrites, planShiftCycle } from '../../core/shiftCycle';

/** 取某月排班，不存在时返回空对象（注意：返回的是新对象，只读用途） */
export function getMonthSchedule(state: AppState, month: string): MonthSchedule {
  return state.schedules[month] ?? {};
}

/** 写入一个新的月排班；传入空对象时删除该月 key */
function withMonth(state: AppState, month: string, next: MonthSchedule): AppState {
  if (Object.keys(next).length === 0) {
    if (!(month in state.schedules)) {
      return state;
    }
    const { [month]: _dropped, ...rest } = state.schedules;
    return { ...state, schedules: rest };
  }
  return { ...state, schedules: { ...state.schedules, [month]: next } };
}

/** 写入某天的排班；传入空对象时删除该天 key */
function withDay(monthSchedule: MonthSchedule, date: string, next: DaySchedule): MonthSchedule {
  if (Object.keys(next).length === 0) {
    if (!(date in monthSchedule)) {
      return monthSchedule;
    }
    const { [date]: _dropped, ...rest } = monthSchedule;
    return rest;
  }
  return { ...monthSchedule, [date]: next };
}

/**
 * 设置单元格班次。`shiftType` 为 null 表示清空。
 *
 * 手动修改标记（`manual`）默认为 true：这个 action 只会来自用户点选，
 * 生成器走的是 `applyGenerated`。调用方需要写入非手动条目时显式传 false。
 */
export function setCell(
  state: AppState,
  date: string,
  doctorId: string,
  shiftType: ShiftType | null,
  manual = true,
): AppState {
  const month = monthOfDate(date);
  const monthSchedule = state.schedules[month] ?? {};
  const day = monthSchedule[date] ?? {};
  const existing = day[doctorId];

  if (shiftType === null) {
    if (!existing) {
      return state;
    }
    const { [doctorId]: _dropped, ...restDay } = day;
    return withMonth(state, month, withDay(monthSchedule, date, restDay));
  }

  if (existing && existing.shiftType === shiftType && existing.manual === manual) {
    return state;
  }

  const entry: ScheduleEntry = {
    doctorId,
    shiftType,
    // 手动改班后不再是轮流规则的产物，轮流标记必须清掉
    isRotation: manual ? false : (existing?.isRotation ?? false),
    manual,
  };
  // 锁定态属于用户意图，改班不应把它抹掉
  if (existing?.locked) {
    entry.locked = true;
  }

  return withMonth(state, month, withDay(monthSchedule, date, { ...day, [doctorId]: entry }));
}

/** 切换单元格锁定态；空格不可锁定（没有内容可保留） */
export function toggleLock(state: AppState, date: string, doctorId: string): AppState {
  const month = monthOfDate(date);
  const monthSchedule = state.schedules[month];
  const existing = monthSchedule?.[date]?.[doctorId];
  if (!monthSchedule || !existing) {
    return state;
  }

  const entry: ScheduleEntry = { ...existing };
  if (existing.locked) {
    delete entry.locked;
  } else {
    entry.locked = true;
  }

  const day = { ...monthSchedule[date], [doctorId]: entry };
  return withMonth(state, month, withDay(monthSchedule, date, day));
}

/** 解除某月全部锁定 */
export function unlockAll(state: AppState, month: string): AppState {
  const monthSchedule = state.schedules[month];
  if (!monthSchedule) {
    return state;
  }

  let changed = false;
  const next: MonthSchedule = {};
  for (const [date, day] of Object.entries(monthSchedule)) {
    let dayChanged = false;
    const nextDay: DaySchedule = {};
    for (const [doctorId, entry] of Object.entries(day)) {
      if (!entry.locked) {
        nextDay[doctorId] = entry;
        continue;
      }
      dayChanged = true;
      const { locked: _locked, ...rest } = entry;
      nextDay[doctorId] = rest;
    }
    next[date] = dayChanged ? nextDay : day;
    changed = changed || dayChanged;
  }

  return changed ? withMonth(state, month, next) : state;
}

/**
 * 应用生成结果。
 *
 * 生成器内部已经预占并还原了锁定格，这里**再兜一层**：
 * 万一调用方传进来的是一份没走 `existingSchedule` 的结果，锁定格也不会被冲掉。
 * 用户按下的锁，任何路径都不能替他解开。
 */
export function applyGenerated(
  state: AppState,
  month: string,
  entries: MonthSchedule,
): AppState {
  const previous = state.schedules[month] ?? {};
  const next: MonthSchedule = {};
  const dates = new Set([...Object.keys(entries), ...Object.keys(previous)]);

  for (const date of dates) {
    const generatedDay = entries[date] ?? {};
    const previousDay = previous[date] ?? {};
    const day: DaySchedule = { ...generatedDay };

    for (const [doctorId, entry] of Object.entries(previousDay)) {
      if (entry.locked) {
        day[doctorId] = entry;
      }
    }

    if (Object.keys(day).length > 0) {
      next[date] = day;
    }
  }

  return withMonth(state, month, next);
}

/** 清空某月排班；锁定格一并清除（用户点的是「清空」，不是「重新生成」） */
export function clearMonth(state: AppState, month: string): AppState {
  if (!(month in state.schedules)) {
    return state;
  }
  const { [month]: _dropped, ...rest } = state.schedules;
  return { ...state, schedules: rest };
}

/** 统计某月锁定格数量，供重新生成确认弹窗选文案 */
export function countLockedCells(state: AppState, month: string): number {
  const monthSchedule = state.schedules[month];
  if (!monthSchedule) {
    return 0;
  }
  let count = 0;
  for (const day of Object.values(monthSchedule)) {
    for (const entry of Object.values(day)) {
      if (entry.locked) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * 应用一段轮班（形态 A：班次序列循环·按医生）。
 *
 * 入口从 state 自取医生 / leaves / schedules 并重算 plan，保证「预览即实际写入」。
 * 若医生不存在或实际落库条目为空，返回原 state 引用（不进撤销栈）。
 * 逐月用私有 `withMonth/withDay` 写入，未涉及月份保持原引用以保 memo。
 */
export function applyShiftCycle(
  state: AppState,
  payload: {
    doctorId: string;
    sequence: ShiftType[];
    startDate: string;
    endDate: string;
    overwrite: boolean;
  },
): AppState {
  const doctor = state.doctors.find((d) => d.id === payload.doctorId);
  if (!doctor) {
    return state;
  }

  const plan: ShiftCyclePlan = planShiftCycle({
    doctorId: payload.doctorId,
    sequence: payload.sequence,
    startDate: payload.startDate,
    endDate: payload.endDate,
    overwrite: payload.overwrite,
    leaves: doctor.leaves ?? [],
    schedules: state.schedules,
  });

  const writes = collectWrites(plan);
  if (writes.length === 0) {
    // 无改动即无历史：返回原引用，reducer 的 applyData 出口据此跳过 push
    return state;
  }

  // 按月分组，未涉及月份保持原引用
  const byMonth = new Map<string, DayOutcome[]>();
  for (const outcome of writes) {
    const month = monthOfDate(outcome.date);
    const list = byMonth.get(month);
    if (list) {
      list.push(outcome);
    } else {
      byMonth.set(month, [outcome]);
    }
  }

  let next = state;
  for (const [month, outcomes] of byMonth) {
    const monthSchedule = next.schedules[month] ?? {};
    let day = monthSchedule;
    for (const outcome of outcomes) {
      const existing = day[outcome.date]?.[payload.doctorId];
      const entry: ScheduleEntry = {
        doctorId: payload.doctorId,
        shiftType: outcome.shiftType,
        // 手动轮班写入：非轮流产物、标记手动、兜底保留原锁定态
        isRotation: false,
        manual: true,
        locked: existing?.locked ?? false,
      };
      const prevDay = day[outcome.date] ?? {};
      day = withDay(day, outcome.date, { ...prevDay, [payload.doctorId]: entry });
    }
    next = withMonth(next, month, day);
  }
  return next;
}
