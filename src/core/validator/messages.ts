/**
 * 违规提示文案模板。
 *
 * 全部模板集中在此，理由：违规文案是用户面对冲突时唯一的行动依据，
 * 散落在检测函数里会导致口径不一致（同一类问题两种说法）。
 *
 * 文案格式统一为「主语 + 时间 + 事实 + 差距」，不写建议——
 * 建议属于洞察面板的职责，校验器只陈述事实。
 */

import type { ShiftType } from '../../types/domain';
import type { Severity, ViolationType } from '../../types/validation';
import { getShiftLabel } from '../../constants/shifts';
import { formatMD } from '../../lib/date';

/** 各违规类型的严重度，集中定义避免各检测函数各写各的 */
export const VIOLATION_SEVERITY: Record<ViolationType, Severity> = {
  belowMin: 'high',
  aboveMax: 'medium',
  consecutiveNight: 'high',
  missingPostRest: 'high',
  constraintNoDay: 'high',
  constraintNoNight: 'high',
  constraintWeekend: 'medium',
  leaveConflict: 'medium',
  restShortage: 'medium',
};

/** ① `{M}/{D} {班次} {c}/{min} 人，低于下限` */
export function belowMinMessage(date: string, shiftType: ShiftType, actual: number, min: number): string {
  return `${formatMD(date)} ${getShiftLabel(shiftType)} ${actual}/${min} 人，低于下限`;
}

/** ② `{M}/{D} {班次} {c} 人，超出上限 {max}` */
export function aboveMaxMessage(date: string, shiftType: ShiftType, actual: number, max: number): string {
  return `${formatMD(date)} ${getShiftLabel(shiftType)} ${actual} 人，超出上限 ${max}`;
}

/** ③ `{姓名} {M}/{D}-{M}/{D+1} 连续夜班` */
export function consecutiveNightMessage(name: string, date: string, nextDate: string): string {
  return `${name} ${formatMD(date)}-${formatMD(nextDate)} 连续夜班`;
}

/** ④ `{姓名} {M}/{D} 夜班后未安排夜下休` */
export function missingPostRestMessage(name: string, date: string): string {
  return `${name} ${formatMD(date)} 夜班后未安排夜下休`;
}

/** ⑤a `{姓名} 不上白班，{M}/{D} 排了白班` */
export function constraintNoDayMessage(name: string, date: string): string {
  return `${name} 不上白班，${formatMD(date)} 排了白班`;
}

/** ⑤b `{姓名} 不上夜班，{M}/{D} 排了夜班` */
export function constraintNoNightMessage(name: string, date: string): string {
  return `${name} 不上夜班，${formatMD(date)} 排了夜班`;
}

/** ⑤c `{姓名} 周末不上班，{M}/{D} 排了{班次}` */
export function constraintWeekendMessage(name: string, date: string, shiftType: ShiftType): string {
  return `${name} 周末不上班，${formatMD(date)} 排了${getShiftLabel(shiftType)}`;
}

/** ⑤d `{姓名} {M}/{D} 请假中（{备注}），仍排了{班次}` */
export function leaveConflictMessage(
  name: string,
  date: string,
  shiftType: ShiftType,
  note?: string,
): string {
  const noteText = note ? `（${note}）` : '';
  return `${name} ${formatMD(date)} 请假中${noteText}，仍排了${getShiftLabel(shiftType)}`;
}

/** ⑥ `{姓名}：实休 {N} / 应休 {M}，差 {K} 天` */
export function restShortageMessage(name: string, actual: number, expected: number): string {
  return `${name}：实休 ${actual} / 应休 ${expected}，差 ${expected - actual} 天`;
}

/** 夜下休缺失的补充说明，供 tooltip 使用 */
export const MISSING_POST_REST_DETAIL = '值夜班后第二天应安排夜下休，可点击次日单元格改为「夜下休」';

/** 连续夜班的补充说明 */
export const CONSECUTIVE_NIGHT_DETAIL = '排班规则已开启「禁止连续夜班」，请调整其中一天';

/** 周末违规的补充说明（说明门诊例外，避免用户误以为是 bug） */
export const WEEKEND_DETAIL = '该医生设置了「周末不上班」。门诊类班次不受此限制';
