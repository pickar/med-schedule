/**
 * 医生域 handler：增删改、颜色分配、级联清理、示例载入、请假增删。
 *
 * **结构共享纪律**：所有函数在「没有实际变化」时必须返回原对象引用。
 * 这不是微优化——`ShiftCell` 靠 `entry` prop 的引用相等被 `React.memo` 跳过，
 * 一旦这里随手 `{...state.schedules}` 就会让 930 个单元格全部重渲染。
 */

import type { Doctor, LeaveRange, SchedulesByMonth } from '../../types/domain';
import type { AppState } from '../../types/state';
import { createSampleDoctors } from '../../constants/defaults';
import { pickDoctorColor } from '../../constants/palette';
import { createId } from '../../lib/id';

/** 新增医生：自动分配未占用的色板色 */
export function addDoctor(
  state: AppState,
  payload: Omit<Doctor, 'id' | 'color'> & { color?: string },
): AppState {
  const doctor: Doctor = {
    ...payload,
    id: createId(),
    color: payload.color ?? pickDoctorColor(state.doctors.map((d) => d.color)),
    leaves: payload.leaves ?? [],
  };
  return { ...state, doctors: [...state.doctors, doctor] };
}

/** 两个医生对象的一级字段是否完全相同（leaves 走引用比较，由 addLeave/removeLeave 保证不可变） */
function isSameDoctor(a: Doctor, b: Doctor): boolean {
  const keys = Object.keys(a) as (keyof Doctor)[];
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every((key) => Object.is(a[key], b[key]));
}

/** 更新医生：仅替换目标条目，其余保持原引用 */
export function updateDoctor(state: AppState, doctor: Doctor): AppState {
  const index = state.doctors.findIndex((d) => d.id === doctor.id);
  if (index < 0) {
    return state;
  }
  const next: Doctor = { ...doctor, leaves: doctor.leaves ?? [] };
  // 内容没变就还回原 state：否则「点进抽屉又原样关掉」会压进一条撤销不了任何东西的历史
  if (isSameDoctor(state.doctors[index], next)) {
    return state;
  }
  const doctors = [...state.doctors];
  doctors[index] = next;
  return { ...state, doctors };
}

/** 删除医生，并级联清除其在**所有月份**的排班（不变量：不留孤儿条目） */
export function removeDoctor(state: AppState, id: string): AppState {
  if (!state.doctors.some((d) => d.id === id)) {
    return state;
  }
  return {
    ...state,
    doctors: state.doctors.filter((d) => d.id !== id),
    schedules: purgeDoctorFromSchedules(state.schedules, id),
  };
}

/**
 * 从全部月份排班中摘除某医生。
 * 逐层判断「是否真的含有该医生」，没有就原样复用引用——
 * 删一个人不该让其他 11 个月的排班对象全部换新。
 */
export function purgeDoctorFromSchedules(
  schedules: SchedulesByMonth,
  doctorId: string,
): SchedulesByMonth {
  let monthsChanged = false;
  const next: SchedulesByMonth = {};

  for (const [month, monthSchedule] of Object.entries(schedules)) {
    let daysChanged = false;
    const nextMonth: typeof monthSchedule = {};

    for (const [date, day] of Object.entries(monthSchedule)) {
      if (!(doctorId in day)) {
        nextMonth[date] = day;
        continue;
      }
      daysChanged = true;
      const { [doctorId]: _removed, ...rest } = day;
      // 该日仅剩空对象时整天删掉，避免留下空壳 key
      if (Object.keys(rest).length > 0) {
        nextMonth[date] = rest;
      }
    }

    if (!daysChanged) {
      next[month] = monthSchedule;
      continue;
    }
    monthsChanged = true;
    if (Object.keys(nextMonth).length > 0) {
      next[month] = nextMonth;
    }
  }

  return monthsChanged ? next : schedules;
}

/**
 * 载入示例医生。
 *
 * 两个要点：
 * 1. 必须走 `createSampleDoctors(createId)` 工厂，**不能**用 `SAMPLE_DOCTORS` 常量——
 *    常量是共享引用，放进 state 后编辑一位医生会串改模板，进而污染后续所有载入。
 * 2. 按姓名去重后**追加**而非覆盖：已经录了一半名册的用户点这个按钮，
 *    是想补齐剩下的，不是想被清空重来。
 */
export function loadSampleDoctors(state: AppState): AppState {
  const existingNames = new Set(state.doctors.map((d) => d.name));
  const used = state.doctors.map((d) => d.color);
  const incoming: Doctor[] = [];

  for (const sample of createSampleDoctors(createId)) {
    if (existingNames.has(sample.name)) {
      continue;
    }
    existingNames.add(sample.name);
    // 逐个分配颜色：已占用集合要随分配实时增长，否则新增的几位会撞色
    const color = pickDoctorColor([...used, ...incoming.map((d) => d.color)]);
    incoming.push({ ...sample, color });
  }

  if (incoming.length === 0) {
    return state;
  }
  return { ...state, doctors: [...state.doctors, ...incoming] };
}

/** 添加请假区间 */
export function addLeave(
  state: AppState,
  doctorId: string,
  leave: Omit<LeaveRange, 'id'>,
): AppState {
  const index = state.doctors.findIndex((d) => d.id === doctorId);
  if (index < 0) {
    return state;
  }
  // 容错：起止倒挂时自动交换，而不是拒绝写入
  const start = leave.start <= leave.end ? leave.start : leave.end;
  const end = leave.start <= leave.end ? leave.end : leave.start;

  const doctors = [...state.doctors];
  const target = doctors[index];
  doctors[index] = {
    ...target,
    leaves: [...(target.leaves ?? []), { ...leave, start, end, id: createId() }],
  };
  return { ...state, doctors };
}

/** 删除请假区间 */
export function removeLeave(state: AppState, doctorId: string, leaveId: string): AppState {
  const index = state.doctors.findIndex((d) => d.id === doctorId);
  if (index < 0) {
    return state;
  }
  const target = state.doctors[index];
  const leaves = target.leaves ?? [];
  if (!leaves.some((l) => l.id === leaveId)) {
    return state;
  }
  const doctors = [...state.doctors];
  doctors[index] = { ...target, leaves: leaves.filter((l) => l.id !== leaveId) };
  return { ...state, doctors };
}
