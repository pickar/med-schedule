/**
 * 阶段 6：违规局部修复。
 *
 * 只处理**可安全修复**的两类，最多迭代 3 轮（防止震荡）：
 *   - `missingPostRest`：夜班次日改为 postNightRest
 *   - `belowMin`：从当日 ward / 超额白班中调人补位
 *
 * 为什么不修全部违规：`constraintNoDay` 这类只可能来自锁定格或手动改班，
 * 是**用户的明确意图**，算法擅自改动会让用户的锁定形同虚设。
 * 校验器把它们透明暴露给用户处理，才是正确的产品行为。
 */

import type { ShiftType } from '../../types/domain';
import { MAX_REPAIR_ROUNDS } from '../../constants/defaults';
import { getShiftLabel } from '../../constants/shifts';
import { assign, countShiftOnDay, rangeOf, toMonthSchedule, unassign } from './context';
import { canAssign, isLocked } from './eligibility';
import { assignNightAtomic } from './stage3Night';
import type { DayInfo, GenContext } from './types';
import { validateMonth } from '../validator';
import { pickFairest } from './workload';

export const STAGE6_NAME = 'stage6Repair';

export interface Stage6Result {
  rounds: number;
  postRestFixed: number;
  belowMinFixed: number;
}

/** 迭代修复，直到一轮无改动或达 3 轮上限 */
export function runStage6Repair(ctx: GenContext): Stage6Result {
  let rounds = 0;
  let postRestFixed = 0;
  let belowMinFixed = 0;

  while (rounds < MAX_REPAIR_ROUNDS) {
    rounds += 1;
    const result = validateMonth({
      month: ctx.month,
      schedule: toMonthSchedule(ctx),
      doctors: ctx.doctors,
      rules: ctx.rules,
    });

    const fixedPostRest = repairMissingPostRest(ctx, result.violations);
    const fixedBelowMin = repairBelowMin(ctx, result.violations);
    postRestFixed += fixedPostRest;
    belowMinFixed += fixedBelowMin;

    if (fixedPostRest === 0 && fixedBelowMin === 0) {
      return { rounds, postRestFixed, belowMinFixed };
    }
  }

  // 走到这里说明第 3 轮仍在改动 —— 修复没有收敛。
  // 必须留痕：静默停手会让用户看到一个「算法说它修完了、但表里还有红格」的排班。
  ctx.diagnostics.push({
    level: 'medium',
    stage: STAGE6_NAME,
    message: `局部修复已达 ${MAX_REPAIR_ROUNDS} 轮上限仍未收敛，可能仍有残留问题，请在洞察面板逐条确认`,
  });

  return { rounds, postRestFixed, belowMinFixed };
}

/** 夜班次日若为非休息班次且未锁定，直接改为 postNightRest */
function repairMissingPostRest(
  ctx: GenContext,
  violations: readonly { type: string; date?: string; doctorId?: string }[],
): number {
  let fixed = 0;

  for (const violation of violations) {
    if (violation.type !== 'missingPostRest' || !violation.date || !violation.doctorId) {
      continue;
    }
    const dayIndex = ctx.days.findIndex((d) => d.date === violation.date);
    const next = dayIndex >= 0 ? ctx.days[dayIndex + 1] : undefined;
    if (!next) {
      continue;
    }
    if (isLocked(ctx, next.date, violation.doctorId)) {
      continue;
    }
    if (assign(ctx, next.date, violation.doctorId, 'postNightRest', { replace: true })) {
      fixed += 1;
    }
  }

  return fixed;
}

/** 人数不足时，从当日可挪用的班次中调人补位 */
function repairBelowMin(
  ctx: GenContext,
  violations: readonly { type: string; date?: string; shiftType?: ShiftType }[],
): number {
  let fixed = 0;

  for (const violation of violations) {
    if (violation.type !== 'belowMin' || !violation.date || !violation.shiftType) {
      continue;
    }
    const shift = violation.shiftType;
    if (shift !== 'dayShift' && shift !== 'nightShift') {
      continue;
    }
    const day = ctx.days.find((d) => d.date === violation.date);
    if (!day) {
      continue;
    }
    const range = rangeOf(ctx.rules, day.weekday, shift);
    let current = countShiftOnDay(ctx, day.date, shift);

    while (current < range.min) {
      if (!borrowOne(ctx, day, shift)) {
        break;
      }
      current += 1;
      fixed += 1;
    }
  }

  return fixed;
}

/**
 * 从当日「可让出的医生」中调一人补到目标班次。
 *
 * 可让出的来源按代价从低到高：
 *   1. 排了 `ward` 的（病房无人数约束，让出代价最低）
 *   2. 排了 `rest` 的（少休一天，代价次之）
 *   3. 超出 min 的 `dayShift`（仅当补的是夜班时；白班让给夜班）
 *
 * 绝不动 clinic / expertClinic / nightShift / postNightRest / 锁定格。
 */
function borrowOne(ctx: GenContext, day: DayInfo, target: 'dayShift' | 'nightShift'): boolean {
  const sources: ShiftType[] = target === 'nightShift' ? ['ward', 'rest', 'dayShift'] : ['ward', 'rest'];

  for (const source of sources) {
    const candidates = collectBorrowable(ctx, day, source, target);
    const chosen = pickFairest(candidates, ctx.scores, target === 'nightShift' ? 'night' : 'day', day.date);
    if (!chosen) {
      continue;
    }
    const removed = unassign(ctx, day.date, chosen);
    if (!removed) {
      continue;
    }
    // 补夜班必须走原子写入，连同次日夜下休一起落位
    const placed =
      target === 'nightShift'
        ? assignNightAtomic(ctx, day, chosen)
        : assign(ctx, day.date, chosen, target, { isRotation: false });
    if (placed) {
      recordBorrow(ctx, day.date, chosen, removed, target);
      return true;
    }
    // 补位失败则回滚，绝不留下空洞
    assign(ctx, day.date, chosen, removed, { isRotation: false });
  }

  return false;
}

/** 收集当日可从 source 班次让出、且能合法排到 target 的医生 */
function collectBorrowable(
  ctx: GenContext,
  day: DayInfo,
  source: ShiftType,
  target: 'dayShift' | 'nightShift',
): string[] {
  const dayMap = ctx.assigned.get(day.date);
  if (!dayMap) {
    return [];
  }

  // 从 dayShift 借人时，必须保证借完后白班仍不低于其下限
  if (source === 'dayShift') {
    const dayRange = rangeOf(ctx.rules, day.weekday, 'dayShift');
    if (countShiftOnDay(ctx, day.date, 'dayShift') <= dayRange.min) {
      return [];
    }
  }

  const result: string[] = [];
  for (const [doctorId, entry] of dayMap) {
    if (entry.shiftType !== source || isLocked(ctx, day.date, doctorId)) {
      continue;
    }
    // allowOccupied: true —— 该医生当日确实已占位，我们要做的正是替换
    if (canAssign(ctx, day, doctorId, target, true).ok) {
      result.push(doctorId);
    }
  }
  return result;
}

/** 记录调班诊断，让用户知道算法做了什么补救 */
function recordBorrow(
  ctx: GenContext,
  date: string,
  doctorId: string,
  from: ShiftType,
  to: ShiftType,
): void {
  const name = ctx.doctorMap.get(doctorId)?.name ?? doctorId;
  ctx.diagnostics.push({
    level: 'low',
    stage: STAGE6_NAME,
    message: `${date} 为补足人数下限，将 ${name} 由${getShiftLabel(from)}调整为${getShiftLabel(to)}`,
    date,
    doctorId,
    shiftType: to,
  });
}
