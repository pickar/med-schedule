/**
 * 阶段 0：构建 GenContext。
 *
 * 本文件同时提供**唯一的写入通道** `assign()` / `unassign()`。
 * 三份状态（assigned / occupied / scores）必须同步更新，
 * 任何绕过这两个函数的直接改写都会导致状态撕裂。
 */

import type { Diagnostic, Doctor, MonthSchedule, Rules, ScheduleEntry, ShiftDefinition, ShiftId } from '../../types/domain';
import { getShiftLabel, isWorkShiftId } from '../../constants/shifts';
import { expandDateRange, getDaysInMonth, getWeekday, listMonthDates, monthOfDate } from '../../lib/date';
import type { DayInfo, GenContext, WorkloadScore } from './types';
import { coordKey } from './types';
import { applyShiftToScore, createScore } from './workload';

export interface BuildContextParams {
  month: string;
  doctors: Doctor[];
  rules: Rules;
  /** 当前统一班次列表（内置 + 自定义），用于白名单与 isWork 判定 */
  shifts: ShiftDefinition[];
  existingSchedule?: MonthSchedule;
}

/** 构建当月每一天的静态信息 */
export function buildDays(month: string): DayInfo[] {
  const total = getDaysInMonth(month);
  return listMonthDates(month).map((date, index) => {
    const weekday = getWeekday(date);
    return {
      date,
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
      dayOfMonth: index + 1,
      isLastDay: index + 1 === total,
    };
  });
}

/**
 * 构建生成上下文。
 *
 * 关键点：**锁定格的工作量必须预先计入 scores**。
 * 否则「锁了 10 天夜班」的医生在计分器眼里仍是 nightCount=0，
 * 会被 pickFairest 判为「最闲」而反复加排夜班——这是最隐蔽的公平性 bug。
 */
export function buildContext(params: BuildContextParams): GenContext {
  const { month, doctors, rules, shifts, existingSchedule } = params;

  const days = buildDays(month);
  const doctorMap = new Map<string, Doctor>();
  const scores = new Map<string, WorkloadScore>();
  for (const doctor of doctors) {
    doctorMap.set(doctor.id, doctor);
    scores.set(doctor.id, createScore(doctor.id));
  }

  const assigned = new Map<string, Map<string, ScheduleEntry>>();
  const occupied = new Map<string, Set<string>>();
  for (const day of days) {
    assigned.set(day.date, new Map<string, ScheduleEntry>());
    occupied.set(day.date, new Set<string>());
  }

  const ctx: GenContext = {
    month,
    days,
    doctors,
    rules,
    doctorMap,
    assigned,
    occupied,
    lockedSet: new Set<string>(),
    leaveSet: new Set<string>(),
    leaveNotes: new Map<string, string>(),
    scores,
    diagnostics: [],
    shifts,
    validShiftIds: new Set(shifts.map((s) => s.id)),
  };

  collectLeaves(ctx, doctors, month);
  restoreLockedCells(ctx, existingSchedule);

  return ctx;
}

/** 把医生的请假区间展开成逐日集合，只保留落在本月的部分 */
function collectLeaves(ctx: GenContext, doctors: Doctor[], month: string): void {
  for (const doctor of doctors) {
    for (const leave of doctor.leaves ?? []) {
      for (const date of expandDateRange(leave.start, leave.end)) {
        if (monthOfDate(date) !== month) {
          continue;
        }
        const key = coordKey(date, doctor.id);
        ctx.leaveSet.add(key);
        if (leave.note) {
          ctx.leaveNotes.set(key, leave.note);
        }
      }
    }
  }
}

/**
 * 从已有排班中提取锁定格，预填进结果容器并预先计分。
 * 非锁定格一律丢弃（重新生成的语义就是「除锁定外全部重来」）。
 *
 * 这里是**外部脏数据进入生成器的唯一入口**，四道清洗缺一不可：
 * 跨月/非法日期（靠 `ctx.days` 遍历天然过滤）、孤儿医生（`doctorMap.has`）、
 * 空条目、以及**班次白名单**（`validShiftIds`）。
 *
 * QA-BUG-03：白名单原先缺失，一个 `locked: true` 且 `shiftType: 'wtf-shift'`
 * 的格子会原样进入生成结果，进而污染统计与渲染。非法班次视同该格不存在——
 * 不做「降级为休息」，因为凭空造一个用户没排过的休息，比丢掉一个本就无意义的
 * 脏格子更容易误导人。被用户从管理器中删除的班次同样视为非法、丢弃。
 */
