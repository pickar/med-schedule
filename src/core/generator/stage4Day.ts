/**
 * 阶段 4：白班 / 病房填充。
 *
 * ⚠️ 三轮的**顺序不可调换**，这是「人数不足时取下限」这条竞品承诺的实现方式：
 *   第一轮：全月每天先填到 min（保底）
 *   第二轮：全月每天再填到 max（增益）
 *   第三轮：剩余未占位者排 ward（兜底，不受人数区间约束）
 *
 * 如果偷懒写成「逐天一次填到 max」，前几天会把人吃光，后几天连 min 都凑不齐。
 * **保底优先于增益，是公平分配的通用原则。**
 */

import { addBelowMinDiagnostic, assign, countShiftOnDay, rangeOf } from './context';
import { eligibleCandidates } from './eligibility';
import type { DayInfo, GenContext } from './types';
import { pickFairest, sortByFairness } from './workload';

export const STAGE4_NAME = 'stage4Day';

export interface Stage4Result {
  minRoundPlaced: number;
  maxRoundPlaced: number;
  wardPlaced: number;
}

export function runStage4Day(ctx: GenContext): Stage4Result {
  const minRoundPlaced = fillToTarget(ctx, 'min');
  const maxRoundPlaced = fillToTarget(ctx, 'max');
  const wardPlaced = fillWard(ctx);
  return { minRoundPlaced, maxRoundPlaced, wardPlaced };
}

/**
 * 按目标边界填充白班。
 *
 * @param bound 'min' 为保底轮（填不满要记诊断），'max' 为增益轮（填不满属正常降级，不记诊断）
 */
function fillToTarget(ctx: GenContext, bound: 'min' | 'max'): number {
  let placed = 0;

  for (const day of ctx.days) {
    const range = rangeOf(ctx.rules, day.weekday, 'dayShift');
    const target = bound === 'min' ? range.min : range.max;
    if (target <= 0) {
      continue;
    }

    let current = countShiftOnDay(ctx, day.date, 'dayShift');
    while (current < target) {
      const chosen = pickDayCandidate(ctx, day);
      if (!chosen) {
        break;
      }
      if (!assign(ctx, day.date, chosen, 'dayShift', { isRotation: false })) {
        break;
      }
      current += 1;
      placed += 1;
    }

    // 只有保底轮才报诊断：增益轮填不满是设计内的降级，不是问题
    if (bound === 'min' && current < range.min) {
      addBelowMinDiagnostic(ctx, STAGE4_NAME, day.date, 'dayShift', current, range.min);
    }
  }

  return placed;
}

/** 取当天白班的最优候选 */
function pickDayCandidate(ctx: GenContext, day: DayInfo): string | null {
  const candidates = eligibleCandidates(ctx, day, 'dayShift');
  return pickFairest(candidates, ctx.scores, 'day', day.date);
}

/**
 * 第三轮：把仍未占位的医生排 `ward`，避免表格大片空白。
 *
 * 病房不受人数区间约束（PRD Q3：仅白班/夜班配区间）。
 * 上限用「应工作天数」控制：当月天数 - 应休天数。超过这个数就不再加班房，
 * 把空位留给阶段 5 填 `rest`，否则休息永远补不齐。
 */
function fillWard(ctx: GenContext): number {
  const workQuota = Math.max(0, ctx.days.length - ctx.rules.restDaysPerMonth);
  let placed = 0;

  for (const day of ctx.days) {
    // 按 day 维度公平排序后逐个落位；每次都重新查 workCount，
    // 因为本轮内的落位会实时改变配额剩余量
    const ordered = sortByFairness(eligibleCandidates(ctx, day, 'ward'), ctx.scores, 'day', day.date);
    for (const doctorId of ordered) {
      const score = ctx.scores.get(doctorId);
      if (!score || score.workCount >= workQuota) {
        continue;
      }
      if (assign(ctx, day.date, doctorId, 'ward', { isRotation: false })) {
        placed += 1;
      }
    }
  }

  return placed;
}
