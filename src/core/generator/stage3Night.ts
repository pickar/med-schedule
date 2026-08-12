/**
 * 阶段 3：夜班分配 + 夜下休（最关键阶段）。
 *
 * 为什么必须排在白班之前：夜班一旦落位就锁死次日，回溯代价最高。
 * 自由度最低的先落位，是分阶段贪心不塌方的前提。
 *
 * ⚠️ 原子写入铁律：`nightShift` 与次日 `postNightRest` 必须在同一步完成。
 * 若中间让阶段 4 插进来，次日就会被填成白班，算法自己制造出
 * 「夜班后未安排夜下休」的违规——这是设计文档特别标红的坑。
 */

import { isClinicShift } from '../../constants/shifts';
import { addBelowMinDiagnostic, assign, countShiftOnDay, rangeOf } from './context';
import { eligibleCandidates, getAssignedShift, isLocked } from './eligibility';
import type { DayInfo, GenContext } from './types';
import { pickFairest } from './workload';

export const STAGE3_NAME = 'stage3Night';

/**
 * 按日期正序遍历分配夜班。
 * @returns 落位的夜班数量
 */
export function runStage3Night(ctx: GenContext): number {
  let placed = 0;

  for (const day of ctx.days) {
    const range = rangeOf(ctx.rules, day.weekday, 'nightShift');
    if (range.max <= 0) {
      continue;
    }

    // 锁定格可能已经贡献了夜班人数，从现状起算而不是从 0 起算
    let current = countShiftOnDay(ctx, day.date, 'nightShift');

    while (current < range.max) {
      const candidates = preferClinicSafe(ctx, day, eligibleCandidates(ctx, day, 'nightShift'));
      const chosen = pickFairest(candidates, ctx.scores, 'night', day.date);
      if (!chosen) {
        break;
      }
      if (!assignNightAtomic(ctx, day, chosen)) {
        break;
      }
      current += 1;
      placed += 1;
    }

    if (current < range.min) {
      addBelowMinDiagnostic(ctx, STAGE3_NAME, day.date, 'nightShift', current, range.min);
    }
  }

  return placed;
}

/**
 * **软偏好**（不是约束）：优先选「次日没有固定门诊」的医生。
 *
 * 夜下休优先级高于门诊，落位时会直接覆盖次日门诊。这没有错，但能避开就该避开——
 * 固定门诊是对医生的承诺，白白撕掉一个是净损失。
 *
 * 之所以放在这里而不是 `canAssign()`：它**不是硬约束**。
 * 当所有候选人次日都有门诊时必须退回全集，否则夜班会凭空缺人、
 * 用一个 medium 问题换来一个 high 违规。硬约束区只放「绝不让步」的规则。
 */
function preferClinicSafe(ctx: GenContext, day: DayInfo, candidates: string[]): string[] {
  if (day.isLastDay || candidates.length === 0) {
    return candidates;
  }
  const next = ctx.days[day.dayOfMonth];
  if (!next) {
    return candidates;
  }
  const safe = candidates.filter((id) => !isClinicShift(getAssignedShift(ctx, next.date, id)));
  return safe.length > 0 ? safe : candidates;
}

/**
 * 原子写入：当天夜班 + 次日夜下休。
 *
 * 月末最后一天不跨月写夜下休（产品已拍板），只记一条 low 级诊断——
 * 那个夜下休本该落在下月 1 号，而下月数据不归本月管，
 * 报成违规会让用户看到一个他无法修复的红格子。
 *
 * 导出给阶段 6 复用：修复阶段调人补夜班时若不走这里，
 * 就会补出一个「没有夜下休的夜班」，等于用一个违规换掉另一个违规。
 *
 * @returns 夜班是否写入成功
 */
export function assignNightAtomic(ctx: GenContext, day: DayInfo, doctorId: string): boolean {
  if (!assign(ctx, day.date, doctorId, 'nightShift', { isRotation: false })) {
    return false;
  }

  if (day.isLastDay) {
    recordCrossMonth(ctx, day, doctorId);
    return true;
  }

  const next = ctx.days[day.dayOfMonth];
  if (!next) {
    return true;
  }

  // 次日被锁定：canAssign 已保证锁定内容是休息类，无需也不能覆盖
  if (isLocked(ctx, next.date, doctorId)) {
    return true;
  }

  // replace: true —— 次日此时理论上应为空，但阶段 1/2 的门诊可能已占位。
  // 夜下休是硬约束，优先级高于门诊，直接覆盖并让计分器回滚门诊计数。
  assign(ctx, next.date, doctorId, 'postNightRest', { replace: true });
  return true;
}

/** 月末夜班：不跨月写夜下休，只记 low 级诊断 */
function recordCrossMonth(ctx: GenContext, day: DayInfo, doctorId: string): void {
  const name = ctx.doctorMap.get(doctorId)?.name ?? doctorId;
  ctx.diagnostics.push({
    level: 'low',
    stage: STAGE3_NAME,
    message: `${name} ${day.date} 为月末夜班，次日夜下休属下月，本月不予写入`,
    date: day.date,
    doctorId,
    shiftType: 'nightShift',
  });
}
