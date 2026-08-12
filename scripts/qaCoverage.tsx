/**
 * QA-04 需求覆盖 / 竞品文案对齐 / 可访问性数值验证。
 *
 * 三块内容：
 *   A. 竞品原文逐字比对（_ref/competitor-analysis.md 为唯一事实源）
 *   B. P0-4.2 对比度 ≥ 4.5:1 —— WCAG 相对亮度公式实算，此前无任何测试覆盖
 *   C. P0 各条可静态验证的验收标准（存储 key / 常量 / 枚举完整性 / 文件名规则 / 校验类型数）
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { TEXTS, WEEKDAY_LABELS, csvFileName, pngFileName, scheduleTitle } from '../src/constants/texts';
import { SHIFT_METAS, SHIFT_ORDER } from '../src/constants/shifts';
import { DOCTOR_COLORS, DOCTOR_TITLES, WEEKDAY_NAMES } from '../src/constants/palette';
import {
  MAX_REST_DAYS,
  MAX_SHIFT_COUNT,
  MIN_REST_DAYS,
  MIN_SHIFT_COUNT,
  SAVE_DEBOUNCE_MS,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  VALIDATE_DEBOUNCE_MS,
  createDefaultRules,
  createSampleDoctors,
  scheduleStorageKey,
} from '../src/constants/defaults';
import { VIOLATION_SEVERITY } from '../src/core/validator/messages';
import { EmptyState } from '../src/components/ScheduleTable/EmptyState';

let passed = 0;
const fails: string[] = [];
const notes: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra ? `-> ${extra}` : ''}`);
  }
}
function note(msg: string): void {
  notes.push(msg);
  console.log(`  note ${msg}`);
}
function group(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// ==================== A. 竞品原文逐字比对 ====================
group('A 竞品原文逐字比对（_ref/competitor-analysis.md）');

/** 左边是竞品原文（人工从 md 摘录），右边是实现值，必须全等 */
const VERBATIM: { label: string; expect: string; actual: string }[] = [
  { label: '空状态标题', expect: '还没有排班表', actual: TEXTS.emptyTitle },
  { label: '空状态副标题', expect: '点击「生成排班」按钮，一键生成本月排班', actual: TEXTS.emptySubtitle },
  { label: '引导步骤 1 标题', expect: '1. 添加医生', actual: TEXTS.step1Title },
  { label: '引导步骤 1 说明', expect: '设置医生姓名、固定门诊日', actual: TEXTS.step1Desc },
  { label: '引导步骤 2 标题', expect: '2. 配置规则', actual: TEXTS.step2Title },
  { label: '引导步骤 2 说明', expect: '设置班次人数、休息天数', actual: TEXTS.step2Desc },
  { label: '引导步骤 3 标题', expect: '3. 一键生成', actual: TEXTS.step3Title },
  { label: '引导步骤 3 说明', expect: '点击生成排班，自动分配', actual: TEXTS.step3Desc },
  { label: '不上白班约束', expect: '不上白班（仅适合只上门诊/夜班的医生）', actual: TEXTS.noDayShiftLabel },
  { label: '不上夜班约束', expect: '不上夜班', actual: TEXTS.noNightShiftLabel },
  { label: '周末不上班约束', expect: '周末不上班（若有固定门诊日则优先门诊）', actual: TEXTS.weekendOffLabel },
  { label: '月休天数说明', expect: '不含夜下休和周末固定休息', actual: TEXTS.restDaysHint },
  {
    label: '人数区间提示',
    expect: '左侧按钮调最小值，右侧按钮调最大值。系统会尽量安排到上限，人数不足时取下限。',
    actual: TEXTS.shiftCountHint,
  },
  { label: '夜下休提示', expect: '值夜班后第二天自动安排夜下休', actual: TEXTS.postNightRestHint },
  { label: '禁连夜提示', expect: '值夜班后第二天不安排夜班（夜下休当天自然不会排）', actual: TEXTS.noConsecutiveNightHint },
  { label: '随机模式标签', expect: '随机分配一人（不显示轮流标记）', actual: TEXTS.randomModeLabel },
  { label: '重新生成确认', expect: '确定要重新生成排班吗？当前手动调整将丢失。', actual: TEXTS.regenerateConfirm },
  { label: '休息不足标题', expect: '以下医生休息天数不足', actual: TEXTS.restShortageTitle },
  { label: 'PNG 失败提示', expect: '导出图片失败，请重试', actual: TEXTS.pngFailed },
  { label: '改班选择器标题', expect: '选择班次 - 8月3日', actual: TEXTS.pickerTitle(8, 3) },
];

for (const v of VERBATIM) {
  check(`原文一致：${v.label}`, v.expect === v.actual, `期望「${v.expect}」实际「${v.actual}」`);
}

