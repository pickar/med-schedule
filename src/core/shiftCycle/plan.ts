/**
 * 轮班核心纯函数：planShiftCycle（规划）+ collectWrites（挑出真正要落库的条目）。
 *
 * 铁律：
 * - **零 React / 零 Context 依赖**，只 import `lib/date.ts` 与 `types/domain.ts`，
 *   因此既能被 reducer 在 dispatch 时调用，也能被一次性脚本直接跑边界自检。
 * - 日期一律字典序比较、日期区间展开复用 `lib/date.ts`，**禁止 new Date()**。
 * - 预览与实际写入同口径：reducer 调本函数时传的是 state 实时的 leaves/schedules，
 *   所以弹窗里看到的预览，就是最终写进表的样子。
 */

import type { LeaveRange, ShiftType } from '../../types/domain';
import { MAX_CYCLE_DAYS } from './types';
import type {
  DayAction,
  DayOutcome,
  ShiftCycleError,
  ShiftCycleInput,
  ShiftCyclePlan,
  ShiftCycleSummary,
} from './types';
import { expandDateRange, isDateInRange, isValidDateKey, monthOfDate } from '../../lib/date';

/** 空汇总（所有计数归零），供 error 分支与正常分支复用同一个形状 */
function buildEmptySummary(): ShiftCycleSummary {
  return {
    total: 0,
    write: 0,
    overwrite: 0,
    skipLocked: 0,
    skipLeave: 0,
    skipOccupied: 0,
    effective: 0,
  };
}

/** 构造一份「无 outcomes」的计划（错误分支用） */
function buildErrorPlan(error: ShiftCycleError): ShiftCyclePlan {
  return { outcomes: [], summary: buildEmptySummary(), error };
}

/** date 是否落在任意请假区间内（协同请假跳过） */
function isOnLeave(date: string, leaves: readonly LeaveRange[]): boolean {
  for (const leave of leaves) {
    if (isDateInRange(date, leave.start, leave.end)) {
      return true;
    }
  }
  return false;
}

/**
 * 规划一段轮班。
 *
 * 校验顺序（任一命中即短路返回 error 计划，outcomes 为空）：
 *   1. !doctorId          -> noDoctor
 *   2. sequence.length===0 -> emptySequence
 *   3. 日期非法            -> invalidDate
 *   4. endDate<startDate  -> endBeforeStart（字典序）
 *   5. 展开后天数>上限     -> rangeTooLong
 *
 * 主循环：日历日按 `i % L` 消费序列位（跳过的日子照样消耗序列位，保证日历锚定），
 * 逐日判定 write / overwrite / skipLocked / skipLeave / skipOccupied。
 */
export function planShiftCycle(input: ShiftCycleInput): ShiftCyclePlan {
  const { doctorId, sequence, startDate, endDate, overwrite, leaves, schedules } = input;

  if (!doctorId) {
    return buildErrorPlan('noDoctor');
  }
  if (sequence.length === 0) {
    return buildErrorPlan('emptySequence');
  }
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return buildErrorPlan('invalidDate');
  }
  if (endDate < startDate) {
    return buildErrorPlan('endBeforeStart');
  }

  const dates = expandDateRange(startDate, endDate);
  if (dates.length > MAX_CYCLE_DAYS) {
    return buildErrorPlan('rangeTooLong');
  }

  const outcomes: DayOutcome[] = [];
  const summary = buildEmptySummary();
  summary.total = dates.length;

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const seqIndex = i % sequence.length;
    const shiftType: ShiftType = sequence[seqIndex];
    const existing = schedules[monthOfDate(date)]?.[date]?.[doctorId];

    let action: DayAction;
    if (existing?.locked) {
      action = 'skipLocked';
    } else if (isOnLeave(date, leaves)) {
      action = 'skipLeave';
    } else if (!existing) {
      action = 'write';
    } else if (overwrite) {
      action = 'overwrite';
    } else {
      action = 'skipOccupied';
    }

    if (action === 'write') {
      summary.write += 1;
    } else if (action === 'overwrite') {
      summary.overwrite += 1;
    } else if (action === 'skipLocked') {
      summary.skipLocked += 1;
    } else if (action === 'skipLeave') {
      summary.skipLeave += 1;
    } else {
      summary.skipOccupied += 1;
    }

    const outcome: DayOutcome = {
      date,
      shiftType,
      seqIndex,
      action,
      ...(existing ? { previous: existing.shiftType } : {}),
    };
    outcomes.push(outcome);
  }

  summary.effective = summary.write + summary.overwrite;

  return { outcomes, summary, error: null };
}

/** 从计划里挑出真正要落库的条目（write | overwrite） */
export function collectWrites(plan: ShiftCyclePlan): readonly DayOutcome[] {
  return plan.outcomes.filter((outcome) => outcome.action === 'write' || outcome.action === 'overwrite');
}
