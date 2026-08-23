/**
 * 派生数据统一入口。
 *
 * 校验 + 三类统计收敛成**一个** `computeDerived()`，理由（T02 第 5 问已确认）：
 * 1. 重算入口只有一个，防抖才挂得住；分散成三个调用会各自触发一轮重渲染。
 * 2. `computeFairness()` 依赖 `computeDoctorStats()` 的产出，顺序耦合关在这里，
 *    调用方不必知道也不会写错。
 * 3. UI 常用的两套索引与两个衍生列表一并算好，面板层不再各自遍历。
 */

import type { Doctor, MonthSchedule, Rules, ShiftDefinition } from '../../types/domain';
import type { ValidationResult } from '../../types/validation';
import { emptyValidationResult } from '../../types/validation';
import { ensureCustomShiftsShape, ensureDoctorsShape, ensureRulesShape } from '../../lib/dataShape';
import { validateMonth } from '../validator';
import type { DailyStat } from './daily';
import { computeDailyStats, countOutOfRangeDays, indexDailyStats } from './daily';
import type { DoctorStat } from './doctor';
import { computeDoctorStats, findRestShortages, indexDoctorStats } from './doctor';
import type { FairnessResult } from './fairness';
import { computeFairness } from './fairness';

export interface DerivedData {
  /** 这份派生数据对应的月份，供消费方自检是否已跟上月份切换 */
  month: string;
  validation: ValidationResult;
  dailyStats: DailyStat[];
  /** date -> DailyStat，统计行 O(1) 取用 */
  dailyStatsByDate: Record<string, DailyStat>;
  doctorStats: DoctorStat[];
  /** doctorId -> DoctorStat，医生行 O(1) 取用 */
  doctorStatsById: Record<string, DoctorStat>;
  fairness: FairnessResult;
  /** 休息未达标的医生，按缺口降序 */
  restShortages: DoctorStat[];
  /** 白班或夜班人数越界的天数 */
  outOfRangeDays: number;
}

export interface DerivedParams {
  /** 'YYYY-MM' */
  month: string;
  schedule: MonthSchedule;
  doctors: Doctor[];
  rules: Rules;
  /** 自定义班次定义（custom-aware 统计 / 校验用） */
  customShifts: ShiftDefinition[];
}

/**
 * 一次算齐校验与全部统计。纯函数，无副作用，可安全放进 `useMemo`。
 *
 * **本函数保证不抛异常。** 它是渲染期唯一的计算入口，一旦 throw 就是整页白屏，
 * 而脏数据此时已经落盘，用户刷新还是白屏（QA-BUG-01）。因此入参一律先过
 * `sanitizeParams()`：脏的那一条被丢掉，其余照常计算——**局部脏数据只能造成
 * 局部缺失，不能造成全局崩溃**。
 */
export function computeDerived(params: DerivedParams): DerivedData {
  const { month, schedule, doctors, rules, customShifts } = sanitizeParams(params);

  const validation = validateMonth({ month, schedule, doctors, rules });
  const dailyStats = computeDailyStats({ month, schedule, rules, customShifts });
  const doctorStats = computeDoctorStats({ month, schedule, doctors, rules, customShifts });

  return {
    month,
    validation,
    dailyStats,
    dailyStatsByDate: indexDailyStats(dailyStats),
    doctorStats,
    doctorStatsById: indexDoctorStats(doctorStats),
    fairness: computeFairness(doctorStats),
    restShortages: findRestShortages(doctorStats),
    outOfRangeDays: countOutOfRangeDays(dailyStats),
  };
}

/**
 * 入参清洗：把「类型上是 DerivedParams、运行时可能缺胳膊少腿」的入参
 * 修成计算链路可以无条件消费的形状。
 *
 * 四条已验证的可达崩溃路径都在这里被拦下：
 *   entry = null                  -> 该条被丢弃
 *   rules.shiftsByWeekday = null  -> 补 createDefaultRules() 的区间配置
 *   rules.rules = undefined       -> 补默认开关
 *   医生缺 constraints            -> 补三项全关的默认约束
 */
function sanitizeParams(params: DerivedParams): DerivedParams {
  return {
    month: typeof params.month === 'string' ? params.month : '',
    schedule: sanitizeSchedule(params.schedule),
    doctors: ensureDoctorsShape(params.doctors),
    rules: ensureRulesShape(params.rules),
    customShifts: ensureCustomShiftsShape(params.customShifts),
  };
}

/**
 * 逐条过滤排班：非对象条目、班次非法的条目一律丢弃；
 * 条目内 `doctorId` 与外层 key 不一致时以 key 为准（key 才是索引依据）。
 *
 * 干净的条目**原样返回引用**，不做无谓的对象复制。
 */
function sanitizeSchedule(raw: MonthSchedule | null | undefined): MonthSchedule {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const result: MonthSchedule = {};
  for (const [date, day] of Object.entries(raw)) {
    if (!day || typeof day !== 'object') {
      continue;
    }
    const kept: MonthSchedule[string] = {};
    for (const [doctorId, entry] of Object.entries(day)) {
      // ⚠️ 关键回归点：放宽 isShiftType 判定为 typeof === 'string'，
      // 否则自定义班次 id（非 ShiftType 字面量）会被清洗丢弃。
      if (!entry || typeof entry !== 'object' || typeof entry.shiftType !== 'string') {
        continue;
      }
      kept[doctorId] = entry.doctorId === doctorId ? entry : { ...entry, doctorId };
    }
    if (Object.keys(kept).length > 0) {
      result[date] = kept;
    }
  }
  return result;
}

/**
 * 空派生数据，供 Context 初值与「尚未水合」时使用。
 * 有了它，消费方永远不必对 `derived` 判空。
 */
export function emptyDerived(month: string): DerivedData {
  return {
    month,
    validation: emptyValidationResult(),
    dailyStats: [],
    dailyStatsByDate: {},
    doctorStats: [],
    doctorStatsById: {},
    fairness: computeFairness([]),
    restShortages: [],
    outOfRangeDays: 0,
  };
}

export type { DailyStat, RangedStat, RangeStatus } from './daily';
export type { DoctorStat } from './doctor';
export type { FairnessDimensionScore, FairnessLevel, FairnessResult } from './fairness';