// PRD 额外要求的原文（PRD 4.1 章节内引号文案）
check('PRD P0-5.6 无医生提示', TEXTS.noDoctorWarning === '请先添加至少 1 位医生', TEXTS.noDoctorWarning);
check('PRD P0-9.4 全员达标文案', TEXTS.restAllOk === '全员休息天数达标 ✅', TEXTS.restAllOk);
check('PRD P0-1.5 存储失败告警', TEXTS.storageFailed === '数据未能保存到本地，请勿关闭页面', TEXTS.storageFailed);
check('PRD P0-10.3 定位按钮', TEXTS.violationLocate === '定位', TEXTS.violationLocate);

// 空状态实际渲染是否真的把这些字吐出来（防止常量写对了但组件没用）
const emptyHtml = renderToStaticMarkup(<EmptyState hasDoctor />);
const emptyHtmlNoDoctor = renderToStaticMarkup(<EmptyState hasDoctor={false} />);
check('空状态渲染含标题「还没有排班表」', emptyHtml.includes('还没有排班表'));
check('空状态（有医生）渲染含 emptySubtitle', emptyHtml.includes(TEXTS.emptySubtitle));
check('空状态（无医生）渲染含 emptyNeedSetup', emptyHtmlNoDoctor.includes(TEXTS.emptyNeedSetup));
check(
  '空状态渲染含完整三步引导',
  ['1. 添加医生', '设置医生姓名、固定门诊日', '2. 配置规则', '设置班次人数、休息天数', '3. 一键生成', '点击生成排班，自动分配'].every(
    (s) => emptyHtml.includes(s),
  ),
);

// ==================== B. P0-4.2 对比度实算 ====================
group('B P0-4.2 班次配色对比度 ≥ 4.5:1（WCAG 2.1 相对亮度实算）');

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

check('班次共 11 种', SHIFT_ORDER.length === 11 && Object.keys(SHIFT_METAS).length === 11, String(SHIFT_ORDER.length));

const contrastTable: string[] = [];
for (const key of SHIFT_ORDER) {
  const m = SHIFT_METAS[key];
  const ratio = contrast(m.fg, m.bg);
  contrastTable.push(`${m.label}(${m.short}) ${m.fg}/${m.bg} = ${ratio}:1`);
  check(`对比度 ${m.label}「${m.short}」= ${ratio}:1 ≥ 4.5`, ratio >= 4.5, `${m.fg} on ${m.bg}`);
}
console.log(`  对比度明细：\n    ${contrastTable.join('\n    ')}`);

// 医生标识色用于白底文字 / 色点，一并核一遍
for (const c of DOCTOR_COLORS) {
  const ratio = contrast(c, '#FFFFFF');
  if (ratio < 4.5) {
    note(`医生标识色 ${c} 在白底上对比度仅 ${ratio}:1（若仅作色点圆环则不违反 WCAG 文本要求）`);
  }
}
check(
  '医生标识色 12 个且互不重复',
  DOCTOR_COLORS.length === 12 && new Set(DOCTOR_COLORS).size === 12,
  String(DOCTOR_COLORS.length),
);

// ==================== C. P0 静态验收标准 ====================
group('C P0 验收标准静态核查');

// --- P0-1 数据基座 ---
check('P0-1.1 存储 key = warmshift:v1:doctors', STORAGE_KEYS.doctors === 'warmshift:v1:doctors', STORAGE_KEYS.doctors);
check('P0-1.1 存储 key = warmshift:v1:rules', STORAGE_KEYS.rules === 'warmshift:v1:rules', STORAGE_KEYS.rules);
check(
  'P0-1.1 排班按 YYYY-MM 分月存',
  scheduleStorageKey('2026-08') === 'warmshift:v1:schedules:2026-08',
  scheduleStorageKey('2026-08'),
);
check('P0-1.2 自动保存防抖 = 500ms', SAVE_DEBOUNCE_MS === 500, String(SAVE_DEBOUNCE_MS));
check('P0-1.4 存在 schemaVersion 且 >= 1', SCHEMA_VERSION >= 1, String(SCHEMA_VERSION));
check('P0-1.6 清空全部数据有二次确认文案', TEXTS.clearAllConfirm.length > 0 && TEXTS.clearAllDetail.length > 0);

