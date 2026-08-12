/**
 * 11 种班次的元数据表。
 *
 * key / 中文 / 简写严格对齐 `_ref/competitor-analysis.md` 第 3.1 节；
 * 配色取自 DESIGN.md 第 8.1 节，全部组合对比度 >= 4.5:1（P0-4.2）。
 * 不得自行调色、不得改 key 拼写。
 *
 * ⚠️ 色值与 `styles/tokens.css` 的 `--shift-*-bg/fg` 一一对应，**改一处必须改两处**：
 * DOM 渲染走 CSS 变量，PNG 导出（canvas）走这张表，两边不同步会导致「屏幕上和
 * 导出图不是一个颜色」。
 *
 * QA-BUG-04 修正（2026-08-10）：门诊 / 连班 / 副班三色实测对比度分别为
 * 3.78 / 3.46 / 2.58，均未达 WCAG AA 的 4.5:1。只加深**文字色**、保留背景色，
 * 既补齐无障碍又不破坏既有的浅色底视觉体系：
 *   clinic          #558B2F -> #33691E  3.78 -> 6.08
 *   continuousShift #E65100 -> #BF360C  3.46 -> 5.11
 *   deputyShift     #F57F17 -> #84600A  2.58 -> 5.59
 * 三者调整后落在其余 8 种班次的 4.56~10.20 区间内，无一枝独黑。
 */

import type { ShiftMeta, ShiftType } from '../types/domain';

/** 表格 / 图例 / 选择器的统一展示顺序 */
export const SHIFT_ORDER: readonly ShiftType[] = [
  'clinic',
  'expertClinic',
  'emergency',
  'dayShift',
  'nightShift',
  'continuousShift',
  'deputyShift',
  'chiefDuty',
  'ward',
  'rest',
  'postNightRest',
] as const;

export const SHIFT_METAS: Record<ShiftType, ShiftMeta> = {
  clinic: {
    key: 'clinic',
    label: '门诊',
    short: '门',
    bg: '#F1F8E9',
    fg: '#33691E',
    isWork: true,
    autoAssignable: true,
  },
  expertClinic: {
    key: 'expertClinic',
    label: '专家门诊',
    short: '专',
    bg: '#EDE7F6',
    fg: '#4527A0',
    isWork: true,
    autoAssignable: true,
  },
  emergency: {
    key: 'emergency',
    label: '急诊',
    short: '急',
    bg: '#FFEBEE',
    fg: '#C62828',
    isWork: true,
    autoAssignable: false,
  },
  dayShift: {
    key: 'dayShift',
    label: '白班',
    short: '白',
    bg: '#E0F7FA',
    fg: '#00695C',
    isWork: true,
    autoAssignable: true,
  },
  nightShift: {
    key: 'nightShift',
    label: '夜班',
    short: '夜',
    bg: '#EDE7F6',
    fg: '#311B92',
    isWork: true,
    autoAssignable: true,
  },
  continuousShift: {
    key: 'continuousShift',
    label: '连班',
    short: '连',
    bg: '#FFF3E0',
    fg: '#BF360C',
    isWork: true,
    autoAssignable: false,
  },
  deputyShift: {
    key: 'deputyShift',
    label: '副班',
    short: '副',
    bg: '#FFFDE7',
    fg: '#84600A',
    isWork: true,
    autoAssignable: false,
  },
  chiefDuty: {
    key: 'chiefDuty',
    label: '总值班',
    short: '总',
    bg: '#FCE4EC',
    fg: '#AD1457',
    isWork: true,
    autoAssignable: false,
  },
  ward: {
    key: 'ward',
    label: '病房',
    short: '病',
    bg: '#E8F5E9',
    fg: '#2E7D32',
    isWork: true,
    autoAssignable: true,
  },
  rest: {
    key: 'rest',
    label: '休息',
    short: '休',
    bg: '#EFEBE9',
    fg: '#6D4C41',
    isWork: false,
    autoAssignable: true,
  },
  postNightRest: {
    key: 'postNightRest',
    label: '夜下休',
    short: '夜下',
    bg: '#D7CCC8',
    fg: '#4E342E',
    isWork: false,
    autoAssignable: true,
  },
};

/** 底部统计行「收起态」默认展示的三类（竞品原文：门 N / 白 N / 夜 N） */
export const PRIMARY_STAT_SHIFTS: readonly ShiftType[] = ['clinic', 'dayShift', 'nightShift'] as const;

/** 仅这两类配置人数区间（PRD Q3 已拍板） */
export const RANGED_SHIFTS: readonly ('dayShift' | 'nightShift')[] = ['dayShift', 'nightShift'] as const;

/** 门诊类班次：weekendOff 医生在周末排这两类不算违规 */
export const CLINIC_SHIFTS: readonly ShiftType[] = ['clinic', 'expertClinic'] as const;

/** 休息类班次（isWork === false） */
export const REST_SHIFTS: readonly ShiftType[] = ['rest', 'postNightRest'] as const;

/** 算法可主动分配的班次集合 */
export const AUTO_ASSIGNABLE_SHIFTS: readonly ShiftType[] = SHIFT_ORDER.filter(
  (key) => SHIFT_METAS[key].autoAssignable,
);

const SHIFT_TYPE_SET: ReadonlySet<string> = new Set<string>(SHIFT_ORDER);

/** 取班次元数据；未知 key 时降级为「休息」，保证 UI 不崩 */
export function getShiftMeta(key: ShiftType | null | undefined): ShiftMeta {
  if (key && SHIFT_TYPE_SET.has(key)) {
    return SHIFT_METAS[key];
  }
  return SHIFT_METAS.rest;
}

/** 取班次中文全称，未知时返回空串 */
export function getShiftLabel(key: ShiftType | null | undefined): string {
  return key && SHIFT_TYPE_SET.has(key) ? SHIFT_METAS[key].label : '';
}

/** 取班次表格简写，未知时返回空串 */
export function getShiftShort(key: ShiftType | null | undefined): string {
  return key && SHIFT_TYPE_SET.has(key) ? SHIFT_METAS[key].short : '';
}

/** 运行时类型守卫，用于校验 localStorage 反序列化数据 */
export function isShiftType(value: unknown): value is ShiftType {
  return typeof value === 'string' && SHIFT_TYPE_SET.has(value);
}

/** 是否计为工作班次 */
export function isWorkShift(key: ShiftType | null | undefined): boolean {
  return !!key && SHIFT_TYPE_SET.has(key) && SHIFT_METAS[key].isWork;
}

/** 是否为休息类班次（rest / postNightRest） */
export function isRestShift(key: ShiftType | null | undefined): boolean {
  return key === 'rest' || key === 'postNightRest';
}

/** 是否为门诊类班次（clinic / expertClinic） */
export function isClinicShift(key: ShiftType | null | undefined): boolean {
  return key === 'clinic' || key === 'expertClinic';
}

/** 算法是否可主动分配该班次 */
export function isAutoAssignable(key: ShiftType | null | undefined): boolean {
  return !!key && SHIFT_TYPE_SET.has(key) && SHIFT_METAS[key].autoAssignable;
}
