/**
 * 只读选择器：把「从 state 里挖数据」的逻辑从组件里收拢过来。
 *
 * 纪律：
 * - 全部为纯函数，不依赖 React，可在测试与生成器里直接调用。
 * - **返回新数组 / 新对象的选择器已在注释中标注**，调用方必须用 `useMemo` 包裹，
 *   否则每次渲染都会造出新引用，把下游 `React.memo` 全部打穿。
 * - 命名统一 `selectXxx`，避免与 handler 的动词命名混淆。
 */

import type { Doctor, MonthSchedule, SchedulesByMonth } from '../types/domain';
import type { AppState } from '../types/state';
import type { DerivedParams } from '../core/stats';
import { canRedo, canUndo, redoLabel, undoLabel } from './history';

/** 空月排班的共享常量。**必须复用同一个引用**，否则派生数据每帧都会重算 */
export const EMPTY_MONTH_SCHEDULE: MonthSchedule = Object.freeze({});

// ============ 月份 / 排班 ============

export function selectCurrentMonth(state: AppState): string {
  return state.ui.currentMonth;
}

/** 取某月排班，无数据时返回共享空对象（非新对象） */
export function selectMonthSchedule(state: AppState, month: string): MonthSchedule {
  return state.schedules[month] ?? EMPTY_MONTH_SCHEDULE;
}

export function selectCurrentSchedule(state: AppState): MonthSchedule {
  return selectMonthSchedule(state, state.ui.currentMonth);
}

/** 当前月是否已有排班数据（决定显示空状态还是表格） */
export function selectHasSchedule(state: AppState, month: string): boolean {
  const monthSchedule = state.schedules[month];
  return monthSchedule !== undefined && Object.keys(monthSchedule).length > 0;
}

/** 有数据的月份列表（升序），供月份选择器打圆点。⚠️ 返回新数组 */
export function selectMonthsWithData(schedules: SchedulesByMonth): string[] {
  return Object.keys(schedules)
    .filter((month) => Object.keys(schedules[month]).length > 0)
    .sort();
}

/** 某月锁定格数量，供「重新生成」确认弹窗选文案 */
export function selectLockedCount(state: AppState, month: string): number {
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

// ============ 医生 ============

/** doctorId -> Doctor 索引。⚠️ 返回新对象，请 `useMemo(() => …, [state.doctors])` */
export function selectDoctorMap(doctorList: readonly Doctor[]): Record<string, Doctor> {
  const map: Record<string, Doctor> = {};
  for (const doctor of doctorList) {
    map[doctor.id] = doctor;
  }
  return map;
}

export function selectDoctorById(state: AppState, id: string | null): Doctor | null {
  if (id === null) {
    return null;
  }
  return state.doctors.find((d) => d.id === id) ?? null;
}

/**
 * 按搜索词过滤医生。
 * 搜索词为空时**原样返回入参引用**——这是最常见的情况，不该每次渲染都造新数组。
 */
export function selectVisibleDoctors(
  doctorList: readonly Doctor[],
  search: string,
): readonly Doctor[] {
  const keyword = search.trim().toLowerCase();
  if (keyword === '') {
    return doctorList;
  }
  return doctorList.filter(
    (d) => d.name.toLowerCase().includes(keyword) || d.title.toLowerCase().includes(keyword),
  );
}

/** 正在抽屉里编辑的医生；`editingDoctorId` 为 null 表示新增 */
export function selectEditingDoctor(state: AppState): Doctor | null {
  return selectDoctorById(state, state.ui.editingDoctorId);
}

/** 一位医生都没有：生成按钮要禁用，空状态要引导先加人 */
export function selectHasNoDoctor(state: AppState): boolean {
  return state.doctors.length === 0;
}

/** 某医生在某月是否有请假记录（左栏名册打请假标） */
export function selectHasLeaveInMonth(doctor: Doctor, month: string): boolean {
  const leaves = doctor.leaves ?? [];
  return leaves.some((leave) => leave.start.slice(0, 7) <= month && leave.end.slice(0, 7) >= month);
}

// ============ 轮班（P2-1）============

/** 轮班弹窗预选的医生（来自 ui.shiftCycleDoctorId），无则 null */
export function selectShiftCycleDoctor(state: AppState): Doctor | null {
  return selectDoctorById(state, state.ui.shiftCycleDoctorId);
}

/**
 * 轮班规划所需的「目标」数据束：预选医生 + 全量排班表。
 * 弹窗用它在 useMemo 里实时重算 plan，与 reducer 写入同口径。
 */
export function selectShiftCycleTargets(state: AppState): {
  doctor: Doctor | null;
  schedules: SchedulesByMonth;
} {
  return {
    doctor: selectShiftCycleDoctor(state),
    schedules: state.schedules,
  };
}

// ============ 派生数据入参 ============

/**
 * 组装 `computeDerived()` 的入参。
 * ⚠️ 返回新对象，仅供 `useMemo` 内部即时调用，不要直接进依赖数组。
 */
export function selectDerivedParams(state: AppState): DerivedParams {
  const month = state.ui.currentMonth;
  return {
    month,
    schedule: selectMonthSchedule(state, month),
    doctors: state.doctors,
    rules: state.rules,
    customShifts: state.customShifts,
  };
}

// ============ 历史 ============

export function selectCanUndo(state: AppState): boolean {
  return canUndo(state.history);
}

export function selectCanRedo(state: AppState): boolean {
  return canRedo(state.history);
}

/** 撤销按钮 tooltip：「撤销 · 修改 张伟 8/12 班次」 */
export function selectUndoTooltip(state: AppState, prefix: string): string {
  const label = undoLabel(state.history);
  return label === null ? prefix : `${prefix} · ${label}`;
}

export function selectRedoTooltip(state: AppState, prefix: string): string {
  const label = redoLabel(state.history);
  return label === null ? prefix : `${prefix} · ${label}`;
}

// ============ 保存状态 ============

export function selectIsSaving(state: AppState): boolean {
  return state.ui.saveStatus === 'saving';
}

export function selectSaveFailed(state: AppState): boolean {
  return state.ui.saveStatus === 'error';
}
