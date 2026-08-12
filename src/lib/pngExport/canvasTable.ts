/**
 * PNG 导出的绘制层：把排班表画到 Canvas 2D 上（DESIGN 9.1）。
 *
 * 为什么手绘而不是 html2canvas 之类的库：
 * 表格是 sticky 冻结布局，DOM 截图方案对 `position: sticky` 的还原一向不可靠，
 * 常见结果是首列重影或表头缺失。手绘只有一份坐标计算，输出稳定且零依赖。
 *
 * 两处刻意的实现选择：
 * 1. **不用 `ctx.measureText()`**，改用字宽估算。measureText 依赖真实字体度量，
 *    在无头环境不可用，且首屏字体未就绪时会量出错误宽度。中日韩字符按 1em、
 *    其余按 0.55em 估算，对「姓名截断」这一唯一用途足够准。
 * 2. 绘制顺序是「底色 → 内容 → 网格线」。网格线最后画，才不会被单元格底色盖掉半边。
 */

import type { Doctor, MonthSchedule } from '../../types/domain';
import type { DailyStat, DoctorStat } from '../../core/stats';
import { PRIMARY_STAT_SHIFTS, SHIFT_METAS, SHIFT_ORDER, getShiftShort } from '../../constants/shifts';
import { TITLE_SHORT, WEEKDAY_NAMES } from '../../constants/palette';
import { scheduleTitle } from '../../constants/texts';
import { listMonthDates, parseDateKey } from '../date';

/**
 * 绘制所需的 Canvas 2D 能力子集。
 * 真实 `CanvasRenderingContext2D` 结构上满足它；收窄成接口是为了让无头烟测
 * 能注入记录型假上下文，验证「画了什么」而不必真起一个浏览器。
 */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
  fill(): void;
  stroke(): void;
}

export interface PngTableParams {
  /** 'YYYY-MM' */
  month: string;
  departmentName: string;
  doctors: readonly Doctor[];
  schedule: MonthSchedule;
  /** 与 `listMonthDates(month)` 同序等长 */
  dailyStats: readonly DailyStat[];
  doctorStatsById: Record<string, DoctorStat>;
}

export interface TableLayout {
  /** CSS 像素宽（未乘缩放） */
  width: number;
  height: number;
  padding: number;
  colDoctorW: number;
  colDayW: number;
  colRestW: number;
  titleH: number;
  headerH: number;
  rowH: number;
  legendRowH: number;
  dayCount: number;
  doctorCount: number;
  statsRowCount: number;
  legendRows: number;
  /** 各区块顶端 y */
  headerY: number;
  bodyY: number;
  statsY: number;
  legendY: number;
  /** 表格右边界 / 下边界 */
  tableRight: number;
  tableBottom: number;
}

/** 2x 输出，保证在 Retina 与打印时不糊 */
export const PNG_SCALE = 2;

const PADDING = 16;
const COL_DOCTOR_W = 120;
const COL_DAY_W = 40;
const COL_REST_W = 50;
const TITLE_H = 40;
const HEADER_H = 22;
const ROW_H = 28;
const LEGEND_ROW_H = 22;
const LEGEND_GAP = 12;
const LEGEND_ITEM_W = 84;

const FONT_STACK = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

/*
 * Canvas 不认识 CSS 自定义属性，这里是 tokens.css 的**手抄副本**。
 * 改 tokens.css 的对应令牌时必须同步改这里，否则导出的 PNG 会停留在旧配色。
 * 对照关系：cream→--bg-chrome，weekend→--bg-weekend，border→--border-base，
 * borderLight→--border-light，text*→--text-*。
 */
const COLORS = {
  surface: '#ffffff',
  cream: '#FFFFFF',
  weekend: '#EAF2F5',
  border: '#D2DEE3',
  borderLight: '#E4ECEF',
  textPrimary: '#0F2A33',
  textSecondary: '#4A6570',
  textTertiary: '#546E78',
  danger: '#c62828',
} as const;

function font(size: number, weight: number = 500): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

/** 字宽估算：CJK / 全角标点按 1em，其余按 0.55em */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.55;
  }
  return width;
}

/** 超宽时尾部截断加省略号；宽度足够时原样返回 */
export function ellipsize(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) {
    return text;
  }
  const chars = [...text];
  let out = '';
  for (const ch of chars) {
    if (estimateTextWidth(`${out}${ch}…`, fontSize) > maxWidth) {
      break;
    }
    out += ch;
  }
  return out === '' ? '' : `${out}…`;
}

