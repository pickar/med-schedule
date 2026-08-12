/**
 * CSV 导出（零依赖）。
 *
 * 三条不能省的细节：
 * 1. **BOM 头**由 `downloadCsv()` 统一加。没有它 Excel 会按 GBK 解 UTF-8，
 *    「张伟」变「寮犱紵」——这是中文 CSV 导出最经典的一个坑。
 * 2. **行尾用 `\r\n`**。Excel 对 `\n` 的容忍度取决于版本与区域设置，
 *    `\r\n` 是各家一致认账的写法。
 * 3. **文件名月份补零**（`内分泌科202608排班表.csv`）。PNG 那边不补零，
 *    两者的差异是竞品原始行为，照抄，不要在这里「顺手修正」。
 *
 * 表体结构与屏幕上的表格保持一致，导出的东西和看到的东西必须能对上：
 * 标题 / 表头（日 + 星期两行）/ 医生行（含应休实休）/ 每日班次统计行。
 */

import type { Doctor, MonthSchedule, Rules } from '../types/domain';
import type { DailyStat, DoctorStat } from '../core/stats';
import { SHIFT_METAS, SHIFT_ORDER, getShiftShort } from '../constants/shifts';
import { TITLE_SHORT, WEEKDAY_NAMES } from '../constants/palette';
import { TEXTS, csvFileName, scheduleTitle } from '../constants/texts';
import { listMonthDates, parseDateKey } from './date';
import { downloadCsv } from './download';

export interface CsvExportParams {
  /** 'YYYY-MM' */
  month: string;
  rules: Rules;
  doctors: readonly Doctor[];
  schedule: MonthSchedule;
  /** 与 `listMonthDates(month)` 同序等长 */
  dailyStats: readonly DailyStat[];
  doctorStatsById: Record<string, DoctorStat>;
}

/** 行尾：Excel 各版本都认这个 */
const EOL = '\r\n';

/**
 * CSV 单元格转义。
 * 含逗号 / 双引号 / 换行时整体加引号，内部双引号翻倍——RFC 4180 的最小实现。
 */
function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toRow(cells: readonly string[]): string {
  return cells.map(escapeCell).join(',');
}

/** 用重复空串补齐尾部空列，保证每行列数一致（列数不齐会让 Excel 错位） */
function padTail(cells: string[], total: number): string[] {
  while (cells.length < total) {
    cells.push('');
  }
  return cells;
}

/** 取某医生某天的班次简写；未排班返回空串而不是「-」，Excel 里空格更干净 */
function shiftShortAt(schedule: MonthSchedule, date: string, doctorId: string): string {
  const entry = schedule[date]?.[doctorId];
  if (!entry) {
    return '';
  }
  return getShiftShort(entry.shiftType);
}

/**
 * 组装 CSV 文本（不含 BOM，不触发下载）。
 * 独立导出是为了让烟测能直接断言内容，而不必去 mock 下载链路。
 */
export function buildScheduleCsv(params: CsvExportParams): string {
  const { month, rules, doctors, schedule, dailyStats, doctorStatsById } = params;
  const dates = listMonthDates(month);
  // 医生 + 职称 + N 天 + 应休 + 实休
  const columnCount = 2 + dates.length + 2;
  const rows: string[][] = [];

  // ---- 标题 ----
  rows.push(padTail([scheduleTitle(rules.departmentName, month)], columnCount));
  rows.push(padTail([], columnCount));

  // ---- 表头：第一行日号，第二行星期 ----
  rows.push([
    TEXTS.columnDoctor,
    TEXTS.doctorTitleLabel,
    ...dates.map((date) => String(parseDateKey(date).day)),
    TEXTS.columnShouldRest,
    TEXTS.columnActualRest,
  ]);
  rows.push([
    '',
    '',
    ...dailyStats.map((stat) => WEEKDAY_NAMES[stat.weekday] ?? ''),
    '',
    '',
  ]);

  // ---- 医生行 ----
  for (const doctor of doctors) {
    const stat = doctorStatsById[doctor.id];
    rows.push([
      doctor.name,
      TITLE_SHORT[doctor.title] ?? doctor.title,
      ...dates.map((date) => shiftShortAt(schedule, date, doctor.id)),
      stat ? String(stat.shouldRest) : String(rules.restDaysPerMonth),
      stat ? String(stat.actualRest) : '0',
    ]);
  }

  // ---- 每日统计 ----
  rows.push(padTail([], columnCount));
  rows.push(padTail([TEXTS.statsRowLabel], columnCount));
  for (const shift of SHIFT_ORDER) {
    rows.push([
      SHIFT_METAS[shift].label,
      '',
      ...dailyStats.map((stat) => String(stat.counts[shift])),
      '',
      '',
    ]);
  }
  rows.push([
    TEXTS.statsWorkTotal,
    '',
    ...dailyStats.map((stat) => String(stat.workTotal)),
    '',
    '',
  ]);

  return rows.map(toRow).join(EOL);
}

/**
 * 组装并触发下载，返回实际文件名供 toast 展示。
 * 下载失败（Blob / a.click 异常）会原样抛出，由调用方 toast 提示。
 */
export function exportScheduleCsv(params: CsvExportParams): string {
  const content = buildScheduleCsv(params);
  const fileName = csvFileName(params.rules.departmentName, params.month);
  downloadCsv(content, fileName);
  return fileName;
}