function restoreLockedCells(ctx: GenContext, existingSchedule?: MonthSchedule): void {
  if (!existingSchedule) {
    return;
  }
  for (const day of ctx.days) {
    const daySchedule = existingSchedule[day.date];
    if (!daySchedule) {
      continue;
    }
    for (const entry of Object.values(daySchedule)) {
      if (!entry || entry.locked !== true || !ctx.doctorMap.has(entry.doctorId)) {
        continue;
      }
      if (!ctx.validShiftIds.has(entry.shiftType)) {
        continue;
      }
      ctx.lockedSet.add(coordKey(day.date, entry.doctorId));
      writeEntry(ctx, day.date, { ...entry, locked: true });
    }
  }
}

/** 内部写入：同步 assigned / occupied / scores 三份状态 */
function writeEntry(ctx: GenContext, date: string, entry: ScheduleEntry): void {
  ctx.assigned.get(date)?.set(entry.doctorId, entry);
  ctx.occupied.get(date)?.add(entry.doctorId);
  const score = ctx.scores.get(entry.doctorId);
  if (score) {
    applyShiftToScore(score, entry.shiftType, 1, isWorkShiftId(entry.shiftType, ctx.shifts));
  }
}

export interface AssignOptions {
  isRotation?: boolean;
  manual?: boolean;
  /** 覆盖已有安排（阶段 5/6 降级修复用），会先撤销旧班次的计分 */
  replace?: boolean;
}

/**
 * 落位一个班次。**这是唯一允许的写入通道。**
 * @returns 是否写入成功（锁定格、或未开 replace 却已占位时返回 false）
 */
export function assign(
  ctx: GenContext,
  date: string,
  doctorId: string,
  shiftType: ShiftId,
  options: AssignOptions = {},
): boolean {
  if (!ctx.validShiftIds.has(shiftType)) {
    return false;
  }
  if (ctx.lockedSet.has(coordKey(date, doctorId))) {
    return false;
  }
  const dayMap = ctx.assigned.get(date);
  if (!dayMap) {
    return false;
  }
  const existing = dayMap.get(doctorId);
  if (existing) {
    if (!options.replace) {
      return false;
    }
    unassign(ctx, date, doctorId);
  }
  writeEntry(ctx, date, {
    doctorId,
    shiftType,
    isRotation: options.isRotation === true,
    manual: options.manual === true ? true : undefined,
  });
  return true;
}

/**
 * 撤销一个班次。锁定格不可撤销。
 * @returns 被撤销的班次；未撤销时返回 null
 */
export function unassign(ctx: GenContext, date: string, doctorId: string): ShiftId | null {
  if (ctx.lockedSet.has(coordKey(date, doctorId))) {
    return null;
  }
  const dayMap = ctx.assigned.get(date);
  const entry = dayMap?.get(doctorId);
  if (!dayMap || !entry) {
    return null;
  }
  dayMap.delete(doctorId);
  ctx.occupied.get(date)?.delete(doctorId);
  const score = ctx.scores.get(doctorId);
  if (score) {
    applyShiftToScore(score, entry.shiftType, -1, isWorkShiftId(entry.shiftType, ctx.shifts));
  }
  return entry.shiftType;
}

/** 统计某日某班次的实际人数 */
export function countShiftOnDay(ctx: GenContext, date: string, shiftType: ShiftId): number {
  const dayMap = ctx.assigned.get(date);
  if (!dayMap) {
    return 0;
  }
  let count = 0;
  for (const entry of dayMap.values()) {
    if (entry.shiftType === shiftType) {
      count += 1;
    }
  }
  return count;
}

/** 取某 weekday 的人数区间配置，缺失时退回 {min:0,max:0} 而非抛错 */
export function rangeOf(
  rules: Rules,
  weekday: number,
  shift: 'dayShift' | 'nightShift',
): { min: number; max: number } {
  return rules.shiftsByWeekday[weekday]?.[shift] ?? { min: 0, max: 0 };
}

/** 记录一条诊断 */
export function addDiagnostic(ctx: GenContext, diagnostic: Diagnostic): void {
  ctx.diagnostics.push(diagnostic);
}

/** 记录「人数未达下限」诊断，文案统一在此生成 */
export function addBelowMinDiagnostic(
  ctx: GenContext,
  stage: string,
  date: string,
  shiftType: ShiftId,
  actual: number,
  min: number,
): void {
  addDiagnostic(ctx, {
    level: 'high',
    stage,
    message: `${date} ${getShiftLabel(shiftType)}仅安排 ${actual} 人，未达下限 ${min} 人`,
    date,
    shiftType,
  });
}

/** 把上下文的可变结果导出为不可变的 MonthSchedule */
export function toMonthSchedule(ctx: GenContext): MonthSchedule {
  const result: MonthSchedule = {};
  for (const day of ctx.days) {
    const dayMap = ctx.assigned.get(day.date);
    if (!dayMap || dayMap.size === 0) {
      continue;
    }
    const daySchedule: Record<string, ScheduleEntry> = {};
    for (const [doctorId, entry] of dayMap) {
      daySchedule[doctorId] = entry;
    }
    result[day.date] = daySchedule;
  }
  return result;
}
