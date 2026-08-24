/**
 * 9 类违规的具体检测函数（DESIGN 5.1）。
 *
 * 每个函数只负责「发现问题并产出 Violation」，不负责排序与索引——
 * 那是 `index.ts` 的职责。这样每类检测都能被单独测试。
 */

import type { Doctor, MonthSchedule, Rules, ShiftDefinition, ShiftId } from '../../types/domain';
import type { Violation, ViolationType } from '../../types/validation';
import { isClinicShift, isWorkShiftId, RANGED_SHIFTS } from '../../constants/shifts';
import { expandDateRange, getWeekday, monthOfDate } from '../../lib/date';
import { defaultConstraints } from '../../lib/dataShape';
import {
  VIOLATION_SEVERITY,
  aboveMaxMessage,
  belowMinMessage,
  CONSECUTIVE_NIGHT_DETAIL,
  consecutiveNightMessage,
  constraintNoDayMessage,
  constraintNoNightMessage,
  constraintWeekendMessage,
  leaveConflictMessage,
  MISSING_POST_REST_DETAIL,
  missingPostRestMessage,
  restShortageMessage,
  WEEKEND_DETAIL,
} from './messages';

/** 检测函数共享的输入 */
export interface CheckInput {
  month: string;
  /** 当月全部日期，升序 */
  dates: string[];
  schedule: MonthSchedule;
  doctors: Doctor[];
  doctorMap: Map<string, Doctor>;
  rules: Rules;
  /** `${date}|${doctorId}` -> 请假备注（无备注时为空串） */
  leaveMap: Map<string, string>;
  /** 自定义班次定义（custom-aware 校验用） */
  customShifts: readonly ShiftDefinition[];
}

/** 构造 Violation，id 格式统一在此生成 */
export function makeViolation(
  type: ViolationType,
  parts: { date?: string; doctorId?: string; shiftType?: ShiftId },
  message: string,
  detail?: string,
): Violation {
  const { date = '', doctorId = '', shiftType } = parts;
  return {
    id: `${type}:${date}:${doctorId}:${shiftType ?? ''}`,
    type,
    severity: VIOLATION_SEVERITY[type],
    message,
    detail,
    date: parts.date,
    doctorId: parts.doctorId,
    shiftType: parts.shiftType,
  };
}

/** 展开全部医生的请假区间为 `${date}|${doctorId}` -> note */
export function buildLeaveMap(doctors: Doctor[], month: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const doctor of doctors ?? []) {
    if (!doctor) {
      continue;
    }
    for (const leave of doctor.leaves ?? []) {
      if (!leave) {
        continue;
      }
      for (const date of expandDateRange(leave.start, leave.end)) {
        if (monthOfDate(date) === month) {
          map.set(`${date}|${doctor.id}`, leave.note ?? '');
        }
      }
    }
  }
  return map;
}

/** 统计某日各班次人数 */
export function countByShift(schedule: MonthSchedule, date: string): Map<ShiftId, number> {
  const counts = new Map<ShiftId, number>();
  const day = schedule?.[date];
  if (!day) {
    return counts;
  }
  for (const entry of Object.values(day)) {
    if (!entry) {
      continue;
    }
    counts.set(entry.shiftType, (counts.get(entry.shiftType) ?? 0) + 1);
  }
  return counts;
}

/**
 * ①② 每日人数区间检测（仅 dayShift / nightShift 配区间）。
 */
export function checkDailyCounts(input: CheckInput): Violation[] {
  const violations: Violation[] = [];
  for (const date of input.dates) {
    const counts = countByShift(input.schedule, date);
    const weekday = getWeekday(date);
    for (const shift of RANGED_SHIFTS) {
      const range = input.rules.shiftsByWeekday?.[weekday]?.[shift];
      if (!range) {
        continue;
      }
      const actual = counts.get(shift) ?? 0;
      if (actual < range.min) {
        violations.push(
          makeViolation('belowMin', { date, shiftType: shift }, belowMinMessage(date, shift, actual, range.min)),
        );
      } else if (actual > range.max) {
        violations.push(
          makeViolation('aboveMax', { date, shiftType: shift }, aboveMaxMessage(date, shift, actual, range.max)),
        );
      }
    }
  }
  return violations;
}

/**
 * ③④ 夜班相关检测：连续夜班 + 夜下休缺失。
 *
 * **月末最后一天的夜班不报 `missingPostRest`**：那个夜下休本该落在下月 1 号，
 * 而下月数据不归本月管，报违规会让用户看到一个他无法修复的红格子。
 * 无法行动的告警就是噪音。生成器已对此记一条 low 级诊断。
 */