/** 依据天数与医生数算出画布尺寸与各区块位置（DESIGN 9.1 的公式） */
export function computeTableLayout(dayCount: number, doctorCount: number): TableLayout {
  const statsRowCount = PRIMARY_STAT_SHIFTS.length;
  const width = COL_DOCTOR_W + dayCount * COL_DAY_W + COL_REST_W * 2 + PADDING * 2;
  const perRow = Math.max(1, Math.floor((width - PADDING * 2) / LEGEND_ITEM_W));
  const legendRows = Math.ceil(SHIFT_ORDER.length / perRow);

  const headerY = PADDING + TITLE_H;
  const bodyY = headerY + HEADER_H * 2;
  const statsY = bodyY + doctorCount * ROW_H;
  const tableBottom = statsY + statsRowCount * ROW_H;
  const legendY = tableBottom + LEGEND_GAP;
  const height = legendY + legendRows * LEGEND_ROW_H + PADDING;

  return {
    width,
    height,
    padding: PADDING,
    colDoctorW: COL_DOCTOR_W,
    colDayW: COL_DAY_W,
    colRestW: COL_REST_W,
    titleH: TITLE_H,
    headerH: HEADER_H,
    rowH: ROW_H,
    legendRowH: LEGEND_ROW_H,
    dayCount,
    doctorCount,
    statsRowCount,
    legendRows,
    headerY,
    bodyY,
    statsY,
    legendY,
    tableRight: PADDING + COL_DOCTOR_W + dayCount * COL_DAY_W + COL_REST_W * 2,
    tableBottom,
  };
}

/** 第 i 天所在列的左边界 x */
function dayX(layout: TableLayout, index: number): number {
  return layout.padding + layout.colDoctorW + index * layout.colDayW;
}

