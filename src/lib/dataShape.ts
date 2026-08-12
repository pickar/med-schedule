/**
 * 形状保证层：把「类型上已经是领域对象、运行时却不可信」的值修成可无条件消费的形状。
 *
 * 与 `storageSchema.ts` 的分工：
 * - `storageSchema` 负责 `unknown` -> 领域对象（解析边界，只在读盘 / 导入时跑一次）。
 * - 本文件负责 `Doctor | Rules`（类型已标注）-> **形状可信**的同类对象，
 *   给渲染期的计算入口做最后一道兜底。
 *
 * 为什么两层都要有：TypeScript 的类型标注在运行时不存在。一份手工编辑过的备份、
 * 一份老版本 localStorage、一次 reducer 里的部分更新，都能让一个签名为 `Rules`
 * 的值实际缺 `shiftsByWeekday`。缺子对象一旦流进渲染期计算就是 TypeError，
 * 而渲染期 throw = 整页白屏（QA-BUG-01）。
 *
 * 设计原则：**null 与 undefined 一视同仁**，任何缺失都补默认值而不是抛错，
 * 任何单条脏数据只影响它自己，不影响同批次的其他数据。
 */

import type {
  Doctor,
  DoctorConstraints,
  DoctorTitle,
  MonthSchedule,
  Rules,
  ShiftRange,
  WeekdayShiftConfig,
} from '../types/domain';
import {
  MAX_REST_DAYS,
  MAX_SHIFT_COUNT,
  MIN_REST_DAYS,
  MIN_SHIFT_COUNT,
  createDefaultRules,
} from '../constants/defaults';
import { clampInt, isObject } from './storageSchema';

/** 缺省个人约束：三项硬约束全关 */
export function defaultConstraints(): DoctorConstraints {
  return { noDayShift: false, noNightShift: false, weekendOff: false };
}

/** 人数区间的形状保证：min / max 必须是数字，且 min <= max */
function ensureRange(raw: unknown, fallback: ShiftRange): ShiftRange {
  if (!isObject(raw)) {
    return { ...fallback };
  }
  const min = clampInt(raw.min, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT, fallback.min);
  const max = clampInt(raw.max, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT, fallback.max);
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/**
 * 保证 `Rules` 的形状：`shiftsByWeekday` 覆盖 0~6 全部 weekday、`rules` 子对象存在、
 * `rotationRules` 一定是数组。
 *
 * 对应 QA-BUG-01 的两条崩溃路径：
 *   `rules.shiftsByWeekday = null`  -> Cannot read properties of null (reading '6')
 *   `rules.rules = undefined`       -> Cannot read properties of undefined (reading 'noConsecutiveNightShift')
 */
export function ensureRulesShape(raw: Rules | null | undefined): Rules {
  const fallback = createDefaultRules();
  if (!isObject(raw)) {
    return fallback;
  }
  const source: Record<string, unknown> = raw;
  const rawWeekdays = isObject(source.shiftsByWeekday) ? source.shiftsByWeekday : {};
  const shiftsByWeekday: Record<number, WeekdayShiftConfig> = {};
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const cfg = rawWeekdays[String(weekday)];
    const preset = fallback.shiftsByWeekday[weekday];
    shiftsByWeekday[weekday] = isObject(cfg)
      ? { dayShift: ensureRange(cfg.dayShift, preset.dayShift), nightShift: ensureRange(cfg.nightShift, preset.nightShift) }
      : preset;
  }
  const rulesBlock = isObject(source.rules) ? source.rules : null;
  return {
    departmentName:
      typeof source.departmentName === 'string' && source.departmentName.trim() !== ''
        ? source.departmentName
        : fallback.departmentName,
    shiftsByWeekday,
    restDaysPerMonth: clampInt(source.restDaysPerMonth, MIN_REST_DAYS, MAX_REST_DAYS, fallback.restDaysPerMonth),
    rules: {
      noConsecutiveNightShift: rulesBlock ? rulesBlock.noConsecutiveNightShift !== false : true,
    },
    rotationRules: Array.isArray(source.rotationRules) ? source.rotationRules : [],
  };
}

/**
 * 保证单个 `Doctor` 的形状：`constraints` / `fixedClinicDays` / `leaves` 一定存在。
 * 无法识别为医生（非对象、缺 id）时返回 null，由调用方剔除。
 *
 * 对应 QA-BUG-01 的崩溃路径：
 *   医生缺 constraints -> Cannot read properties of undefined (reading 'noDayShift')
 */
export function ensureDoctorShape(raw: Doctor | null | undefined): Doctor | null {
  if (!isObject(raw) || typeof raw.id !== 'string') {
    return null;
  }
  const id: string = raw.id;
  const source: Record<string, unknown> = raw;
  const c = isObject(source.constraints) ? source.constraints : {};
  return {
    id,
    name: typeof source.name === 'string' ? source.name : id,
    title: (typeof source.title === 'string' ? source.title : '主治医师') as DoctorTitle,
    color: typeof source.color === 'string' ? source.color : '#6D4C41',
    fixedClinicDays: Array.isArray(source.fixedClinicDays)
      ? source.fixedClinicDays.filter((d: unknown): d is number => typeof d === 'number')
      : [],
    constraints: {
      noDayShift: c.noDayShift === true,
      noNightShift: c.noNightShift === true,
      weekendOff: c.weekendOff === true,
    },
    leaves: Array.isArray(source.leaves) ? (raw as Doctor).leaves : [],
  };
}

/** 批量保证医生形状，顺带剔除无法识别的条目 */
export function ensureDoctorsShape(raw: Doctor[] | null | undefined): Doctor[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Doctor[] = [];
  for (const item of raw) {
    const doctor = ensureDoctorShape(item);
    if (doctor) {
      result.push(doctor);
    }
  }
  return result;
}

/**
 * 剔除「引用了不在册医生」的孤儿排班条目。
 *
 * QA-BUG-02：用户删掉某位医生后导出备份、再导入，孤儿 id 会一路混进 state——
 * 每日统计把孤儿计进人数（在册只有 1 人白班却显示 3 人），校验器还会为一个
 * 根本不存在的医生产出违规提示。名册是唯一权威，不在册即不存在。
 *
 * **只剔除 doctorId 不在册的条目**，其余一律原样保留：
 * 不改 shiftType、不补空缺、不动锁定标记。
 */
export function pruneOrphanEntries(
  schedule: MonthSchedule,
  allowedDoctorIds: ReadonlySet<string>,
): MonthSchedule {
  const result: MonthSchedule = {};
  for (const [date, day] of Object.entries(schedule)) {
    if (!isObject(day)) {
      continue;
    }
    const kept: MonthSchedule[string] = {};
    for (const [doctorId, entry] of Object.entries(day)) {
      if (!entry || !allowedDoctorIds.has(doctorId) || !allowedDoctorIds.has(entry.doctorId)) {
        continue;
      }
      kept[doctorId] = entry;
    }
    if (Object.keys(kept).length > 0) {
      result[date] = kept;
    }
  }
  return result;
}

/** 从医生名册取 id 集合，供 `pruneOrphanEntries()` 使用 */
export function doctorIdSet(doctors: readonly Doctor[]): Set<string> {
  const ids = new Set<string>();
  for (const doctor of doctors) {
    if (doctor && typeof doctor.id === 'string') {
      ids.add(doctor.id);
    }
  }
  return ids;
}