// --- P0-2 医生名册 ---
check('P0-2.1 职称 4 种且顺序对齐竞品', JSON.stringify(DOCTOR_TITLES) === JSON.stringify(['主任医师', '副主任医师', '主治医师', '住院医师']), JSON.stringify(DOCTOR_TITLES));
const samples = createSampleDoctors();
check(
  'P0-2.6 示例医生 10 位且姓名顺序与示例数据一致',
  JSON.stringify(samples.map((d) => d.name)) ===
    JSON.stringify(['林涛', '苏晴', '郑昊', '何静', '马俊', '高翔', '罗薇', '宋宇', '韩雪', '邓超']),
  JSON.stringify(samples.map((d) => d.name)),
);
check('P0-2.3 示例医生颜色互不重复', new Set(samples.map((d) => d.color)).size === 10);
check('P0-2.1 示例医生 fixedClinicDays 均在 0-6', samples.every((d) => d.fixedClinicDays.every((w) => w >= 0 && w <= 6)));
check('P0-2.4 删除医生确认文案存在', TEXTS.doctorDeleteConfirm('张伟').includes('张伟'));
check('P0-2.3 同名提示存在（提示但不阻断）', TEXTS.doctorNameDuplicated.length > 0);

// --- P0-3 规则 ---
const dr = createDefaultRules();
check('P0-3.1 默认科室名 = 内分泌科', dr.departmentName === '内分泌科', dr.departmentName);
check('P0-3.2 7 个 weekday 全部有配置', Object.keys(dr.shiftsByWeekday).length === 7);
check(
  'P0-3.2 默认区间白班 2-3 / 夜班 1-1',
  Object.values(dr.shiftsByWeekday).every(
    (c) => c.dayShift.min === 2 && c.dayShift.max === 3 && c.nightShift.min === 1 && c.nightShift.max === 1,
  ),
);
check('P0-3.2 人数范围常量 0-20', MIN_SHIFT_COUNT === 0 && MAX_SHIFT_COUNT === 20, `${MIN_SHIFT_COUNT}-${MAX_SHIFT_COUNT}`);
check('P0-3.4 默认月休 = 8', dr.restDaysPerMonth === 8, String(dr.restDaysPerMonth));
check('P0-3.4 月休范围常量 0-31', MIN_REST_DAYS === 0 && MAX_REST_DAYS === 31, `${MIN_REST_DAYS}-${MAX_REST_DAYS}`);
check('P0-3.5 禁止连续夜班默认开', dr.rules.noConsecutiveNightShift === true);
check('P0-3.6 三种轮流模式文案齐备', [TEXTS.rotationModeAll, TEXTS.rotationModeSelected, TEXTS.rotationModeRandom].every((s) => s.length > 0));
check('P0-3.6 selected 空名单有提示', TEXTS.rotationSelectedEmpty.length > 0);

// --- P0-4 班次体系 ---
const SHIFT_SPEC: [string, string, string][] = [
  ['clinic', '门诊', '门'],
  ['expertClinic', '专家门诊', '专'],
  ['emergency', '急诊', '急'],
  ['dayShift', '白班', '白'],
  ['nightShift', '夜班', '夜'],
  ['continuousShift', '连班', '连'],
  ['deputyShift', '副班', '副'],
  ['chiefDuty', '总值班', '总'],
  ['ward', '病房', '病'],
  ['rest', '休息', '休'],
  ['postNightRest', '夜下休', '夜下'],
];
for (const [key, label, short] of SHIFT_SPEC) {
  const m = SHIFT_METAS[key as keyof typeof SHIFT_METAS];
  check(`P0-4.1 班次 ${key} = ${label}/${short}`, !!m && m.label === label && m.short === short, m ? `${m.label}/${m.short}` : 'MISSING');
}
check('P0-4.1 SHIFT_ORDER 顺序与竞品表一致', JSON.stringify(SHIFT_ORDER) === JSON.stringify(SHIFT_SPEC.map((s) => s[0])), JSON.stringify(SHIFT_ORDER));
check('P0-4 rest / postNightRest 的 isWork = false', SHIFT_METAS.rest.isWork === false && SHIFT_METAS.postNightRest.isWork === false);
check(
  'P0-4 急诊/连班/副班/总值班 不自动分配',
  (['emergency', 'continuousShift', 'deputyShift', 'chiefDuty'] as const).every((k) => SHIFT_METAS[k].autoAssignable === false),
);
check('P0-4 图例文案存在', TEXTS.legendTitle.length > 0 && TEXTS.legendDayNightNote.length > 0);

// --- P0-5 生成 ---
check('P0-5.5 重新生成确认文案（含锁定格变体）', TEXTS.regenerateConfirmLocked(3).includes('3'));
check('P0-5.7 生成 loading 文案存在', TEXTS.generating.length > 0);
check('P0-5.8 生成结果摘要文案存在', TEXTS.generateSuccessWithIssues(8, 10, 2).includes('8') && TEXTS.generateSuccessWithIssues(8, 10, 2).includes('2'));

// --- P0-7 手动改班 ---
check('P0-7.2 选择器含「清空」选项文案', TEXTS.cellClear === '清空', TEXTS.cellClear);
check('P0-7.5 手动修改标记文案', TEXTS.cellManualMark.length > 0);
check('P0-7.6 夜班次日夜下休建议 + 一键应用', TEXTS.postNightRestSuggest.length > 0 && TEXTS.postNightRestApply.length > 0);

