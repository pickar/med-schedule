/**
 * 每日班次统计（11 种全量 + min/max 越界判定）。
 *
 * 底部统计行「收起态」只显示 门/白/夜 三类，展开后显示全部 11 类——
 * 因此这里必须一次算全，让展开/收起纯粹是显示切换，不触发重算。
 */

import type { MonthSchedule, Rules, ShiftType } from '../../types/domain';
import { RANGED_SHIFTS, SHIFT_ORDER } from '../../constants/shifts';
import { getWeekday, listMonthDates } from '../../lib/date';

/** 人数区间的越界状态；`none` 表示该班次未配置区间 */
export type RangeStatus = 'ok' | 'below' | 'above' | 'none';

/** 配区间班次（白班 / 夜班）的统计单元 */
export interface RangedStat {
  count: number;
  min: number;
  max: number;
  status: RangeStatus;
}

export interface DailyStat {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0 = 周日 */
  weekday: number;
  isWeekend: boolean;
  /** 11 种班次的当日人数，恒为全量 key（缺席记 0，避免 UI 里到处写 ?? 0） */
  counts: Record<ShiftType, number>;
  dayShift: RangedStat;
  nightShift: RangedStat;
  /** 工作班次人数合计（不含休息 / 夜下休） */
  workTotal: number;
  /** 休息类人数合计（rest + postNightRest） */
  restTotal: number;
  /** 当日已排班的格子总数 */
  assignedTotal: number;
}

export interface DailyStatsParams {
  /** 'YYYY-MM' */
  month: string;
  schedule: MonthSchedule;
  rules: Rules;
}

/** 全 0 的班次计数表，key 恒为 11 种 */
export function createEmptyCounts(): Record<ShiftType, number> {
  const counts = {} as Record<ShiftType, number>;
  for (const shift of SHIFT_ORDER) {
    counts[shift] = 0;
  }
  return counts;
}

/** 逐日统计当月排班，返回值与 `listMonthDates()` 同序等长 */
export function computeDailyStats(params: DailyStatsParams): DailyStat[] {
  const { month, schedule, rules } = params;

  return listMonthDates(month).map((date) => {
    const weekday = getWeekday(date);
    const counts = createEmptyCounts();
    let workTotal = 0;
    let restTotal = 0;
    let assignedTotal = 0;

    const day = schedule?.[date];
    if (day) {
      for (const entry of Object.values(day)) {
        // 防御空条目与未知 shiftType（可能来自被手工改写的 localStorage / 导入的备份）：
        // 不计入，避免污染统计。单条脏数据只影响它自己，不影响整月统计。
        if (!entry || !(entry.shiftType in counts)) {
          continue;
        }
        counts[entry.shiftType] += 1;
        assignedTotal += 1;
        if (entry.shiftType === 'rest' || entry.shiftType === 'postNightRest') {
          restTotal += 1;
        } else {
          workTotal += 1;
        }
      }
    }

    return {
      date,
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
      counts,
      dayShift: buildRangedStat(counts.dayShift, rules, weekday, 'dayShift'),
      nightShift: buildRangedStat(counts.nightShift, rules, weekday, 'nightShift'),
      workTotal,
      restTotal,
      assignedTotal,
    };
  });
}

/** 依据当天 weekday 的区间配置判定越界状态 */
function buildRangedStat(
  count: number,
  rules: Rules,
  weekday: number,
  shift: 'dayShift' | 'nightShift',
): RangedStat {
  const range = rules?.shiftsByWeekday?.[weekday]?.[shift];
  if (!range) {
    return { count, min: 0, max: 0, status: 'none' };
  }
  let status: RangeStatus = 'ok';
  if (count < range.min) {
    status = 'below';
  } else if (count > range.max) {
    status = 'above';
  }
  return { count, min: range.min, max: range.max, status };
}

/** 建 date -> DailyStat 索引，供表头/统计行 O(1) 取用 */
export function indexDailyStats(stats: readonly DailyStat[]): Record<string, DailyStat> {
  const index: Record<string, DailyStat> = {};
  for (const stat of stats) {
    index[stat.date] = stat;
  }
  return index;
}

/** 全月各班次人数合计，用于导出汇总行 */
export function sumMonthCounts(stats: readonly DailyStat[]): Record<ShiftType, number> {
  const total = createEmptyCounts();
  for (const stat of stats) {
    for (const shift of SHIFT_ORDER) {
      total[shift] += stat.counts[shift];
    }
  }
  return total;
}

/** 统计存在越界的天数，供洞察面板顶部摘要使用 */
export function countOutOfRangeDays(stats: readonly DailyStat[]): number {
  let count = 0;
  for (const stat of stats) {
    const bad = RANGED_SHIFTS.some((shift) => {
      const cell = shift === 'dayShift' ? stat.dayShift : stat.nightShift;
      return cell.status === 'below' || cell.status === 'above';
    });
    if (bad) {
      count += 1;
    }
  }
  return count;
}
