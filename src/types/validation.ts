/**
 * 校验相关类型。
 *
 * 9 类违规的检测逻辑见 DESIGN.md 第 5.1 节；
 * 三套索引（byCell / byStatCell / byDoctor）保证 UI 查询恒为 O(1)。
 */

import type { ShiftId } from './domain';

export type ViolationType =
  | 'belowMin' // ① 某日某班次人数 < min
  | 'aboveMax' // ② 某日某班次人数 > max
  | 'consecutiveNight' // ③ 连续夜班
  | 'missingPostRest' // ④ 夜班次日未排夜下休
  | 'constraintNoDay' // ⑤a 违反「不上白班」
  | 'constraintNoNight' // ⑤b 违反「不上夜班」
  | 'constraintWeekend' // ⑤c 违反「周末不上班」
  | 'leaveConflict' // ⑤d 违反请假不可用日（P1-4）
  | 'restShortage'; // ⑥ 休息天数不足

export type Severity = 'high' | 'medium' | 'low';

export interface Violation {
  /** `${type}:${date ?? ''}:${doctorId ?? ''}:${shiftType ?? ''}` */
  id: string;
  type: ViolationType;
  severity: Severity;
  /** 展示文案，如「8/3 白班 1/2 人，低于下限」 */
  message: string;
  /** tooltip 补充说明 */
  detail?: string;
  /** 'YYYY-MM-DD' */
  date?: string;
  doctorId?: string;
  shiftType?: ShiftId;
}

export interface ValidationResult {
  /** 已按 severity 降序 → date 升序 → doctorId 排序 */
  violations: Violation[];
  /** 单元格级索引：`${date}|${doctorId}` -> Violation[] */
  byCell: Record<string, Violation[]>;
  /** 统计格级索引：`${date}|${shiftType}` -> Violation[] */
  byStatCell: Record<string, Violation[]>;
  /** 医生级索引：doctorId -> Violation[] */
  byDoctor: Record<string, Violation[]>;
  total: number;
}

/** 严重度权重，用于列表排序（数值越大越靠前） */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** 空校验结果，供初始化与「无排班」时复用，避免各处重复构造 */
export function emptyValidationResult(): ValidationResult {
  return { violations: [], byCell: {}, byStatCell: {}, byDoctor: {}, total: 0 };
}

/** 单元格索引 key 生成器，读写两侧必须共用同一函数 */
export function cellKey(date: string, doctorId: string): string {
  return `${date}|${doctorId}`;
}

/** 统计格索引 key 生成器 */
export function statCellKey(date: string, shiftType: ShiftId): string {
  return `${date}|${shiftType}`;
}
