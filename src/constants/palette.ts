/**
 * 医生标识色板、职称枚举、星期名称。
 *
 * 12 色板在深青主色调下取高辨识度的中低饱和色，
 * 与班次色标（浅底深字）刻意区分：色板用于「小圆点」，饱和度更高。
 *
 * ⚠️ 品牌换肤不动这 12 个色值：医生标识色属于**数据语义色**，
 *    改一次，全部历史排班表里每位医生的小圆点颜色都会漂移。
 */

import type { DoctorTitle } from '../types/domain';

/** 医生标识 12 色板，按顺序分配，用尽后从头循环 */
export const DOCTOR_COLORS: readonly string[] = [
  '#D84315', // 砖橙
  '#00695C', // 深青
  '#4527A0', // 深紫
  '#558B2F', // 橄榄绿
  '#AD1457', // 玫红
  '#F57F17', // 琥珀
  '#1565C0', // 藏蓝
  '#6D4C41', // 栗棕
  '#00838F', // 孔雀蓝
  '#7B1FA2', // 葡萄紫
  '#2E7D32', // 森林绿
  '#C62828', // 正红
] as const;

/** 4 种职称（严格对齐竞品） */
export const DOCTOR_TITLES: readonly DoctorTitle[] = [
  '主任医师',
  '副主任医师',
  '主治医师',
  '住院医师',
] as const;

/** 职称在表格首列的简写 */
export const TITLE_SHORT: Record<DoctorTitle, string> = {
  '主任医师': '主任',
  '副主任医师': '副主任',
  '主治医师': '主治',
  '住院医师': '住院',
};

/** 星期名称，索引 0 = 周日（与 Date.getDay() 一致） */
export const WEEKDAY_NAMES: readonly string[] = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 星期完整名称，用于规则表与提示文案 */
export const WEEKDAY_FULL_NAMES: readonly string[] = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
] as const;

/**
 * 规则表的行顺序：周一 ~ 周日。
 * 竞品的配置表按「周一开头」展示，但数据索引仍是 0=周日，两者不可混淆。
 */
export const WEEKDAY_DISPLAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0] as const;

/** 从已占用颜色中挑一个未被使用的色板色；全部占用时按数量取模循环 */
export function pickDoctorColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors);
  const free = DOCTOR_COLORS.find((c) => !used.has(c));
  if (free) {
    return free;
  }
  return DOCTOR_COLORS[usedColors.length % DOCTOR_COLORS.length];
}

/** 星期几是否为周末（0 周日 / 6 周六） */
export function isWeekendWeekday(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}
