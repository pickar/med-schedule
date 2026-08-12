/**
 * 生成器内部共享类型。
 *
 * 单独成文件的原因：`context.ts` 与全部 stage 文件互相需要 `GenContext`，
 * 若定义在 `context.ts` 会让 stage → context 形成「类型依赖 + 函数依赖」双向耦合，
 * 把纯类型抽到叶子文件即可让依赖图保持单向（types ← context ← stages ← index）。
 */

import type { Diagnostic, Doctor, MonthSchedule, Rules, ScheduleEntry, ShiftType } from '../../types/domain';

/** 某一天的静态信息，阶段间复用，避免重复解析日期 */
export interface DayInfo {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0 = 周日 … 6 = 周六 */
  weekday: number;
  isWeekend: boolean;
  /** 当月第几天，1-based */
  dayOfMonth: number;
  /** 是否为当月最后一天（夜班跨月边界判定） */
  isLastDay: boolean;
}

/** 工作量计分，全部维度按「已落位班次」实时累加 */
export interface WorkloadScore {
  doctorId: string;
  /** 夜班数 */
  nightCount: number;
  /** 门诊 + 专家门诊 */
  clinicCount: number;
  /** 白班 + 病房 */
  dayCount: number;
  /** 全部工作班次总数 */
  workCount: number;
  /** rest 计数（不含 postNightRest） */
  restCount: number;
  /** postNightRest 计数，仅用于 tooltip 展示 */
  postNightCount: number;
}

/** 公平选人的维度 */
export type FairnessDimension = 'night' | 'clinic' | 'day';

/**
 * 生成上下文：贯穿 6 个阶段的唯一可变状态容器。
 *
 * 约定：**任何阶段都不得直接改 `assigned` / `occupied` / `scores`**，
 * 必须走 `context.ts` 导出的 `assign()` / `unassign()`，
 * 否则三者会失去同步（这是最容易出现、也最难排查的一类 bug）。
 */
export interface GenContext {
  month: string;
  days: DayInfo[];
  doctors: Doctor[];
  rules: Rules;
  /** doctorId -> Doctor，避免各阶段反复 find */
  doctorMap: Map<string, Doctor>;
  /** 结果容器：date -> doctorId -> entry */
  assigned: Map<string, Map<string, ScheduleEntry>>;
  /** 当日已占位医生（锁定格计入） */
  occupied: Map<string, Set<string>>;
  /** 锁定格坐标集合 `${date}|${doctorId}`，任何阶段不得覆盖 */
  lockedSet: Set<string>;
  /** 请假展开 `${date}|${doctorId}` */
  leaveSet: Set<string>;
  /** 请假备注 `${date}|${doctorId}` -> note，供违规文案使用 */
  leaveNotes: Map<string, string>;
  scores: Map<string, WorkloadScore>;
  diagnostics: Diagnostic[];
}

/** `generateSchedule()` 的入参 */
export interface GenerateParams {
  month: string;
  doctors: Doctor[];
  rules: Rules;
  /** 已有排班，仅用于提取锁定格；不传视为全新生成 */
  existingSchedule?: MonthSchedule;
}

/** `generateSchedule()` 的返回值 */
export interface GenerateResult {
  schedule: MonthSchedule;
  diagnostics: Diagnostic[];
  /** 求解耗时（毫秒，保留 2 位小数） */
  elapsedMs: number;
}

/** 可行性判定的失败原因，便于诊断与调试 */
export type IneligibleReason =
  | 'occupied' // 当日已有安排
  | 'locked' // 锁定格
  | 'onLeave' // 请假中
  | 'noDayShift' // 个人约束：不上白班
  | 'noNightShift' // 个人约束：不上夜班
  | 'weekendOff' // 个人约束：周末不上班
  | 'consecutiveNight' // 禁连夜
  | 'nextDayBlocked' // 次日夜下休位置被锁定/占用，夜班无法原子写入
  | 'notAutoAssignable'; // 该班次不参与自动分配

export interface EligibilityResult {
  ok: boolean;
  reason?: IneligibleReason;
}

/** 便捷常量：可行 */
export const ELIGIBLE: EligibilityResult = { ok: true };

/** 构造不可行结果 */
export function ineligible(reason: IneligibleReason): EligibilityResult {
  return { ok: false, reason };
}

/** 坐标 key，`assigned` / `lockedSet` / `leaveSet` 三者共用同一格式 */
export function coordKey(date: string, doctorId: string): string {
  return `${date}|${doctorId}`;
}

/** 判断某班次是否为「阶段 5 可降级为休息」的非关键班次 */
export function isDowngradable(shiftType: ShiftType): boolean {
  return shiftType === 'ward' || shiftType === 'dayShift';
}