// --- P0-8 每日统计 ---
check('P0-8.4 统计行可展开/收起文案', TEXTS.statsExpand.length > 0 && TEXTS.statsCollapse.length > 0);

// --- P0-9 应休/实休 ---
check('P0-9.1 应休/实休列名', TEXTS.columnShouldRest === '应休' && TEXTS.columnActualRest === '实休');
check('P0-9.1 实休不含夜下休（tooltip 明示口径）', TEXTS.actualRestTooltip(6, 4).includes('夜下休不计入实休'));
check('P0-9.3 逐条差额文案', TEXTS.restGapLabel(2).includes('2') && TEXTS.restProgressLabel(6, 8).includes('6 / 8'));

// --- P0-10 校验 ---
const vTypes = Object.keys(VIOLATION_SEVERITY);
check(`P0-10.1 校验类型 ${vTypes.length} 类 ≥ 6 类`, vTypes.length >= 6, JSON.stringify(vTypes));
check(
  'P0-10.1 六大类均覆盖（belowMin/aboveMax/consecutiveNight/missingPostRest/约束/restShortage）',
  ['belowMin', 'aboveMax', 'consecutiveNight', 'missingPostRest', 'constraintNoDay', 'constraintNoNight', 'constraintWeekend', 'restShortage'].every(
    (t) => vTypes.includes(t),
  ),
  JSON.stringify(vTypes),
);
check('P0-10.4 无冲突文案为绿色语义', TEXTS.violationEmpty.includes('✅'), TEXTS.violationEmpty);
check('P0-10.5 校验防抖 = 200ms', VALIDATE_DEBOUNCE_MS === 200, String(VALIDATE_DEBOUNCE_MS));

// --- P0-11 CSV ---
check('P0-11.1 CSV 文件名格式', csvFileName('内分泌科', '2026-08') === '内分泌科202608排班表.csv', csvFileName('内分泌科', '2026-08'));
check('P0-11.1 CSV 单位数月份补零', csvFileName('内分泌科', '2026-03') === '内分泌科202603排班表.csv', csvFileName('内分泌科', '2026-03'));
check('P0-11.4 无数据时的导出提示存在', TEXTS.exportEmptyHint.length > 0);

// --- P0-12 PNG ---
check('P0-12.1 PNG 文件名格式（月份不补零）', pngFileName('2026-08') === '2026年8月排班表.png', pngFileName('2026-08'));
check('P0-12.1 PNG 单位数月份不补零', pngFileName('2026-03') === '2026年3月排班表.png', pngFileName('2026-03'));
check('P0-12.2 PNG 标题含科室名与月份', scheduleTitle('内分泌科', '2026-08') === '内分泌科 · 2026年8月排班表', scheduleTitle('内分泌科', '2026-08'));
check('P0-12.4 PNG loading 文案存在', TEXTS.exportPngWorking.length > 0);
note('P0-11/P0-12 文件名月份补零口径不一致（CSV 补零 / PNG 不补零）系竞品原始差异，texts.ts 已注释说明，判定为设计决策而非缺陷');

// --- P0-13 空状态 ---（上面已渲染验证）
// --- P0-14 月份导航 ---
check('P0-14.1 今天按钮 / 上下月文案', TEXTS.todayButton === '今天' && TEXTS.prevMonth.length > 0 && TEXTS.nextMonth.length > 0);
check('P0-14.4 有数据月份标记文案', TEXTS.monthHasData.length > 0);

// --- 星期文案两套并存的一致性 ---
check('星期文案 7 项（WEEKDAY_LABELS 带「周」前缀）', WEEKDAY_LABELS.length === 7 && WEEKDAY_LABELS[0] === '周日');
check('星期简称 7 项（WEEKDAY_NAMES 单字，表头/CSV 用）', WEEKDAY_NAMES.length === 7 && WEEKDAY_NAMES[0] === '日');
check(
  '两套星期文案索引口径一致（0 = 周日）',
  WEEKDAY_LABELS.every((l, i) => l === `周${WEEKDAY_NAMES[i]}`),
  JSON.stringify([WEEKDAY_LABELS, WEEKDAY_NAMES]),
);

// ==================== 汇总 ====================
console.log('');
console.log(`---- QA-04 结果：${passed}/${passed + fails.length} 通过，${notes.length} 条备注 ----`);
if (fails.length > 0) {
  console.log(`QA-04 FAILED（${fails.length} 项）：`);
  for (const f of fails) {
    console.log(`  - ${f}`);
  }
  process.exitCode = 1;
} else {
  console.log('QA-04 PASS');
}
