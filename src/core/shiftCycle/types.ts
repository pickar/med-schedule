/**
 * 轮班（形态 A：班次序列循环·按医生）的领域类型。
 *
 * 只描述「一份轮班计划长什么样」与「单日判定结果」，不碰 React / Context。
 * 纯函数 `planShiftCycle` / `collectWrites` 另见 `plan.ts`。
 */

import type { LeaveRange, SchedulesByMonth, ShiftId } from '../../types/domain';

/** 班次序列：可重复、顺序即轮转顺序（日历日按 i % L 消费序列位） */
export type ShiftSequence = readonly ShiftId[];

/**
 * 「所有医生」哨兵值：医生下拉选中它时表示对名册全体生效。
 * 用不可能与真实 id 冲突的前缀，避免与示例数据/外部导入撞车。
 */
export const ALL_DOCTORS = '__all__';

/**
 * 多位医生同时套用同一条序列时，各自的起始位怎么定：
 * - `stagger` 依次错开：第 k 位医生从序列第 k 位起步，保证同一天各班次都有人
 * - `align` 全部同步：所有人都从序列第 0 位起步，同一天班次完全相同
 */
export type CycleStartMode = 'stagger' | 'align';

/** 轮班弹窗的草稿状态（托管在容器组件的 useState 中） */
export interface ShiftCycleDraft {
  /** 目标医生 id；null 表示尚未选择，`ALL_DOCTORS` 表示名册全体 */
  doctorId: string | null;
  /** 班次序列，如 [白班, 夜班, 休息]，可含自定义班次 id */
  sequence: ShiftId[];
  /** 开始日期 'YYYY-MM-DD'，'' 表示未选 */
  startDate: string;
  /** 结束日期 'YYYY-MM-DD'，'' 表示未选 */
  endDate: string;
  /** 是否覆盖已有非锁定班次；默认 false：遇已有班次跳过 */
  overwrite: boolean;
  /** 多医生起始位策略，默认 'stagger'（仅选中「所有医生」时生效） */
  startMode: CycleStartMode;
  /**
   * 是否套用到「所有日期」：开启后日期区间自动取当月 1 号起算的整年（365 天），
   * 两个日期控件转为只读，避免每次开弹窗都手填一遍。
   */
  allDates: boolean;
}

/** planShiftCycle 的完整输入（reducer 会从 state 自取 leaves/schedules 后重算） */
export interface ShiftCycleInput {
  /** 目标医生 id 列表，由调用方从 draft.doctorId 展开（ALL_DOCTORS → 名册全体） */
  doctorIds: readonly string[];
  sequence: ShiftSequence;
  startDate: string;
  endDate: string;
  overwrite: boolean;
  /** 多医生起始位策略；单医生时该字段不产生差异 */
  startMode: CycleStartMode;
  /** doctorId -> 请假区间，逐医生独立判定（请假是个人属性，不能共用一份） */
  leavesByDoctor: Readonly<Record<string, readonly LeaveRange[]>>;
  schedules: SchedulesByMonth;
}

/** 单日写入判定结果，优先级固定为 locked > leave > 空格 > overwrite开关 > skipOccupied */
export type DayAction = 'write' | 'overwrite' | 'skipLocked' | 'skipLeave' | 'skipOccupied';

export interface DayOutcome {
  /** 归属医生：批量轮班时靠它把条目分发回各自的格子 */
  doctorId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  shiftType: ShiftId;
  /** 该日在序列中的下标（(i + startOffset) % L），用于预览回溯 */
  seqIndex: number;
  action: DayAction;
  /** 原班次（仅当该日已有排班时存在） */
  previous?: ShiftId;
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

/** 单个医生的轮班计划，供预览按人分组展示 */
export interface DoctorCyclePlan {
  doctorId: string;
  /** 该医生的序列起始位（stagger 时为名册序号 % L，align 时恒为 0） */
  startOffset: number;
  outcomes: readonly DayOutcome[];
  summary: ShiftCycleSummary;
}

export interface ShiftCyclePlan {
  /** 按名册顺序排列；单医生时长度为 1 */
  perDoctor: readonly DoctorCyclePlan[];
  /**
   * 扁平视图 = 所有医生的 outcomes 依次串联。
   * 保留它是为了 `collectWrites` 与汇总统计不必再自己摊平一层。
   */
  outcomes: readonly DayOutcome[];
  /** 全体医生的聚合计数（不是单人的） */
  summary: ShiftCycleSummary;
  error: ShiftCycleError | null;
  /** 参与规划的医生数，UI 据此决定预览是否分组 */
  doctorCount: number;
}

/** 单次轮班允许的最大天数（约一年，含闰年） */
export const MAX_CYCLE_DAYS = 366;

/** 「所有日期」一次铺开的天数：整年 365 天，留 1 天余量不触上限 */
export const ALL_DATES_SPAN = 365;
