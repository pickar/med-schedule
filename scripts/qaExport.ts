// QA-02 导出内容正确性：CSV 文本 + PNG 布局。
//
// 被测：src/lib/csvExport.ts (buildScheduleCsv / exportScheduleCsv)
//       src/lib/download.ts  (downloadCsv 的 BOM 注入)
//       src/lib/pngExport/canvasTable.ts (computeTableLayout)
//       src/constants/texts.ts (csvFileName / pngFileName)
//
// 关注点不是「能不能导出」，是「导出的内容对不对」：
//   · BOM 真的写进去了吗（Excel 中文乱码的根因）——本脚本用假 Blob/DOM
//     拦截真实下载链路验证，而不是只读常量
//   · 含逗号 / 引号 / 换行的字段是否按 RFC 4180 转义
//   · 日期列数是否等于当月天数（2 月 / 闰年 / 大小月）
//   · 统计行数值是否与 computeDerived 的产出一致（导出与屏幕必须对得上）
//   · 每行列数是否一致（列数不齐会让 Excel 整体错位）
//
// 运行：vite build --ssr scripts/qaExport.ts --outDir <tmp> && node <tmp>/qaExport.js

import './smokeShim';

// ---- 下载链路拦截：必须在 import download.ts 之前装好 ----
interface CapturedDownload {
  content: string;
  mime: string;
  fileName: string;
}
const downloads: CapturedDownload[] = [];
let pendingBlob: { content: string; mime: string } | null = null;

