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

import type { CSSProperties } from 'react';
import type { ShiftDefinition, ShiftId, ShiftMeta, ShiftType } from '../types/domain';

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
export function getShiftMeta(key: ShiftId | null | undefined): ShiftMeta {
  if (key && SHIFT_TYPE_SET.has(key)) {
    return SHIFT_METAS[key as ShiftType];
  }
  return SHIFT_METAS.rest;
}

/** 取班次中文全称，未知时返回空串 */
export function getShiftLabel(key: ShiftId | null | undefined): string {
  return key && SHIFT_TYPE_SET.has(key) ? SHIFT_METAS[key as ShiftType].label : '';
}

/** 取班次表格简写，未知时返回空串 */
export function getShiftShort(key: ShiftId | null | undefined): string {
  return key && SHIFT_TYPE_SET.has(key) ? SHIFT_METAS[key as ShiftType].short : '';
}

/** 运行时类型守卫，用于校验 localStorage 反序列化数据 */
export function isShiftType(value: unknown): value is ShiftType {
  return typeof value === 'string' && SHIFT_TYPE_SET.has(value);
}

/** 是否计为工作班次 */
export function isWorkShift(key: ShiftId | null | undefined): boolean {
  return !!key && SHIFT_TYPE_SET.has(key) && SHIFT_METAS[key as ShiftType].isWork;
}

/** 是否为休息类班次（rest / postNightRest） */
export function isRestShift(key: ShiftId | null | undefined): boolean {
  return key === 'rest' || key === 'postNightRest';
}

/** 是否为门诊类班次（clinic / expertClinic） */
export function isClinicShift(key: ShiftId | null | undefined): boolean {
  return key === 'clinic' || key === 'expertClinic';
}

/** 算法是否可主动分配该班次 */
export function isAutoAssignable(key: ShiftId | null | undefined): boolean {
  return !!key && SHIFT_TYPE_SET.has(key) && SHIFT_METAS[key as ShiftType].autoAssignable;
}

// ============ 自定义班次：统一解析器（§1.2）============

/**
 * 自定义班次可选色板（12 色，与班次「浅底深字」风格一致）。
 * 供 ShiftDefinitionForm 作为预设色板，另支持原生 color 输入自由取色。
 */
export const SHIFT_PALETTE: readonly string[] = [
  '#FCE4EC', // 粉
  '#F3E5F5', // 紫
  '#E8EAF6', // 靛
  '#E3F2FD', // 蓝
  '#E0F7FA', // 青
  '#E0F2F1', // 蓝绿
  '#E8F5E9', // 绿
  '#F1F8E9', // 黄绿
  '#FFFDE7', // 黄
  '#FFF3E0', // 橙
  '#FBE9E7', // 红
  '#EFEBE9', // 灰
];

/** 把 ShiftDefinition 转成 ShiftMeta（key 用 def.id） */
function defToMeta(def: ShiftDefinition): ShiftMeta {
  return {
    key: def.id,
    label: def.label,
    short: def.short,
    bg: def.bg,
    fg: def.fg,
    isWork: def.isWork,
    autoAssignable: def.autoAssignable,
  };
}

/**
 * 把 11 个内置班次作为 `isBuiltin:true` 条目并入统一列表。
 * 已存在同 id 的条目（内置或早期同名自定义）原样保留，其余追加。
 *
 * ⚠️ 幂等且「一次性」：仅用于初始化 / 迁移 / 清空白名单重灌，绝不在每次读取时调用，
 * 否则用户删除的内置班次会被反复加回（删除将永远不持久）。
 */
export function seedBuiltinShifts(existing: readonly ShiftDefinition[]): ShiftDefinition[] {
  const byId = new Map(existing.map((d) => [d.id, d]));
  const result: ShiftDefinition[] = [];
  for (const key of SHIFT_ORDER) {
    const found = byId.get(key);
    if (found) {
      result.push(found);
      continue;
    }
    const meta = SHIFT_METAS[key];
    result.push({
      id: meta.key,
      label: meta.label,
      short: meta.short,
      bg: meta.bg,
      fg: meta.fg,
      isWork: meta.isWork,
      autoAssignable: meta.autoAssignable,
      isBuiltin: true,
    });
  }
  for (const d of existing) {
    if (!SHIFT_TYPE_SET.has(d.id)) {
      result.push(d);
    }
  }
  return result;
}

/** 该班次 id 是否存在于当前统一列表（用于生成器白名单 / 锁定格还原 / 校验） */
export function isValidShiftId(
  id: ShiftId | null | undefined,
  custom: readonly ShiftDefinition[],
): boolean {
  return !!id && custom.some((d) => d.id === id);
}

/**
 * 按 id 解析班次元数据：统一列表（`custom` 已含内置 + 自定义）优先；
 * 兜底——内置 id 尚未进入统一列表（迁移前的旧数据）按常量解析；未知 → 降级为 rest（UI 不崩）。
 */
export function resolveShiftMeta(
  id: ShiftId | null | undefined,
  custom: readonly ShiftDefinition[],
): ShiftMeta {
  if (id) {
    const def = custom.find((d) => d.id === id);
    if (def) {
      return defToMeta(def);
    }
    if (SHIFT_TYPE_SET.has(id)) {
      return SHIFT_METAS[id as ShiftType];
    }
  }
  return SHIFT_METAS.rest;
}

/**
 * 全部可选班次（用于选择器 / 图例 / 轮班序列编辑器）：
 * 统一列表已包含「内置（isBuiltin:true）+ 自定义」，直接映射即可。
 */
export function allShiftMetas(custom: readonly ShiftDefinition[]): ShiftMeta[] {
  return custom.map((def) => defToMeta(def));
}

/** custom-aware 的 isWork 判定（替换校验器与统计里直接用的 isWorkShift） */
export function isWorkShiftId(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): boolean {
  return resolveShiftMeta(id, custom).isWork;
}

/** custom-aware 的 isRest 判定（rest / postNightRest，或自定义 isWork=false） */
export function isRestShiftId(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): boolean {
  return !resolveShiftMeta(id, custom).isWork;
}

/** custom-aware 简写（替换 getShiftShort，用于 PNG/CSV） */
export function shiftShort(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): string {
  return resolveShiftMeta(id, custom).short;
}

/**
 * 单元格配色样式（统一列表接管全部配色）：
 * 内置班次被编辑后也能即时反映，且屏幕渲染与 PNG 导出（canvas 同样走 resolveShiftMeta）
 * 始终保持同一套颜色，避免「屏幕和导出图不是一个颜色」。
 * 返回 { '--cell-bg': string; '--cell-fg': string }，供 ShiftCell/图例/Picker/移动端复用。
 */
export function shiftCellStyle(meta: ShiftMeta): CSSProperties {
  return { '--cell-bg': meta.bg, '--cell-fg': meta.fg } as CSSProperties;
}