export function checkNightRules(input: CheckInput): Violation[] {
  const violations: Violation[] = [];
  const { dates, schedule, doctorMap, rules } = input;

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const nextDate = dates[i + 1];
    const day = schedule?.[date];
    if (!day) {
      continue;
    }

    for (const entry of Object.values(day)) {
      if (!entry || entry.shiftType !== 'nightShift') {
        continue;
      }
      const name = doctorMap.get(entry.doctorId)?.name ?? entry.doctorId;

      // 月末：次日超出本月，两项检测均豁免
      if (!nextDate) {
        continue;
      }
      const nextShift = schedule[nextDate]?.[entry.doctorId]?.shiftType;

      if (rules.rules?.noConsecutiveNightShift && nextShift === 'nightShift') {
        violations.push(
          makeViolation(
            'consecutiveNight',
            { date, doctorId: entry.doctorId, shiftType: 'nightShift' },
            consecutiveNightMessage(name, date, nextDate),
            CONSECUTIVE_NIGHT_DETAIL,
          ),
        );
      }

      if (nextShift !== 'postNightRest') {
        violations.push(
          makeViolation(
            'missingPostRest',
            { date, doctorId: entry.doctorId, shiftType: 'nightShift' },
            missingPostRestMessage(name, date),
            MISSING_POST_REST_DETAIL,
          ),
        );
      }
    }
  }

  return violations;
}

/**
 * ⑤a-d 个人约束检测。
 *
 * **⑤c 的例外**：`weekendOff` 医生在周末排 `clinic`/`expertClinic` **不算违规**。
 * 依据 PRD 与竞品原文「周末不上班（若有固定门诊日则优先门诊）」。
 * 这个例外容易被后人当成 bug"修掉"，改动前请先确认产品口径。
 */
export function checkDoctorConstraints(input: CheckInput): Violation[] {
  const violations: Violation[] = [];

  for (const date of input.dates) {
    const day = input.schedule?.[date];
    if (!day) {
      continue;
    }
    const isWeekend = [0, 6].includes(getWeekday(date));

    for (const entry of Object.values(day)) {
      const doctor = entry ? input.doctorMap.get(entry.doctorId) : undefined;
      if (!entry || !doctor) {
        continue;
      }
      // BUG-01 防御：缺 constraints 的医生视作「无任何个人约束」，不抛错
      const { name } = doctor;
      const constraints = doctor.constraints ?? defaultConstraints();
      const shift = entry.shiftType;
      const coord = { date, doctorId: entry.doctorId, shiftType: shift };

      if (constraints.noDayShift && shift === 'dayShift') {
        violations.push(makeViolation('constraintNoDay', coord, constraintNoDayMessage(name, date)));
      }
      if (constraints.noNightShift && shift === 'nightShift') {
        violations.push(makeViolation('constraintNoNight', coord, constraintNoNightMessage(name, date)));
      }
      if (constraints.weekendOff && isWeekend && isWorkShiftId(shift, input.customShifts) && !isClinicShift(shift)) {
        violations.push(
          makeViolation('constraintWeekend', coord, constraintWeekendMessage(name, date, shift), WEEKEND_DETAIL),
        );
      }

      const leaveKey = `${date}|${entry.doctorId}`;
      if (isWorkShiftId(shift, input.customShifts) && input.leaveMap.has(leaveKey)) {
        const note = input.leaveMap.get(leaveKey);
        violations.push(
          makeViolation('leaveConflict', coord, leaveConflictMessage(name, date, shift, note || undefined)),
        );
      }
    }
  }

  return violations;
}

/**
 * ⑥ 休息天数不足。
 *
 * 「实休」只计 `rest`，**不含** `postNightRest`（PRD Q4 已拍板）。
 * 请假日在生成阶段已置为 `rest`，因此天然计入实休——
 * 对医生而言请假就是休息，不计入会导致实休虚低、误报「休息天数不足」。
 */
export function checkRestShortage(input: CheckInput): Violation[] {
  const violations: Violation[] = [];
  const target = input.rules.restDaysPerMonth ?? 0;
  if (target <= 0) {
    return violations;
  }

  const restCounts = new Map<string, number>();
  for (const doctor of input.doctors) {
    restCounts.set(doctor.id, 0);
  }
  for (const date of input.dates) {
    const day = input.schedule?.[date];
    if (!day) {
      continue;
    }
    for (const entry of Object.values(day)) {
      if (entry?.shiftType === 'rest') {
        restCounts.set(entry.doctorId, (restCounts.get(entry.doctorId) ?? 0) + 1);
      }
    }
  }

  for (const doctor of input.doctors) {
    const actual = restCounts.get(doctor.id) ?? 0;
    if (actual < target) {
      violations.push(
        makeViolation(
          'restShortage',
          { doctorId: doctor.id, shiftType: 'rest' },
          restShortageMessage(doctor.name, actual, target),
        ),
      );
    }
  }

  return violations;
}