class FakeBlob {
  constructor(parts: unknown[], opts?: { type?: string }) {
    pendingBlob = { content: parts.map((p) => String(p)).join(''), mime: opts?.type ?? '' };
  }
}
(globalThis as unknown as { Blob: unknown }).Blob = FakeBlob;
(URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => 'blob:qa';
(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({
    href: '',
    download: '',
    rel: '',
    style: {} as Record<string, string>,
    click(this: { download: string }): void {
      if (pendingBlob) {
        downloads.push({ ...pendingBlob, fileName: this.download });
        pendingBlob = null;
      }
    },
  }),
  body: { appendChild: () => undefined, removeChild: () => undefined },
};

import type { Doctor, MonthSchedule, Rules } from '../src/types/domain';
import { buildScheduleCsv, exportScheduleCsv } from '../src/lib/csvExport';
import { UTF8_BOM } from '../src/lib/download';
import { computeTableLayout } from '../src/lib/pngExport/canvasTable';
import { computeDerived } from '../src/core/stats';
import { createDefaultRules } from '../src/constants/defaults';
import { csvFileName, pngFileName, scheduleTitle } from '../src/constants/texts';
import { SHIFT_ORDER, SHIFT_METAS } from '../src/constants/shifts';
import { WEEKDAY_NAMES } from '../src/constants/palette';
import { getDaysInMonth, getWeekday, listMonthDates } from '../src/lib/date';
import { generateSchedule } from '../src/core/generator';

const fails: string[] = [];
let total = 0;

function check(name: string, cond: boolean, extra = ''): void {
  total += 1;
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function makeDoctor(id: string, name: string, over: Partial<Doctor> = {}): Doctor {
  return {
    id,
    name,
    title: '主治医师',
    color: '#6D4C41',
    fixedClinicDays: [],
    constraints: { noDayShift: false, noNightShift: false, weekendOff: false },
    leaves: [],
    ...over,
  };
}

/** 极简 CSV 解析器（支持引号包裹与转义），用于把导出文本还原成二维数组做断言 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 2;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** 组装一份可导出的完整场景 */
function buildScenario(month: string, doctors: Doctor[], rules: Rules) {
  const gen = generateSchedule({ month, doctors, rules });
  const derived = computeDerived({ month, schedule: gen.schedule, doctors, rules });
  return {
    schedule: gen.schedule,
    derived,
    params: {
      month,
      rules,
      doctors,
      schedule: gen.schedule,
      dailyStats: derived.dailyStats,
      doctorStatsById: derived.doctorStatsById,
    },
  };
}

console.log('\n===== QA-02 导出内容正确性 =====\n');

// ---------- [1] BOM 端到端 ----------
console.log('[1] UTF-8 BOM（Excel 中文乱码根因）');
{
  const doctors = [makeDoctor('d1', '张伟')];
  const rules = createDefaultRules();
  const sc = buildScenario('2026-08', doctors, rules);

  const raw = buildScheduleCsv(sc.params);
  check('buildScheduleCsv 本身不含 BOM（BOM 由下载层统一加）', !raw.startsWith(UTF8_BOM));

  downloads.length = 0;
  const fileName = exportScheduleCsv(sc.params);
  check('exportScheduleCsv 触发了一次下载', downloads.length === 1, `实际 ${downloads.length}`);
  if (downloads.length === 1) {
    const dl = downloads[0];
    check('下载内容以 UTF-8 BOM (U+FEFF) 开头', dl.content.startsWith('\uFEFF'),
      `实际首字符 U+${dl.content.charCodeAt(0).toString(16).toUpperCase()}`);
    check('BOM 之后紧跟标题行（无多余字符）', dl.content.slice(1).startsWith('内分泌科 · 2026年8月排班表'));
    check('MIME 为 text/csv;charset=utf-8', dl.mime === 'text/csv;charset=utf-8', `实际 ${dl.mime}`);
    check('文件名与 csvFileName 一致', dl.fileName === fileName && fileName === '内分泌科202608排班表.csv', `实际 ${dl.fileName}`);
  }
  check('行尾使用 CRLF', raw.includes('\r\n'));
  check('不存在裸 LF（未被 CR 前导）', !/[^\r]\n/.test(raw));
}

// ---------- [2] 日期列数 = 当月天数 ----------
console.log('\n[2] 日期列数 vs 当月天数（大小月 / 闰年）');
{
  const doctors = [makeDoctor('d1', '张伟'), makeDoctor('d2', '李娜')];
  const rules = createDefaultRules();
  const months: Array<[string, number, string]> = [
    ['2026-01', 31, '大月'],
    ['2026-02', 28, '平年 2 月'],
    ['2028-02', 29, '闰年 2 月'],
    ['2100-02', 28, '百年非闰（2100 不是闰年）'],
    ['2000-02', 29, '四百年闰（2000 是闰年）'],
    ['2026-04', 30, '小月'],
    ['2026-12', 31, '年末'],
  ];
  for (const [month, expectDays, label] of months) {
    check(`${month} getDaysInMonth = ${expectDays}（${label}）`, getDaysInMonth(month) === expectDays, `实际 ${getDaysInMonth(month)}`);
    const sc = buildScenario(month, doctors, rules);
    const rows = parseCsv(buildScheduleCsv(sc.params));
    const header = rows[2];
    // 列结构：医生 + 职称 + N 天 + 应休 + 实休
    check(`  ${month} 表头列数 = 2 + ${expectDays} + 2`, header.length === expectDays + 4, `实际 ${header.length}`);
    const dayCells = header.slice(2, 2 + expectDays);
    check(`  ${month} 日期列为 1..${expectDays} 连续`,
      dayCells.every((c, i) => c === String(i + 1)),
      `首尾 ${dayCells[0]}..${dayCells[dayCells.length - 1]}`);
    const weekdayRow = rows[3];
    check(`  ${month} 星期行长度与表头一致`, weekdayRow.length === header.length);
    // 逐日核对星期与真实日期对齐（能抓出 UTC/本地时区导致的整体错位一天）
    const dates = listMonthDates(month);
    const wrongWeekday = dates
      .map((date, i) => ({ date, got: weekdayRow[2 + i], want: WEEKDAY_NAMES[getWeekday(date)] }))
      .filter((x) => x.got !== x.want);
    check(`  ${month} 星期与真实日期逐日对齐`, wrongWeekday.length === 0,
      wrongWeekday.length > 0 ? `首例 ${wrongWeekday[0].date} 期望「${wrongWeekday[0].want}」实际「${wrongWeekday[0].got}」` : '');
  }
}

// ---------- [3] 每行列数一致（Excel 错位防线） ----------
console.log('\n[3] 全表列数一致性');
{
  const doctors = [makeDoctor('d1', '张伟'), makeDoctor('d2', '李娜'), makeDoctor('d3', '王芳')];
  const rules = createDefaultRules();
  for (const month of ['2026-02', '2026-08', '2028-02']) {
    const sc = buildScenario(month, doctors, rules);
    const rows = parseCsv(buildScheduleCsv(sc.params));
    const widths = new Set(rows.map((r) => r.length));
    check(`${month} 所有行列数一致（共 ${rows.length} 行）`, widths.size === 1,
      `出现 ${widths.size} 种列宽: ${JSON.stringify([...widths])}`);
  }
}

// ---------- [4] 特殊字符转义（RFC 4180） ----------
console.log('\n[4] 逗号 / 引号 / 换行转义');
{
  const doctors = [
    makeDoctor('d1', '张,伟'),
    makeDoctor('d2', '李"娜"'),
    makeDoctor('d3', '王\n芳'),
    makeDoctor('d4', '刘,"洋"\n二'),
  ];
  const rules = createDefaultRules();
  rules.departmentName = '内分泌,科"特需"';
  const sc = buildScenario('2026-08', doctors, rules);
  const text = buildScheduleCsv(sc.params);

  check('含逗号的字段被引号包裹', text.includes('"张,伟"'));
  check('内部双引号被翻倍转义', text.includes('"李""娜"""'), '期望 李"娜" → "李""娜"""');
  check('含换行的字段被引号包裹', text.includes('"王\n芳"'));
  check('科室名中的逗号与引号一并转义', text.includes('"内分泌,科""特需"" · 2026年8月排班表"'));

  // 往返：解析回来必须与原始姓名逐字相等
  const rows = parseCsv(text);
  const names = rows.slice(4, 8).map((r) => r[0]);
  check('往返解析后姓名逐字还原', JSON.stringify(names) === JSON.stringify(['张,伟', '李"娜"', '王\n芳', '刘,"洋"\n二']),
    `实际 ${JSON.stringify(names)}`);
  check('转义未破坏列数一致性', new Set(rows.map((r) => r.length)).size === 1,
    `列宽种类 ${JSON.stringify([...new Set(rows.map((r) => r.length))])}`);
}

// ---------- [5] 统计行数值与派生数据一致 ----------
console.log('\n[5] 统计行 vs computeDerived（导出与屏幕必须对得上）');
{
  const doctors = [
    makeDoctor('d1', '张伟', { fixedClinicDays: [1, 4], constraints: { noDayShift: false, noNightShift: true, weekendOff: true } }),
    makeDoctor('d2', '李娜', { fixedClinicDays: [2] }),
    makeDoctor('d3', '王芳', { fixedClinicDays: [3, 5] }),
    makeDoctor('d4', '刘洋'),
    makeDoctor('d5', '陈明'),
    makeDoctor('d6', '赵强'),
  ];
  const rules = createDefaultRules();
  const month = '2026-08';
  const sc = buildScenario(month, doctors, rules);
  const rows = parseCsv(buildScheduleCsv(sc.params));
  const dates = listMonthDates(month);
  const dayCount = dates.length;

  // 定位统计区：标题(0) 空(1) 表头(2) 星期(3) 医生×6(4..9) 空(10) 每日统计标签(11) 11 个班次(12..22) 在岗合计(23)
  const labelRowIndex = rows.findIndex((r) => r[0] === '每日统计');
  check('存在「每日统计」标签行', labelRowIndex > 0, `实际索引 ${labelRowIndex}`);

  let mismatches = 0;
  let firstMismatch = '';
  for (let s = 0; s < SHIFT_ORDER.length; s += 1) {
    const shift = SHIFT_ORDER[s];
    const row = rows[labelRowIndex + 1 + s];
    if (row[0] !== SHIFT_METAS[shift].label) {
      mismatches += 1;
      firstMismatch = firstMismatch || `第 ${s} 行标签期望 ${SHIFT_METAS[shift].label} 实际 ${row[0]}`;
      continue;
    }
    for (let i = 0; i < dayCount; i += 1) {
      const csvVal = Number(row[2 + i]);
      const expect = sc.derived.dailyStats[i].counts[shift];
      if (csvVal !== expect) {
        mismatches += 1;
        firstMismatch = firstMismatch || `${dates[i]} ${SHIFT_METAS[shift].label} CSV=${csvVal} 派生=${expect}`;
      }
    }
  }
  check('11 种班次的每日统计与 dailyStats 完全一致', mismatches === 0, `${mismatches} 处不符，首例：${firstMismatch}`);

  const workRow = rows[labelRowIndex + 1 + SHIFT_ORDER.length];
  check('「在岗合计」行存在', workRow[0] === '在岗合计', `实际 ${workRow[0]}`);
  let workMismatch = 0;
  for (let i = 0; i < dayCount; i += 1) {
    if (Number(workRow[2 + i]) !== sc.derived.dailyStats[i].workTotal) {
      workMismatch += 1;
    }
  }
  check('在岗合计与 dailyStats.workTotal 一致', workMismatch === 0, `${workMismatch} 处不符`);

  // 交叉验证：统计行应等于医生行里该班次出现次数
  let crossMismatch = 0;
  for (let i = 0; i < dayCount; i += 1) {
    const colIdx = 2 + i;
    const countsFromBody: Record<string, number> = {};
    for (let d = 0; d < doctors.length; d += 1) {
      const short = rows[4 + d][colIdx];
      if (short !== '') {
        countsFromBody[short] = (countsFromBody[short] ?? 0) + 1;
      }
    }
    for (const shift of SHIFT_ORDER) {
      const short = SHIFT_METAS[shift].short;
      const fromBody = countsFromBody[short] ?? 0;
      const fromStats = sc.derived.dailyStats[i].counts[shift];
      if (fromBody !== fromStats) {
        crossMismatch += 1;
      }
    }
  }
  check('统计行 = 医生行实际班次计数（自洽交叉验证）', crossMismatch === 0, `${crossMismatch} 处不符`);

  // 应休 / 实休
  let restMismatch = 0;
  for (let d = 0; d < doctors.length; d += 1) {
    const row = rows[4 + d];
    const stat = sc.derived.doctorStatsById[doctors[d].id];
    if (Number(row[2 + dayCount]) !== stat.shouldRest || Number(row[3 + dayCount]) !== stat.actualRest) {
      restMismatch += 1;
    }
  }
  check('应休 / 实休列与 doctorStats 一致', restMismatch === 0, `${restMismatch} 位医生不符`);
  check('应休列等于 rules.restDaysPerMonth',
    rows.slice(4, 4 + doctors.length).every((r) => Number(r[2 + dayCount]) === rules.restDaysPerMonth));
}

// ---------- [6] 空排班导出 ----------
console.log('\n[6] 空数据与边界规模');
{
  const rules = createDefaultRules();
  // 无医生 + 无排班
  const derived0 = computeDerived({ month: '2026-08', schedule: {}, doctors: [], rules });
  let threw = '';
  let text0 = '';
  try {
    text0 = buildScheduleCsv({
      month: '2026-08', rules, doctors: [], schedule: {},
      dailyStats: derived0.dailyStats, doctorStatsById: derived0.doctorStatsById,
    });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check('无医生无排班时 buildScheduleCsv 不抛异常', threw === '', threw);
  if (threw === '') {
    const rows = parseCsv(text0);
    check('  仍输出完整表头与统计骨架', rows.length > 10 && rows[2][0] === '医生');
    check('  列数一致', new Set(rows.map((r) => r.length)).size === 1);
    check('  所有统计值为 0', rows.slice(-12).every((r) => r.slice(2, 2 + 31).every((c) => c === '' || c === '0')));
  }

  // 医生存在但无排班
  const doctors = [makeDoctor('d1', '张伟')];
  const derived1 = computeDerived({ month: '2026-08', schedule: {}, doctors, rules });
  const text1 = buildScheduleCsv({
    month: '2026-08', rules, doctors, schedule: {},
    dailyStats: derived1.dailyStats, doctorStatsById: derived1.doctorStatsById,
  });
  const rows1 = parseCsv(text1);
  check('有医生无排班：医生行存在且班次列全空', rows1[4][0] === '张伟' && rows1[4].slice(2, 33).every((c) => c === ''));
}

// ---------- [7] 文件名规则 ----------
console.log('\n[7] 文件名规则（CSV 补零 / PNG 不补零，竞品原始差异）');
{
  check('csvFileName 月份补零', csvFileName('内分泌科', '2026-08') === '内分泌科202608排班表.csv', csvFileName('内分泌科', '2026-08'));
  check('csvFileName 两位数月份', csvFileName('内分泌科', '2026-12') === '内分泌科202612排班表.csv');
  check('pngFileName 月份不补零', pngFileName('2026-08') === '2026年8月排班表.png', pngFileName('2026-08'));
  check('pngFileName 两位数月份保持原样', pngFileName('2026-12') === '2026年12月排班表.png');
  check('scheduleTitle 月份不补零', scheduleTitle('内分泌科', '2026-08') === '内分泌科 · 2026年8月排班表');
  check('科室名含特殊字符时文件名原样拼接', csvFileName('儿科(门诊)', '2026-08') === '儿科(门诊)202608排班表.csv');
}

// ---------- [8] PNG 布局计算 ----------
console.log('\n[8] PNG 布局 computeTableLayout');
{
  const l31x10 = computeTableLayout(31, 10);
  const l28x10 = computeTableLayout(28, 10);
  const l31x30 = computeTableLayout(31, 30);
  const l0x0 = computeTableLayout(0, 0);

  for (const [label, l] of [['31×10', l31x10], ['28×10', l28x10], ['31×30', l31x30]] as const) {
    check(`${label} 宽高为正有限数`, Number.isFinite(l.width) && Number.isFinite(l.height) && l.width > 0 && l.height > 0);
    check(`${label} 表格右边界不超出画布宽`, l.tableRight <= l.width, `right=${l.tableRight} width=${l.width}`);
    check(`${label} 表格底边不超出画布高`, l.tableBottom <= l.height, `bottom=${l.tableBottom} height=${l.height}`);
    check(`${label} 图例区在表格下方且不溢出`, l.legendY >= l.tableBottom && l.legendY + l.legendRows * l.legendRowH <= l.height);
    check(`${label} 分区纵坐标单调递增`, l.headerY < l.bodyY && l.bodyY <= l.statsY && l.statsY < l.tableBottom);
  }

  check('天数增加则宽度增加（31 天 > 28 天）', l31x10.width > l28x10.width);
  check('宽度差 = 3 × 单日列宽', l31x10.width - l28x10.width === 3 * l31x10.colDayW,
    `差 ${l31x10.width - l28x10.width}, colDayW=${l31x10.colDayW}`);
  check('医生数增加则高度增加（30 人 > 10 人）', l31x30.height > l31x10.height);
  check('高度差 = 20 × 行高', l31x30.height - l31x10.height === 20 * l31x10.rowH,
    `差 ${l31x30.height - l31x10.height}, rowH=${l31x10.rowH}`);
  check('统计行数 = 3（门诊/白班/夜班）', l31x10.statsRowCount === 3, `实际 ${l31x10.statsRowCount}`);
  check('图例行数 ≥ 1 且足以容纳 11 种班次', l31x10.legendRows >= 1 && l31x10.legendRows <= SHIFT_ORDER.length);
  check('0 天 0 医生不产生负数 / NaN',
    Number.isFinite(l0x0.width) && Number.isFinite(l0x0.height) && l0x0.width > 0 && l0x0.height > 0 && l0x0.legendRows >= 1,
    `width=${l0x0.width} height=${l0x0.height} legendRows=${l0x0.legendRows}`);
  check('医生行区高度 = 医生数 × 行高', l31x10.statsY - l31x10.bodyY === 10 * l31x10.rowH);

  // 2x 像素密度约定（PRD P0-12.3）
  const l = computeTableLayout(31, 30);
  check('31 天 × 30 人在 2x 下画布未超 Canvas 常见上限 (32767px)', l.width * 2 < 32767 && l.height * 2 < 32767,
    `2x = ${l.width * 2}×${l.height * 2}`);
}

// ---------- [9] 长姓名与超宽内容 ----------
console.log('\n[9] 长内容不破坏结构');
{
  const longName = '欧阳'.repeat(20);
  const doctors = [makeDoctor('d1', longName)];
  const rules = createDefaultRules();
  rules.departmentName = '科'.repeat(80);
  const sc = buildScenario('2026-08', doctors, rules);
  const rows = parseCsv(buildScheduleCsv(sc.params));
  check('超长姓名不破坏列数', new Set(rows.map((r) => r.length)).size === 1);
  check('超长姓名原样写入（CSV 不截断）', rows[4][0] === longName);
  check('超长科室名原样写入标题', rows[0][0].includes('科'.repeat(80)));
}

console.log(`\n---- QA-02 结果：${total - fails.length}/${total} 通过 ----`);
console.log(fails.length === 0 ? 'QA-02 PASS' : `QA-02 FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
