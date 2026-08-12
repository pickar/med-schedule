/**
 * 行数据转置层 —— 整张表能不能扛住「改一格」，全看这个文件。
 *
 * ## 为什么需要转置
 *
 * 存储结构是「日期 → 医生 → 条目」，而表格是「医生一行、日期一列」。
 * 行组件要拿到自己那一整行，天然需要一次转置。
 * 如果在 `DoctorRow` 里现算 `dates.map(d => schedule[d]?.[id])`，
 * 每次渲染都会产出新数组——`React.memo` 立刻失效，等于没写。
 *
 * ## 引用保持（本文件的全部价值）
 *
 * 转置结果逐元素与上一轮比对，**内容相同就复用上一轮的数组引用**。
 * 于是改一个格子时：
 * - 该医生的 `entries` 数组内容变了 → 新引用 → 那一行重渲染；
 * - 其余 14 位医生的数组内容逐项 `===` 相等 → 复用旧引用 → 那些行整体跳过。
 * 前提是 reducer 侧的结构共享没被破坏（未触及的 `ScheduleEntry` 保持原引用），
 * 这一点由 `state/handlers/scheduleHandlers.ts` 保证，两边是一根绳上的蚂蚱。
 *
 * ## 违规为什么摊成字符串
 *
 * `derived.validation.byCell` 每次 `computeDerived()` 都是全新对象，
 * 把 `Violation[]` 直接传进单元格，memo 的浅比较必然判定「变了」，930 个格子一起重渲染。
 * 这里提前把它压成 `string | undefined`：字符串按值比较，没变就是没变。
 * 文案本身来自 `core/validator/messages.ts` 生成的 `violation.message`，
 * 组件层一个字都不另写。
 */

import { useMemo, useRef } from 'react';
import type { Doctor, MonthSchedule, ScheduleEntry } from '../../types/domain';
import type { Severity, ValidationResult, Violation } from '../../types/validation';
import { cellKey } from '../../types/validation';
import { SEVERITY_WEIGHT } from '../../types/validation';
import { isDateInRange, isWeekend } from '../../lib/date';

/** 一位医生的整行数据，四条平行数组与 `dates` 同序等长 */
export interface DoctorRowData {
  doctorId: string;
  /** 该医生每一天的排班条目，未排班为 undefined */
  entries: readonly (ScheduleEntry | undefined)[];
  /** 该格违规提示（多条以换行拼接），无违规为 undefined */
  violations: readonly (string | undefined)[];
  /** 该格违规的最高严重度，用于选边框色 */
  severities: readonly (Severity | undefined)[];
  /** 该格是否落在请假区间内 */
  leaves: readonly boolean[];
}

export interface DoctorRowsParams {
  dates: readonly string[];
  doctors: readonly Doctor[];
  schedule: MonthSchedule;
  validation: ValidationResult;
}

/** 逐元素比较两个数组（引用相等即视为相同元素） */
function sameItems<T>(next: readonly T[], prev: readonly T[]): boolean {
  if (next.length !== prev.length) {
    return false;
  }
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== prev[i]) {
      return false;
    }
  }
  return true;
}

/** 内容没变就退回上一轮的引用，这是 memo 生效的唯一开关 */
function reuse<T>(next: readonly T[], prev: readonly T[] | undefined): readonly T[] {
  return prev !== undefined && sameItems(next, prev) ? prev : next;
}

/** 把该格的全部违规压成一段可直接进 `title` 的文本 */
function joinViolations(list: readonly Violation[]): string {
  return list.map((v) => (v.detail ? `${v.message}\n${v.detail}` : v.message)).join('\n');
}

/** 取该格违规里最严重的一档，决定边框强度 */
function topSeverity(list: readonly Violation[]): Severity {
  let top: Severity = list[0].severity;
  for (const item of list) {
    if (SEVERITY_WEIGHT[item.severity] > SEVERITY_WEIGHT[top]) {
      top = item.severity;
    }
  }
  return top;
}

/** 上一轮行数据的记忆化缓存，key 为 doctorId */
export type RowCache = Map<string, DoctorRowData>;

export function createRowCache(): RowCache {
  return new Map();
}

/**
 * 转置出每位医生的整行数据，并尽最大可能复用上一轮的数组引用。
 *
 * 纯函数（除了原地更新传入的 `cache`），因此可以脱离 React 直接被烟测驱动：
 * 连续调用两次、中间只改一个格子，就能量出「有几行、几格的 props 真的变了」。
 * 这条性质是整张表性能的命门，必须可断言，不能只靠肉眼看 DevTools。
 *
 * 复杂度 O(医生数 × 天数)，15 × 31 不到 500 次比较，
 * 换来的是 464 个单元格与 14 个行组件整体跳过渲染，这笔买卖非常划算。
 */
export function buildDoctorRows(
  params: DoctorRowsParams,
  cache: RowCache,
): readonly DoctorRowData[] {
  const { dates, doctors, schedule, validation } = params;
  const nextCache: RowCache = new Map();

  const rows = doctors.map((doctor) => {
    const prev = cache.get(doctor.id);
    const entries: (ScheduleEntry | undefined)[] = [];
    const violations: (string | undefined)[] = [];
    const severities: (Severity | undefined)[] = [];
    const leaves: boolean[] = [];
    const ranges = doctor.leaves ?? [];

    for (const date of dates) {
      entries.push(schedule[date]?.[doctor.id]);
      const hits = validation.byCell[cellKey(date, doctor.id)];
      const hasHit = hits !== undefined && hits.length > 0;
      violations.push(hasHit ? joinViolations(hits) : undefined);
      severities.push(hasHit ? topSeverity(hits) : undefined);
      leaves.push(ranges.some((range) => isDateInRange(date, range.start, range.end)));
    }

    const candidate: DoctorRowData = {
      doctorId: doctor.id,
      entries: reuse(entries, prev?.entries),
      violations: reuse(violations, prev?.violations),
      severities: reuse(severities, prev?.severities),
      leaves: reuse(leaves, prev?.leaves),
    };
    // 四条数组全部复用 → 整行对象也退回旧引用，行组件才可能完整跳过
    const unchanged =
      prev !== undefined &&
      prev.entries === candidate.entries &&
      prev.violations === candidate.violations &&
      prev.severities === candidate.severities &&
      prev.leaves === candidate.leaves;
    const row = unchanged ? prev : candidate;
    nextCache.set(doctor.id, row);
    return row;
  });

  // 原地换内容而不是换 Map 引用：调用方（useRef / 烟测）握着同一个盒子
  cache.clear();
  for (const [id, row] of nextCache) {
    cache.set(id, row);
  }
  return rows;
}

/** `buildDoctorRows` 的 React 包装：缓存挂 ref，重算挂 useMemo */
export function useDoctorRows(params: DoctorRowsParams): readonly DoctorRowData[] {
  const { dates, doctors, schedule, validation } = params;
  // 渲染期读写这个 cache 是刻意的：它只是纯函数的记忆化缓存，
  // StrictMode 下二次执行会读到首次写入的同一批引用，结果依然一致。
  const cache = useRef<RowCache>(createRowCache());

  return useMemo(
    () => buildDoctorRows({ dates, doctors, schedule, validation }, cache.current),
    [dates, doctors, schedule, validation],
  );
}

/** 周末列标记，只随月份变化，单独 memo 出来当稳定 prop 用 */
export function useWeekendFlags(dates: readonly string[]): readonly boolean[] {
  return useMemo(() => dates.map((date) => isWeekend(date)), [dates]);
}
