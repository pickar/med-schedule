/**
 * 轮班（形态 A：班次序列循环·按医生）的领域类型。
 *
 * 只描述「一份轮班计划长什么样」与「单日判定结果」，不碰 React / Context。
 * 纯函数 `planShiftCycle` / `collectWrites` 另见 `plan.ts`。
 */

import type { LeaveRange, SchedulesByMonth, ShiftType } from '../../types/domain';

/** 班次序列：可重复、顺序即轮转顺序（日历日按 i % L 消费序列位） */
export type ShiftSequence = readonly ShiftType[];

/** 轮班弹窗的草稿状态（托管在容器组件的 useState 中） */
export interface ShiftCycleDraft {
  /** 目标医生 id；null 表示尚未选择 */
  doctorId: string | null;
  /** 班次序列，如 [白班, 夜班, 休息] */
  sequence: ShiftType[];
  /** 开始日期 'YYYY-MM-DD'，'' 表示未选 */
  startDate: string;
  /** 结束日期 'YYYY-MM-DD'，'' 表示未选 */
  endDate: string;
  /** 是否覆盖已有非锁定班次；默认 false：遇已有班次跳过 */
  overwrite: boolean;
}

/** planShiftCycle 的完整输入（reducer 会从 state 自取 leaves/schedules 后重算） */
export interface ShiftCycleInput {
  doctorId: string;
  sequence: ShiftSequence;
  startDate: string;
  endDate: string;
  overwrite: boolean;
  leaves: readonly LeaveRange[];
  schedules: SchedulesByMonth;
}

/** 单日写入判定结果，优先级固定为 locked > leave > 空格 > overwrite开关 > skipOccupied */
export type DayAction = 'write' | 'overwrite' | 'skipLocked' | 'skipLeave' | 'skipOccupied';

export interface DayOutcome {
  /** 'YYYY-MM-DD' */
  date: string;
  shiftType: ShiftType;
  /** 该日在序列中的下标（i % L），用于预览回溯 */
  seqIndex: number;
  action: DayAction;
  /** 原班次（仅当该日已有排班时存在） */
  previous?: ShiftType;
}

export type ShiftCycleError =
  | 'noDoctor'
  | 'emptySequence'
  | 'invalidDate'
  | 'endBeforeStart'
  | 'rangeTooLong';

export interface ShiftCycleSummary {
  total: number;
  write: number;
  overwrite: number;
  skipLocked: number;
  skipLeave: number;
  skipOccupied: number;
  /** 实际会落库的条数 = write + overwrite */
  effective: number;
}

export interface ShiftCyclePlan {
  outcomes: readonly DayOutcome[];
  summary: ShiftCycleSummary;
  error: ShiftCycleError | null;
}

/** 单次轮班允许的最大天数（约一年，含闰年） */
export const MAX_CYCLE_DAYS = 366;
