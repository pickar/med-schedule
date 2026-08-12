/**
 * 日期工具（零依赖，纯函数）。
 *
 * 约定：
 * - 日期字符串一律 'YYYY-MM-DD'，月份字符串一律 'YYYY-MM'
 * - 全部按**本地时区**解析，禁止使用 `new Date('2026-08-01')` 这种会被当成 UTC
 *   的写法，否则东八区会偏移成 7 月 31 日
 * - weekday：0 = 周日 … 6 = 周六（与 Date.getDay() 及竞品 fixedClinicDays 一致）
 */

/** 补零到 2 位 */
export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM' -> { year, month }，month 为 1-12 */
export function parseMonthKey(month: string): { year: number; month: number } {
  const [y, m] = month.split('-');
  return { year: Number(y), month: Number(m) };
}

/** (2026, 8) -> '2026-08' */
export function formatMonthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** 'YYYY-MM-DD' -> { year, month, day } */
export function parseDateKey(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

/** (2026, 8, 3) -> '2026-08-03' */
export function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 'YYYY-MM-DD' -> 本地时区的 Date 对象（当天 00:00:00） */
export function toLocalDate(date: string): Date {
  const { year, month, day } = parseDateKey(date);
  return new Date(year, month - 1, day);
}

/** 某月天数，如 '2026-02' -> 28 */
export function getDaysInMonth(month: string): number {
  const { year, month: m } = parseMonthKey(month);
  return new Date(year, m, 0).getDate();
}

/** 某日星期几，0 = 周日 */
export function getWeekday(date: string): number {
  return toLocalDate(date).getDay();
}

/** 某日是否周末（周六 / 周日） */
export function isWeekend(date: string): boolean {
  const w = getWeekday(date);
  return w === 0 || w === 6;
}

/** 今天的 'YYYY-MM-DD' */
export function todayDateKey(): string {
  const now = new Date();
  return formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 本月的 'YYYY-MM' */
export function currentMonthKey(): string {
  const now = new Date();
  return formatMonthKey(now.getFullYear(), now.getMonth() + 1);
}

/** 某日是否为今天 */
export function isToday(date: string): boolean {
  return date === todayDateKey();
}

/** 月份平移，delta 可正可负，如 shiftMonth('2026-01', -1) -> '2025-12' */
export function shiftMonth(month: string, delta: number): string {
  const { year, month: m } = parseMonthKey(month);
  const base = new Date(year, m - 1 + delta, 1);
  return formatMonthKey(base.getFullYear(), base.getMonth() + 1);
}

/** 日期平移，delta 可正可负 */
export function addDays(date: string, delta: number): string {
  const base = toLocalDate(date);
  base.setDate(base.getDate() + delta);
  return formatDateKey(base.getFullYear(), base.getMonth() + 1, base.getDate());
}

/** 列出某月全部日期，如 '2026-08' -> ['2026-08-01', …, '2026-08-31'] */
export function listMonthDates(month: string): string[] {
  const { year, month: m } = parseMonthKey(month);
  const total = getDaysInMonth(month);
  const dates: string[] = [];
  for (let day = 1; day <= total; day += 1) {
    dates.push(formatDateKey(year, m, day));
  }
  return dates;
}

/** 从 'YYYY-MM-DD' 取所属月份 'YYYY-MM' */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** 字典序即时间序，可直接比较；返回 -1 / 0 / 1 */
export function compareDateKey(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** date 是否落在 [start, end] 闭区间内 */
export function isDateInRange(date: string, start: string, end: string): boolean {
  const lo = start <= end ? start : end;
  const hi = start <= end ? end : start;
  return date >= lo && date <= hi;
}

/** 展开日期区间为逐日数组（含首尾），上限 400 天防御异常输入 */
export function expandDateRange(start: string, end: string): string[] {
  const lo = start <= end ? start : end;
  const hi = start <= end ? end : start;
  const dates: string[] = [];
  let cursor = lo;
  let guard = 0;
  while (cursor <= hi && guard < 400) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return dates;
}

/** '2026-08-03' -> '8/3'，用于违规提示与 toast */
export function formatMD(date: string): string {
  const { month, day } = parseDateKey(date);
  return `${month}/${day}`;
}

/** '2026-08' -> '2026年8月' */
export function formatMonthLabel(month: string): string {
  const { year, month: m } = parseMonthKey(month);
  return `${year}年${m}月`;
}

/** 是否为合法的 'YYYY-MM' */
export function isValidMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

/** 是否为合法的 'YYYY-MM-DD' */
export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
