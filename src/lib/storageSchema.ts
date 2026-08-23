/**
 * 存储层的数据归一化与 schemaVersion 迁移。
 *
 * 从 `storage.ts` 拆出（单文件 300 行上限）：
 * 这里只负责「把不可信的 unknown 变成可信的领域对象」，不碰 localStorage API。
 *
 * 防御原则：任何字段缺失 / 类型错误都退回默认值并跳过该条，
 * **绝不抛异常导致整包数据被判为损坏**。真正的解析异常（JSON 语法错）
 * 由 `storage.ts` 捕获并备份原始串。
 */

import type { Doctor, DoctorTitle, MonthSchedule, Rules, ShiftDefinition } from '../types/domain';
import { DOCTOR_TITLES } from '../constants/palette';
import {
  MAX_REST_DAYS,
  MAX_SHIFT_COUNT,
  MIN_REST_DAYS,
  MIN_SHIFT_COUNT,
  createDefaultRules,
} from '../constants/defaults';
import { isValidDateKey } from './date';

/** 从 localStorage 读出的原始整包数据，迁移函数的输入输出格式 */
export interface RawBundle {
  schemaVersion: number;
  doctors: unknown;
  rules: unknown;
  /** key = 'YYYY-MM' */
  schedules: Record<string, unknown>;
  /** 自定义班次定义（v2 新增，独立 storage key） */
  customShifts: unknown;
}

/**
 * 版本迁移表：key 为「迁移前版本」，函数把整包原始数据升到下一版。
 * 新增版本时在此追加，**禁止改动历史条目**。
 *
 * 1 → 2：仅补 `customShifts: []`（向后兼容，无字段破坏）。
 * 仅当原包缺该字段时才补默认 []，绝不覆盖已有数据。
 */
export const MIGRATIONS: Record<number, (raw: RawBundle) => RawBundle> = {
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    customShifts: Array.isArray(raw.customShifts) ? raw.customShifts : [],
  }),
};

/**
 * 依次执行迁移直到目标版本。找不到对应迁移函数时停止（保持原样，不清空）。
 * @returns migratedFrom 为 null 表示未发生迁移
 */
export function migrateBundle(
  bundle: RawBundle,
  targetVersion: number,
): { bundle: RawBundle; migratedFrom: number | null } {
  let current = bundle;
  let migratedFrom: number | null = null;
  let guard = 0;
  while (current.schemaVersion < targetVersion && guard < 20) {
    const migrate = MIGRATIONS[current.schemaVersion];
    if (!migrate) {
      break;
    }
    migratedFrom = migratedFrom ?? current.schemaVersion;
    current = migrate(current);
    guard += 1;
  }
  return { bundle: current, migratedFrom };
}

// ============ 通用守卫 ============

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 取整并钳制到 [min, max]，非数字时返回 fallback */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

// ============ 归一化 ============

export function normalizeDoctors(raw: unknown): Doctor[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const titles = new Set<string>(DOCTOR_TITLES);
  const result: Doctor[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      continue;
    }
    const c: Record<string, unknown> = isObject(item.constraints) ? item.constraints : {};
    const leavesRaw: unknown[] = Array.isArray(item.leaves) ? item.leaves : [];
    result.push({
      id: item.id,
      name: item.name,
      title: (titles.has(String(item.title)) ? item.title : '主治医师') as DoctorTitle,
      color: typeof item.color === 'string' ? item.color : '#6D4C41',
      fixedClinicDays: Array.isArray(item.fixedClinicDays)
        ? item.fixedClinicDays.filter((d: unknown): d is number => typeof d === 'number' && d >= 0 && d <= 6)
        : [],
      constraints: {
        noDayShift: c.noDayShift === true,
        noNightShift: c.noNightShift === true,
        weekendOff: c.weekendOff === true,
      },
      leaves: leavesRaw
        .filter(
          (l): l is Record<string, unknown> =>
            isObject(l) && isValidDateKey(l.start) && isValidDateKey(l.end),
        )
        .map((l) => ({
          id: typeof l.id === 'string' ? l.id : `${String(l.start)}~${String(l.end)}`,
          start: String(l.start),
          end: String(l.end),
          note: typeof l.note === 'string' ? l.note : undefined,
        })),
    });
  }
  return result;
}

