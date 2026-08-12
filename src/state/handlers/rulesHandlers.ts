/**
 * 规则域 handler：规则 patch、人数区间钳制、轮流规则增删改。
 *
 * 区间钳制的交互取向：用户把 min 调到 max 之上时，**顶高 max** 而不是拒绝或
 * 把 min 压回去。竞品文案写的是「左侧按钮调最小值，右侧按钮调最大值」——
 * 用户点的是「+」，期望是数字变大；点了没反应会被理解成按钮坏了。
 */

import type { RotationRule, Rules, WeekdayShiftConfig } from '../../types/domain';
import type { AppState } from '../../types/state';
import {
  MAX_REST_DAYS,
  MAX_SHIFT_COUNT,
  MIN_REST_DAYS,
  MIN_SHIFT_COUNT,
} from '../../constants/defaults';
import { createId } from '../../lib/id';

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    return lo;
  }
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** 局部更新规则字段（不含 rotationRules，后者有独立 action） */
export function patchRules(
  state: AppState,
  payload: Partial<Omit<Rules, 'rotationRules'>>,
): AppState {
  const next: Rules = { ...state.rules, ...payload };
  if (payload.restDaysPerMonth !== undefined) {
    next.restDaysPerMonth = clampInt(payload.restDaysPerMonth, MIN_REST_DAYS, MAX_REST_DAYS);
  }
  return { ...state, rules: next };
}

/** 调整某个 weekday 某班次的人数上下限，并维持 `min <= max` */
export function setWeekdayShift(
  state: AppState,
  weekday: number,
  shift: 'dayShift' | 'nightShift',
  bound: 'min' | 'max',
  rawValue: number,
): AppState {
  const config = state.rules.shiftsByWeekday[weekday];
  if (!config) {
    return state;
  }

  const current = config[shift];
  const value = clampInt(rawValue, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT);
  const nextRange =
    bound === 'min'
      ? { min: value, max: Math.max(value, current.max) }
      : { min: Math.min(value, current.min), max: value };

  if (nextRange.min === current.min && nextRange.max === current.max) {
    return state;
  }

  const nextConfig: WeekdayShiftConfig = { ...config, [shift]: nextRange };
  return {
    ...state,
    rules: {
      ...state.rules,
      shiftsByWeekday: { ...state.rules.shiftsByWeekday, [weekday]: nextConfig },
    },
  };
}

/** 新增轮流门诊规则 */
export function addRotation(state: AppState, payload: Omit<RotationRule, 'id'>): AppState {
  const rule: RotationRule = { ...payload, id: createId(), doctorIds: [...payload.doctorIds] };
  return {
    ...state,
    rules: { ...state.rules, rotationRules: [...state.rules.rotationRules, rule] },
  };
}

/** 更新轮流门诊规则 */
export function updateRotation(state: AppState, rule: RotationRule): AppState {
  const index = state.rules.rotationRules.findIndex((r) => r.id === rule.id);
  if (index < 0) {
    return state;
  }
  const rotationRules = [...state.rules.rotationRules];
  rotationRules[index] = { ...rule, doctorIds: [...rule.doctorIds] };
  return { ...state, rules: { ...state.rules, rotationRules } };
}

/** 删除轮流门诊规则 */
export function removeRotation(state: AppState, id: string): AppState {
  if (!state.rules.rotationRules.some((r) => r.id === id)) {
    return state;
  }
  return {
    ...state,
    rules: {
      ...state.rules,
      rotationRules: state.rules.rotationRules.filter((r) => r.id !== id),
    },
  };
}

/**
 * 出口不变量：所有 weekday 区间满足 `0 <= min <= max <= 20`，月休天数在 0-31。
 *
 * 无越界时**返回原引用**。这条很关键：reducer 每个 action 都会调它，
 * 每次都造新 rules 对象会让派生数据（校验 + 统计）跟着无谓重算。
 */
export function enforceRulesInvariants(rules: Rules): Rules {
  let changed = false;
  const shiftsByWeekday: Record<number, WeekdayShiftConfig> = {};

  for (const [key, config] of Object.entries(rules.shiftsByWeekday)) {
    const weekday = Number(key);
    const day = normalizeRange(config.dayShift.min, config.dayShift.max);
    const night = normalizeRange(config.nightShift.min, config.nightShift.max);
    if (
      day.min === config.dayShift.min &&
      day.max === config.dayShift.max &&
      night.min === config.nightShift.min &&
      night.max === config.nightShift.max
    ) {
      shiftsByWeekday[weekday] = config;
      continue;
    }
    changed = true;
    shiftsByWeekday[weekday] = { dayShift: day, nightShift: night };
  }

  const restDays = clampInt(rules.restDaysPerMonth, MIN_REST_DAYS, MAX_REST_DAYS);
  if (restDays !== rules.restDaysPerMonth) {
    changed = true;
  }

  if (!changed) {
    return rules;
  }
  return { ...rules, shiftsByWeekday, restDaysPerMonth: restDays };
}

function normalizeRange(rawMin: number, rawMax: number): { min: number; max: number } {
  const min = clampInt(rawMin, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT);
  const max = clampInt(rawMax, MIN_SHIFT_COUNT, MAX_SHIFT_COUNT);
  return min <= max ? { min, max } : { min: max, max: min };
}
