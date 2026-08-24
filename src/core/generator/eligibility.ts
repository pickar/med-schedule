/**
 * 硬约束集中判定 —— **全部阶段的唯一入口**。
 *
 * ⚠️ 铁律：任何 stage 文件都不得内联写约束判断（`if (doctor.constraints.noNightShift)`
 * 这种代码只允许出现在本文件）。理由：后期新增约束时，只要漏改一个 stage 就会
 * 产生「算法自造违规」，而这类 bug 在 930 格的表里极难肉眼发现。
 *
 * 约束清单见 DESIGN 4.2 的「硬」类目：
 *   占位 / 锁定 / 请假 / 禁白 / 禁夜 / 周末不上班 / 禁连夜 / 夜班次日可写性 / 非自动班次
 */

import type { Doctor, ShiftId } from '../../types/domain';
import { isAutoAssignable, isClinicShift, isWorkShift } from '../../constants/shifts';
import type { DayInfo, EligibilityResult, GenContext } from './types';
import { ELIGIBLE, coordKey, ineligible } from './types';

/** 医生在某日是否请假 */
export function isOnLeave(ctx: GenContext, date: string, doctorId: string): boolean {
  return ctx.leaveSet.has(coordKey(date, doctorId));
}

/** 某格是否被锁定 */
export function isLocked(ctx: GenContext, date: string, doctorId: string): boolean {
  return ctx.lockedSet.has(coordKey(date, doctorId));
}

/** 医生在某日是否已有安排 */
export function isOccupied(ctx: GenContext, date: string, doctorId: string): boolean {
  return ctx.occupied.get(date)?.has(doctorId) === true;
}

/** 取某医生某日已落位的班次；无安排返回 null */
export function getAssignedShift(ctx: GenContext, date: string, doctorId: string): ShiftId | null {
  return ctx.assigned.get(date)?.get(doctorId)?.shiftType ?? null;
}

/**
 * 核心判定：医生能否在指定日期被排指定班次。
 *
 * @param day 当天信息（需要 weekday / isWeekend / isLastDay）
 * @param allowOccupied 阶段 6 修复时会「替换」已有班次，此时跳过占位检查
 */
export function canAssign(
  ctx: GenContext,
  day: DayInfo,
  doctorId: string,
  shiftType: ShiftId,
  allowOccupied = false,
): EligibilityResult {
  const doctor = ctx.doctorMap.get(doctorId);
  if (!doctor) {
    return ineligible('occupied');
  }

  // 该班次已被用户从管理器中删除，不再分配（否则「删了又回来」），修复阶段亦同
  if (!ctx.validShiftIds.has(shiftType)) {
    return ineligible('unknownShift');
  }

  // ① 锁定格永不可覆盖（优先级高于一切，包括修复阶段）
  if (isLocked(ctx, day.date, doctorId)) {
    return ineligible('locked');
  }

  // ② 已占位
  if (!allowOccupied && isOccupied(ctx, day.date, doctorId)) {
    return ineligible('occupied');
  }

  // ③ 非自动分配班次（急诊/连班/副班/总值班）算法不主动排
  if (!isAutoAssignable(shiftType)) {
    return ineligible('notAutoAssignable');
  }

  // ④ 请假日只能排休息类；工作班次一律否决
  if (isWorkShift(shiftType) && isOnLeave(ctx, day.date, doctorId)) {
    return ineligible('onLeave');
  }

  // ⑤ 个人约束
  const constraintReason = checkDoctorConstraints(doctor, day, shiftType);
  if (constraintReason) {
    return constraintReason;
  }

  // ⑥ 夜班专属：禁连夜 + 次日夜下休可写性
  if (shiftType === 'nightShift') {
    return checkNightShift(ctx, day, doctorId);
  }

  return ELIGIBLE;
}

/**
 * 个人约束判定：禁白 / 禁夜 / 周末不上班。
 *
 * **`weekendOff` 的例外**：周末排门诊类（clinic / expertClinic）**不算违规**。
 * 依据 PRD 与竞品原文「周末不上班（若有固定门诊日则优先门诊）」。
 * 这个例外必须保留，改动前请先确认产品口径。
 */
function checkDoctorConstraints(
  doctor: Doctor,
  day: DayInfo,
  shiftType: ShiftId,
): EligibilityResult | null {
  const { noDayShift, noNightShift, weekendOff } = doctor.constraints;

  if (noDayShift && shiftType === 'dayShift') {
    return ineligible('noDayShift');
  }
  if (noNightShift && shiftType === 'nightShift') {
    return ineligible('noNightShift');
  }
  if (weekendOff && day.isWeekend && isWorkShift(shiftType) && !isClinicShift(shiftType)) {
    return ineligible('weekendOff');
  }
  return null;
}

/**
 * 夜班的两项额外判定：
 * 1. 前一天不能是夜班（`noConsecutiveNightShift` 开启时）
 * 2. 次日的夜下休必须写得进去 —— 若次日已被锁定为非休息班次，
 *    这个夜班就不能排，否则原子写入会破功、直接自造 missingPostRest 违规
 */
function checkNightShift(ctx: GenContext, day: DayInfo, doctorId: string): EligibilityResult {
  if (ctx.rules.rules.noConsecutiveNightShift) {
    const prev = ctx.days[day.dayOfMonth - 2];
    if (prev && getAssignedShift(ctx, prev.date, doctorId) === 'nightShift') {
      return ineligible('consecutiveNight');
    }
  }

  // 月末最后一天：次日属下月，不跨月写夜下休（产品已拍板），因此无需检查
  if (day.isLastDay) {
    return ELIGIBLE;
  }

  const next = ctx.days[day.dayOfMonth];
  if (!next) {
    return ELIGIBLE;
  }
  // 次日被锁定成非休息班次 -> 夜下休写不进去
  if (isLocked(ctx, next.date, doctorId)) {
    const nextShift = getAssignedShift(ctx, next.date, doctorId);
    if (nextShift !== 'postNightRest' && nextShift !== 'rest') {
      return ineligible('nextDayBlocked');
    }
  }
  return ELIGIBLE;
}

/**
 * 批量筛出可排某班次的候选医生。
 * 各阶段统一走这里取候选，保证过滤口径一致。
 */
export function eligibleCandidates(
  ctx: GenContext,
  day: DayInfo,
  shiftType: ShiftId,
  pool?: readonly string[],
): string[] {
  const ids = pool ?? ctx.doctors.map((d) => d.id);
  const result: string[] = [];
  for (const id of ids) {
    if (canAssign(ctx, day, id, shiftType).ok) {
      result.push(id);
    }
  }
  return result;
}