/** 居中绘制一段文字 */
function centerText(ctx: Ctx2D, text: string, x: number, w: number, y: number, h: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

/** 标题 + 表头两行（日号 / 星期），周末列铺浅底 */
function drawHeader(ctx: Ctx2D, params: PngTableParams, layout: TableLayout, dates: string[]): void {
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = font(20, 700);
  centerText(ctx, scheduleTitle(params.departmentName, params.month), 0, layout.width, layout.padding, layout.titleH);

  // 周末列底色贯穿表体，与屏幕上的表格观感一致
  ctx.fillStyle = COLORS.weekend;
  params.dailyStats.forEach((stat, index) => {
    if (stat.isWeekend) {
      ctx.fillRect(dayX(layout, index), layout.headerY, layout.colDayW, layout.tableBottom - layout.headerY);
    }
  });

  ctx.fillStyle = COLORS.cream;
  ctx.fillRect(layout.padding, layout.headerY, layout.colDoctorW, layout.headerH * 2);
  ctx.fillRect(layout.tableRight - layout.colRestW * 2, layout.headerY, layout.colRestW * 2, layout.headerH * 2);

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = font(12, 700);
  centerText(ctx, '医生', layout.padding, layout.colDoctorW, layout.headerY, layout.headerH * 2);
  centerText(ctx, '应休', layout.tableRight - layout.colRestW * 2, layout.colRestW, layout.headerY, layout.headerH * 2);
  centerText(ctx, '实休', layout.tableRight - layout.colRestW, layout.colRestW, layout.headerY, layout.headerH * 2);

  dates.forEach((date, index) => {
    const x = dayX(layout, index);
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = font(12, 700);
    centerText(ctx, String(parseDateKey(date).day), x, layout.colDayW, layout.headerY, layout.headerH);
    ctx.fillStyle = COLORS.textTertiary;
    ctx.font = font(11);
    const weekday = params.dailyStats[index]?.weekday ?? 0;
    centerText(ctx, WEEKDAY_NAMES[weekday] ?? '', x, layout.colDayW, layout.headerY + layout.headerH, layout.headerH);
  });
}

/** 单个医生行：色点 + 姓名 + 职称简写 + 逐日班次 + 应休/实休 */
function drawDoctorRow(
  ctx: Ctx2D,
  doctor: Doctor,
  stat: DoctorStat | undefined,
  layout: TableLayout,
  dates: string[],
  schedule: MonthSchedule,
  y: number,
): void {
  const titleShort = TITLE_SHORT[doctor.title] ?? '';
  const titleW = estimateTextWidth(titleShort, 11);

  ctx.fillStyle = doctor.color;
  ctx.beginPath();
  ctx.arc(layout.padding + 11, y + layout.rowH / 2, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = font(12, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const nameMax = layout.colDoctorW - 22 - titleW - 12;
  ctx.fillText(ellipsize(doctor.name, nameMax, 12), layout.padding + 20, y + layout.rowH / 2);

  ctx.fillStyle = COLORS.textTertiary;
  ctx.font = font(11);
  ctx.textAlign = 'right';
  ctx.fillText(titleShort, layout.padding + layout.colDoctorW - 8, y + layout.rowH / 2);

  dates.forEach((date, index) => {
    const entry = schedule[date]?.[doctor.id];
    if (!entry) {
      return;
    }
    const meta = SHIFT_METAS[entry.shiftType];
    const x = dayX(layout, index);
    ctx.fillStyle = meta.bg;
    ctx.fillRect(x + 1, y + 1, layout.colDayW - 2, layout.rowH - 2);
    ctx.fillStyle = meta.fg;
    ctx.font = font(12, 700);
    centerText(ctx, getShiftShort(entry.shiftType), x, layout.colDayW, y, layout.rowH);
  });

  const shouldRest = stat?.shouldRest ?? 0;
  const actualRest = stat?.actualRest ?? 0;
  ctx.font = font(12);
  ctx.fillStyle = COLORS.textSecondary;
  centerText(ctx, String(shouldRest), layout.tableRight - layout.colRestW * 2, layout.colRestW, y, layout.rowH);
  // 实休不足标红：这是用户扫一眼就要发现的问题，颜色是唯一够快的通道
  ctx.fillStyle = actualRest < shouldRest ? COLORS.danger : COLORS.textSecondary;
  ctx.font = font(12, actualRest < shouldRest ? 700 : 500);
  centerText(ctx, String(actualRest), layout.tableRight - layout.colRestW, layout.colRestW, y, layout.rowH);
}

/** 底部统计行：门 / 白 / 夜，越界数字标红 */
function drawStatsRows(ctx: Ctx2D, stats: readonly DailyStat[], layout: TableLayout): void {
  PRIMARY_STAT_SHIFTS.forEach((shift, rowIndex) => {
    const y = layout.statsY + rowIndex * layout.rowH;
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(layout.padding, y, layout.colDoctorW, layout.rowH);
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = font(12, 700);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(SHIFT_METAS[shift].label, layout.padding + 10, y + layout.rowH / 2);

    stats.forEach((stat, index) => {
      const ranged = shift === 'dayShift' ? stat.dayShift : shift === 'nightShift' ? stat.nightShift : null;
      const bad = ranged !== null && (ranged.status === 'below' || ranged.status === 'above');
      ctx.fillStyle = bad ? COLORS.danger : COLORS.textSecondary;
      ctx.font = font(12, bad ? 700 : 500);
      centerText(ctx, String(stat.counts[shift]), dayX(layout, index), layout.colDayW, y, layout.rowH);
    });
  });
}

/** 图例：11 个色块自动换行 */
function drawLegend(ctx: Ctx2D, layout: TableLayout): void {
  const perRow = Math.max(1, Math.floor((layout.width - layout.padding * 2) / LEGEND_ITEM_W));
  SHIFT_ORDER.forEach((shift, index) => {
    const meta = SHIFT_METAS[shift];
    const x = layout.padding + (index % perRow) * LEGEND_ITEM_W;
    const y = layout.legendY + Math.floor(index / perRow) * layout.legendRowH;
    ctx.fillStyle = meta.bg;
    ctx.fillRect(x, y + 4, 14, 14);
    ctx.strokeStyle = COLORS.borderLight;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + 14, y + 4);
    ctx.lineTo(x + 14, y + 18);
    ctx.lineTo(x, y + 18);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = font(11);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${meta.short} ${meta.label}`, x + 19, y + 11);
  });
}

/** 网格线最后画，避免被单元格底色盖住 */
function drawGrid(ctx: Ctx2D, layout: TableLayout): void {
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();

  const rowTops: number[] = [layout.headerY, layout.headerY + layout.headerH];
  for (let i = 0; i <= layout.doctorCount + layout.statsRowCount; i += 1) {
    rowTops.push(layout.bodyY + i * layout.rowH);
  }
  for (const y of rowTops) {
    ctx.moveTo(layout.padding, y);
    ctx.lineTo(layout.tableRight, y);
  }

  const colXs: number[] = [layout.padding, layout.padding + layout.colDoctorW];
  for (let i = 1; i <= layout.dayCount; i += 1) {
    colXs.push(dayX(layout, i));
  }
  colXs.push(layout.tableRight - layout.colRestW, layout.tableRight);
  for (const x of colXs) {
    ctx.moveTo(x, layout.headerY);
    ctx.lineTo(x, layout.tableBottom);
  }

  ctx.stroke();
}

/** 把整张排班表画到上下文里。调用方需先完成 `scale(PNG_SCALE, PNG_SCALE)` */
export function drawScheduleTable(ctx: Ctx2D, params: PngTableParams, layout: TableLayout): void {
  const dates = listMonthDates(params.month);

  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawHeader(ctx, params, layout, dates);
  params.doctors.forEach((doctor, index) => {
    drawDoctorRow(
      ctx,
      doctor,
      params.doctorStatsById[doctor.id],
      layout,
      dates,
      params.schedule,
      layout.bodyY + index * layout.rowH,
    );
  });
  drawStatsRows(ctx, params.dailyStats, layout);
  drawLegend(ctx, layout);
  drawGrid(ctx, layout);
}
