/**
 * 自定义班次域 handler：新增 / 编辑 / 删除（含级联置空引用格）。
 *
 * **结构共享纪律**（同 doctorHandlers / scheduleHandlers）：
 * 所有函数在「没有实际变化」时必须返回原对象引用，否则 `applyData`
 * 会误记一条历史，且会让依赖 `customShifts` 引用相等的 `React.memo` 叶子全部重渲染。
 *
 * 删除的级联语义（见设计 §1.5 / Q2 默认方案）：
 * `clearUsages` 为 true 时，把引用该 id 的全部 `ScheduleEntry` 删除（空即删），
 * 表格不会出现「幽灵班次」，且整次删除 + 置空可被撤销栈整体回退。
 */

import type { AppState } from '../../types/state';
import type {
  DaySchedule,
  MonthSchedule,
  SchedulesByMonth,
  ShiftDefinition,
} from '../../types/domain';

/** 自定义班次总数上限（设计 §4 边界约定，Q5 默认 30） */
export const MAX_CUSTOM_SHIFTS = 30;

/** 新增自定义班次（达到上限时拒绝，返回原引用） */
export function addCustomShift(state: AppState, def: ShiftDefinition): AppState {
  if (state.customShifts.length >= MAX_CUSTOM_SHIFTS) {
    return state;
  }
  return { ...state, customShifts: [...state.customShifts, def] };
}

/** 编辑自定义班次：仅替换目标条目，其余保持原引用 */
export function updateCustomShift(state: AppState, def: ShiftDefinition): AppState {
  const index = state.customShifts.findIndex((d) => d.id === def.id);
  if (index < 0) {
    return state;
  }
  if (Object.is(state.customShifts[index], def)) {
    return state;
  }
  const next = [...state.customShifts];
  next[index] = def;
  return { ...state, customShifts: next };
}

/**
 * 删除自定义班次。
 * - 内置班次（isBuiltin）不可删，原样返回。
 * - 不存在的 id 原样返回。
 * - `clearUsages` 为 true 时，级联删除所有引用该 id 的排班条目（空即删）。
 */
export function removeCustomShift(
  state: AppState,
  id: string,
  clearUsages: boolean,
): AppState {
  const def = state.customShifts.find((d) => d.id === id);
  if (!def || def.isBuiltin) {
    return state;
  }
  const nextCustom = state.customShifts.filter((d) => d.id !== id);
  if (!clearUsages) {
    if (nextCustom === state.customShifts) {
      return state;
    }
    return { ...state, customShifts: nextCustom };
  }
  const nextSchedules = clearShiftReferences(state.schedules, id);
  if (nextCustom === state.customShifts && nextSchedules === state.schedules) {
    return state;
  }
  return { ...state, customShifts: nextCustom, schedules: nextSchedules };
}

/**
 * 删除所有引用指定班次 id 的排班条目（空即删）。
 * 仅重建「确实包含该 id」的月份 / 日期，其余路径保持原引用，避免无谓重渲染。
 */
function clearShiftReferences(schedules: SchedulesByMonth, id: string): SchedulesByMonth {
  let changed = false;
  const nextMonths: SchedulesByMonth = {};
  for (const [month, monthSchedule] of Object.entries(schedules)) {
    let monthChanged = false;
    const nextDays: MonthSchedule = {};
    for (const [date, day] of Object.entries(monthSchedule)) {
      let dayChanged = false;
      const nextDay: DaySchedule = {};
      for (const [doctorId, entry] of Object.entries(day)) {
        if (entry.shiftType === id) {
          dayChanged = true;
          continue;
        }
        nextDay[doctorId] = entry;
      }
      if (dayChanged) {
        monthChanged = true;
        if (Object.keys(nextDay).length > 0) {
          nextDays[date] = nextDay;
        }
      } else {
        nextDays[date] = day;
      }
    }
    if (monthChanged) {
      changed = true;
      nextMonths[month] = nextDays;
    } else {
      nextMonths[month] = monthSchedule;
    }
  }
  return changed ? nextMonths : schedules;
}
