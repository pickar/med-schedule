/**
 * 阶段 5：休息补齐。
 *
 * ⚠️ 降级铁律：补休息时**绝不能动 `clinic` / `expertClinic` / `nightShift`，
 * 也不能动任何锁定格**。
 *   - 门诊是对患者和医生的双重承诺，撤掉代价远大于少休一天
 *   - 夜班是硬缺口，撤掉会直接制造 belowMin 违规
 * 只允许降级 `ward` 和「超出当日 min 的 dayShift」。
 *
 * `weekendOff` 医生的周末休息不计入 restCount —— 竞品定义「月休天数不含
 * 夜下休和周末固定休息」。这条会让 weekendOff 医生的实休看起来偏低，是符合
 * 预期的：他们的周末休息本来就不占月休配额。
 */

import { assign, countShiftOnDay, rangeOf, unassign } from './context';
import { canAssign, isLocked } from './eligibility';
import type { DayInfo, GenContext } from './types';

export const STAGE5_NAME = 'stage5Rest';

export interface Stage5Result {
  emptyFilled: number;
  downgraded: number;
  shortageCount: number;
}

export function runStage5Rest(ctx: GenContext): Stage5Result {
  const emptyFilled = fillEmptyWithRest(ctx);
  const { downgraded, shortageCount } = closeRestGaps(ctx);
  return { emptyFilled, downgraded, shortageCount };
}

/** 第一步：所有仍未占位的格子直接填 `rest` */
function fillEmptyWithRest(ctx: GenContext): number {
  let filled = 0;
  for (const day of ctx.days) {
    for (const doctor of ctx.doctors) {
      if (!canAssign(ctx, day, doctor.id, 'rest').ok) {
        continue;
      }
      if (assign(ctx, day.date, doctor.id, 'rest', { isRotation: false })) {
        filled += 1;
      }
    }
  }
  return filled;
}

/**
 * 第二步：对仍有缺口的医生，按缺口降序尝试降级非关键班次。
 *
 * 按缺口降序处理，是为了让「差得最多的人」优先拿到有限的降级机会——
 * 若按名册顺序，排在前面的人会把可降级的班次吃光。
 */
function closeRestGaps(ctx: GenContext): { downgraded: number; shortageCount: number } {
  const target = ctx.rules.restDaysPerMonth;
  let downgraded = 0;
  let shortageCount = 0;

  const gaps = ctx.doctors
    .map((doctor) => ({
      doctorId: doctor.id,
      name: doctor.name,
      gap: target - (ctx.scores.get(doctor.id)?.restCount ?? 0),
    }))
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.gap - a.gap || (a.doctorId < b.doctorId ? -1 : 1));

  for (const item of gaps) {
    let remaining = target - (ctx.scores.get(item.doctorId)?.restCount ?? 0);
    for (const day of ctx.days) {
      if (remaining <= 0) {
        break;
      }
      if (tryDowngradeToRest(ctx, day, item.doctorId)) {
        remaining -= 1;
        downgraded += 1;
      }
    }
    if (remaining > 0) {
      shortageCount += 1;
      recordShortage(ctx, item.name, item.doctorId, target - remaining, target);
    }
  }

  return { downgraded, shortageCount };
}

/**
 * 尝试把某医生某日的班次降级为 `rest`。
 * 仅 `ward` 与「超出当日 min 的 dayShift」可降级。
 */
function tryDowngradeToRest(ctx: GenContext, day: DayInfo, doctorId: string): boolean {
  if (isLocked(ctx, day.date, doctorId)) {
    return false;
  }
  const current = ctx.assigned.get(day.date)?.get(doctorId);
  if (!current) {
    return false;
  }

  if (current.shiftType === 'ward') {
    return swapToRest(ctx, day, doctorId);
  }

  if (current.shiftType === 'dayShift') {
    // 只有超出下限的白班才可以撤，撤到 min 就停手
    const range = rangeOf(ctx.rules, day.weekday, 'dayShift');
    if (countShiftOnDay(ctx, day.date, 'dayShift') > range.min) {
      return swapToRest(ctx, day, doctorId);
    }
  }

  // clinic / expertClinic / nightShift / postNightRest / 手动班次一律不动
  return false;
}

/** 撤销原班次并改排 rest；失败时回滚，保证状态一致 */
function swapToRest(ctx: GenContext, day: DayInfo, doctorId: string): boolean {
  const removed = unassign(ctx, day.date, doctorId);
  if (!removed) {
    return false;
  }
  if (assign(ctx, day.date, doctorId, 'rest', { isRotation: false })) {
    return true;
  }
  assign(ctx, day.date, doctorId, removed, { isRotation: false });
  return false;
}

/** 休息仍不足时记录诊断 */
function recordShortage(
  ctx: GenContext,
  name: string,
  doctorId: string,
  actual: number,
  target: number,
): void {
  ctx.diagnostics.push({
    level: 'medium',
    stage: STAGE5_NAME,
    message: `${name} 实休 ${actual} 天，应休 ${target} 天，差 ${target - actual} 天（可降级班次已用尽）`,
    doctorId,
    shiftType: 'rest',
  });
}
