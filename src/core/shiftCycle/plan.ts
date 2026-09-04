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

import type { LeaveRange } from '../../types/domain';
import { MAX_CYCLE_DAYS } from './types';
import type {
  DayAction,
  DayOutcome,
  DoctorCyclePlan,
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
  return { perDoctor: [], outcomes: [], summary: buildEmptySummary(), error, doctorCount: 0 };
}

/** 按动作累加计数，同时打进「全体」与「本人」两份汇总 */
function bump(summary: ShiftCycleSummary, action: DayAction): void {
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
 * 规划一段轮班（支持 1~N 位医生）。
 *
 * 校验顺序（任一命中即短路返回 error 计划，outcomes 为空）：
 *   1. doctorIds 为空          -> noDoctor
 *   2. sequence.length===0     -> emptySequence
 *   3. 日期非法                -> invalidDate
 *   4. endDate<startDate       -> endBeforeStart（字典序）
 *   5. 展开后天数>上限          -> rangeTooLong
 *
 * 双层主循环：外层遍历医生（决定起始位），内层遍历日历日。
 * 日历日按 `(i + startOffset) % L` 消费序列位（跳过的日子照样消耗序列位，保证日历锚定），
 * 逐日判定 write / overwrite / skipLocked / skipLeave / skipOccupied。
 *
 * 起始位：
 *   - `stagger`：第 k 位医生 startOffset = k % L，同一天不同医生落在序列不同位置
 *   - `align`：所有人 startOffset = 0，同一天班次完全相同
 *
 * 请假按医生各自的 leaves 判定——请假是个人属性，批量时绝不能共用一份。
 *
 * ⚠️ 复杂度为 O(医生数 × 天数)，「所有医生 + 整年」会跑出数千条 outcome。
 * 预览组件靠 `perDoctor` 分组折叠来避免一次性渲染这么多 DOM。
 */
export function planShiftCycle(input: ShiftCycleInput): ShiftCyclePlan {
  const {
    doctorIds,
    sequence,
    startDate,
    endDate,
    overwrite,
    startMode,
    leavesByDoctor,
    schedules,
  } = input;

  if (doctorIds.length === 0) {
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

  const length = sequence.length;
  const perDoctor: DoctorCyclePlan[] = [];
  const flat: DayOutcome[] = [];
  const summary = buildEmptySummary();
  // total 计的是「格子数」= 天数 × 人数，批量时 UI 会换成对应的文案
  summary.total = dates.length * doctorIds.length;

  for (let k = 0; k < doctorIds.length; k += 1) {
    const doctorId = doctorIds[k];
    const leaves = leavesByDoctor[doctorId] ?? [];
    const startOffset = startMode === 'stagger' ? k % length : 0;

    const doctorOutcomes: DayOutcome[] = [];
    const doctorSummary = buildEmptySummary();
    doctorSummary.total = dates.length;

    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const seqIndex = (i + startOffset) % length;
      const shiftType = sequence[seqIndex];
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

      bump(summary, action);
      bump(doctorSummary, action);

      const outcome: DayOutcome = {
        doctorId,
        date,
        shiftType,
        seqIndex,
        action,
        ...(existing ? { previous: existing.shiftType } : {}),
      };
      doctorOutcomes.push(outcome);
      flat.push(outcome);
    }

    doctorSummary.effective = doctorSummary.write + doctorSummary.overwrite;
    perDoctor.push({ doctorId, startOffset, outcomes: doctorOutcomes, summary: doctorSummary });
  }

  summary.effective = summary.write + summary.overwrite;

  return {
    perDoctor,
    outcomes: flat,
    summary,
    error: null,
    doctorCount: doctorIds.length,
  };
}

/**
 * 从计划里挑出真正要落库的条目（write | overwrite）。
 *
 * 返回的是扁平视图，每条都自带 `doctorId`，调用方按它分发即可。
 */
export function collectWrites(plan: ShiftCyclePlan): readonly DayOutcome[] {
  return plan.outcomes.filter(
    (outcome) => outcome.action === 'write' || outcome.action === 'overwrite',
  );
}