export function normalizeRules(raw: unknown): Rules {
  const base = createDefaultRules();
  if (!isObject(raw)) {
    return base;
  }
  if (typeof raw.departmentName === 'string' && raw.departmentName.trim() !== '') {
    base.departmentName = raw.departmentName;
  }
  base.restDaysPerMonth = clampInt(
    raw.restDaysPerMonth,
    MIN_REST_DAYS,
    MAX_REST_DAYS,
    base.restDaysPerMonth,
  );
  if (isObject(raw.rules)) {
    base.rules.noConsecutiveNightShift = raw.rules.noConsecutiveNightShift !== false;
  }
  if (isObject(raw.shiftsByWeekday)) {
    normalizeWeekdayShifts(raw.shiftsByWeekday, base);
  }
  if (Array.isArray(raw.rotationRules)) {
    base.rotationRules = raw.rotationRules
      .filter((r: unknown): r is Record<string, unknown> => isObject(r) && typeof r.weekday === 'number')
      .map((r, index) => ({
        id: typeof r.id === 'string' ? r.id : `rotation-${index}`,
        weekday: clampInt(r.weekday, 0, 6, 1),
        doctorIds: Array.isArray(r.doctorIds)
          ? r.doctorIds.filter((d: unknown): d is string => typeof d === 'string')
          : [],
        mode: r.mode === 'selected' || r.mode === 'random' ? r.mode : 'all',
      }));
  }
  return base;
}

/** 逐个 weekday 归一化人数区间，并保证 min <= max */
function normalizeWeekdayShifts(source: Record<string, unknown>, target: Rules): void {
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const cfg = source[String(weekday)];
    if (!isObject(cfg)) {
      continue;
    }
    for (const shift of ['dayShift', 'nightShift'] as const) {
      const range = cfg[shift];
      if (!isObject(range)) {
        continue;
      }
      const fallback = target.shiftsByWeekday[weekday][shift];
      const min = clampInt(range.min, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT, fallback.min);
      const max = clampInt(range.max, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT, fallback.max);
      target.shiftsByWeekday[weekday][shift] = {
        min: Math.min(min, max),
        max: Math.max(min, max),
      };
    }
  }
}

export function normalizeMonthSchedule(raw: unknown): MonthSchedule {
  const result: MonthSchedule = {};
  if (!isObject(raw)) {
    return result;
  }
  for (const [date, dayRaw] of Object.entries(raw)) {
    if (!isValidDateKey(date) || !isObject(dayRaw)) {
      continue;
    }
    const day: MonthSchedule[string] = {};
    for (const [doctorId, entryRaw] of Object.entries(dayRaw)) {
      // ⚠️ 关键回归点：放宽 isShiftType 判定为 typeof === 'string'，
      // 否则自定义班次 id（非 ShiftType 字面量）会被静默丢弃。
      if (!isObject(entryRaw) || typeof entryRaw.shiftType !== 'string') {
        continue;
      }
      day[doctorId] = {
        doctorId,
        shiftType: entryRaw.shiftType,
        isRotation: entryRaw.isRotation === true,
        locked: entryRaw.locked === true ? true : undefined,
        manual: entryRaw.manual === true ? true : undefined,
      };
    }
    if (Object.keys(day).length > 0) {
      result[date] = day;
    }
  }
  return result;
}

/**
 * 归一化自定义班次定义数组。
 * 防御原则同 normalizeDoctors：任何字段缺失 / 类型错误都退回默认并跳过该条，
 * 绝不抛异常导致整包数据被判为损坏。
 */
export function normalizeCustomShifts(raw: unknown): ShiftDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: ShiftDefinition[] = [];
  for (const item of raw) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.short !== 'string'
    ) {
      continue;
    }
    const bg =
      typeof item.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.bg) ? item.bg : '#EFEBE9';
    const fg =
      typeof item.fg === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.fg) ? item.fg : '#4E342E';
    result.push({
      id: item.id,
      label: item.label.slice(0, 8),
      short: item.short.slice(0, 3),
      bg,
      fg,
      isWork: item.isWork !== false,
      autoAssignable: item.autoAssignable === true,
      isBuiltin: item.isBuiltin === true,
      startTime: typeof item.startTime === 'string' ? item.startTime : undefined,
      endTime: typeof item.endTime === 'string' ? item.endTime : undefined,
    });
  }
  return result;
}
