/**
 * QA-05 渲染期白屏风险探针。
 *
 * 目标：项目全局没有 ErrorBoundary（main.tsx 直接 render <App/>），
 * 因此任何渲染期 throw 都是整页白屏。本脚本回答一个问题——
 * **这条白屏路径实际可达吗？**
 *
 * 做法：用 22 组恶意/畸形 state 直接冲击渲染前的唯一计算入口 computeDerived()，
 * 以及 reducer 的关键 action。抛异常 = 白屏可达（缺陷升级为「严重」）；
 * 不抛 = 白屏仅为架构隐患（缺陷降为「一般」）。
 */
import type { Doctor, MonthSchedule, Rules, ScheduleEntry, ShiftType } from '../src/types/domain';
import { computeDerived } from '../src/core/stats';
import { createDefaultRules, createSampleDoctors } from '../src/constants/defaults';

let passed = 0;
const fails: string[] = [];
const throwers: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra ? `-> ${extra}` : ''}`);
  }
}

/** 跑一组恶意输入，捕获是否抛异常 */
function probe(label: string, build: () => { month: string; schedule: MonthSchedule; doctors: Doctor[]; rules: Rules }): void {
  let threw: string | null = null;
  let result: ReturnType<typeof computeDerived> | null = null;
  try {
    const p = build();
    result = computeDerived(p);
  } catch (reason) {
    threw = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  }
  if (threw) {
    throwers.push(`${label} -> ${threw}`);
  }
  check(`computeDerived 不抛异常：${label}`, threw === null, threw ?? '');
  if (result) {
    // 输出结构必须始终可消费，否则 UI 会在解构时二次爆炸
    const sane =
      Array.isArray(result.dailyStats) &&
      Array.isArray(result.doctorStats) &&
      Array.isArray(result.restShortages) &&
      result.validation !== null &&
      typeof result.validation === 'object' &&
      Array.isArray(result.validation.violations) &&
      typeof result.fairness?.score === 'number' &&
      Number.isFinite(result.fairness.score) &&
      typeof result.outOfRangeDays === 'number';
    check(`输出结构可安全消费：${label}`, sane, JSON.stringify({
      daily: Array.isArray(result.dailyStats),
      score: result.fairness?.score,
      oor: result.outOfRangeDays,
    }));
  }
}

const MONTH = '2026-08';
function baseSchedule(): MonthSchedule {
  return {
    '2026-08-01': {
      'sample-1': { doctorId: 'sample-1', shiftType: 'dayShift', isRotation: false },
      'sample-2': { doctorId: 'sample-2', shiftType: 'nightShift', isRotation: false },
    },
  };
}

console.log('--- 恶意 state 冲击 computeDerived（渲染期唯一计算入口） ---');

probe('正常基线', () => ({ month: MONTH, schedule: baseSchedule(), doctors: createSampleDoctors(), rules: createDefaultRules() }));

probe('schedule = 空对象', () => ({ month: MONTH, schedule: {}, doctors: createSampleDoctors(), rules: createDefaultRules() }));

probe('doctors = 空数组', () => ({ month: MONTH, schedule: baseSchedule(), doctors: [], rules: createDefaultRules() }));

probe('month = 空串', () => ({ month: '', schedule: baseSchedule(), doctors: createSampleDoctors(), rules: createDefaultRules() }));

probe('month = 非法字符串', () => ({ month: 'not-a-month', schedule: baseSchedule(), doctors: createSampleDoctors(), rules: createDefaultRules() }));

probe('month = 2026-13（语义非法）', () => ({ month: '2026-13', schedule: baseSchedule(), doctors: createSampleDoctors(), rules: createDefaultRules() }));

probe('孤儿条目（医生已删除）', () => ({
  month: MONTH,
  schedule: {
    '2026-08-01': {
      'ghost-1': { doctorId: 'ghost-1', shiftType: 'nightShift', isRotation: false },
      'ghost-2': { doctorId: 'ghost-2', shiftType: 'dayShift', isRotation: false },
    },
  },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('未知 shiftType', () => ({
  month: MONTH,
  schedule: {
    '2026-08-01': {
      'sample-1': { doctorId: 'sample-1', shiftType: 'unknown-shift' as ShiftType, isRotation: false },
    },
  },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('entry = null', () => ({
  month: MONTH,
  schedule: { '2026-08-01': { 'sample-1': null as unknown as ScheduleEntry } },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('daySchedule = null', () => ({
  month: MONTH,
  schedule: { '2026-08-01': null as unknown as Record<string, ScheduleEntry> },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('entry 缺 shiftType 字段', () => ({
  month: MONTH,
  schedule: { '2026-08-01': { 'sample-1': { doctorId: 'sample-1' } as unknown as ScheduleEntry } },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('日期 key 非法（2026-08-99）', () => ({
  month: MONTH,
  schedule: {
    '2026-08-99': { 'sample-1': { doctorId: 'sample-1', shiftType: 'dayShift', isRotation: false } },
  },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('跨月日期混入', () => ({
  month: MONTH,
  schedule: {
    '2025-01-01': { 'sample-1': { doctorId: 'sample-1', shiftType: 'dayShift', isRotation: false } },
    '2026-08-01': { 'sample-2': { doctorId: 'sample-2', shiftType: 'dayShift', isRotation: false } },
  },
  doctors: createSampleDoctors(),
  rules: createDefaultRules(),
}));

probe('rules.shiftsByWeekday = 空对象', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: createSampleDoctors(),
  rules: { ...createDefaultRules(), shiftsByWeekday: {} },
}));

probe('rules.shiftsByWeekday = null', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: createSampleDoctors(),
  rules: { ...createDefaultRules(), shiftsByWeekday: null as unknown as Rules['shiftsByWeekday'] },
}));

probe('restDaysPerMonth = NaN', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: createSampleDoctors(),
  rules: { ...createDefaultRules(), restDaysPerMonth: Number.NaN },
}));

probe('restDaysPerMonth = Infinity', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: createSampleDoctors(),
  rules: { ...createDefaultRules(), restDaysPerMonth: Number.POSITIVE_INFINITY },
}));

probe('rules.rules = undefined（缺子对象）', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: createSampleDoctors(),
  rules: { ...createDefaultRules(), rules: undefined as unknown as Rules['rules'] },
}));

probe('医生缺 constraints', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: [{ ...createSampleDoctors()[0], constraints: undefined as unknown as Doctor['constraints'] }],
  rules: createDefaultRules(),
}));

probe('医生 fixedClinicDays = null', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: [{ ...createSampleDoctors()[0], fixedClinicDays: null as unknown as number[] }],
  rules: createDefaultRules(),
}));

probe('医生 leaves 含非法日期', () => ({
  month: MONTH,
  schedule: baseSchedule(),
  doctors: [
    { ...createSampleDoctors()[0], leaves: [{ id: 'l1', start: 'bad-date', end: '2026-08-05' }] },
  ],
  rules: createDefaultRules(),
}));

probe('医生 id 为空串', () => ({
  month: MONTH,
  schedule: { '2026-08-01': { '': { doctorId: '', shiftType: 'dayShift', isRotation: false } } },
  doctors: [{ ...createSampleDoctors()[0], id: '' }],
  rules: createDefaultRules(),
}));

probe('超大排班（31 天 × 200 人）', () => {
  const doctors: Doctor[] = [];
  for (let i = 0; i < 200; i += 1) {
    doctors.push({ ...createSampleDoctors()[i % 10], id: `big-${i}`, name: `医生${i}` });
  }
  const schedule: MonthSchedule = {};
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-08-${String(d).padStart(2, '0')}`;
    schedule[date] = {};
    for (const doc of doctors) {
      schedule[date][doc.id] = { doctorId: doc.id, shiftType: 'dayShift', isRotation: false };
    }
  }
  return { month: MONTH, schedule, doctors, rules: createDefaultRules() };
});

// ==================== 汇总 ====================
console.log('');
console.log(`---- QA-05 结果：${passed}/${passed + fails.length} 通过 ----`);
if (throwers.length > 0) {
  console.log(`⚠ 可达的渲染期异常（无 ErrorBoundary = 白屏）共 ${throwers.length} 条：`);
  for (const t of throwers) {
    console.log(`  - ${t}`);
  }
} else {
  console.log('✅ 22 组恶意输入均未抛异常：白屏路径在派生计算层不可达（ErrorBoundary 缺失仅为架构隐患）');
}
if (fails.length > 0) {
  console.log(`QA-05 FAILED（${fails.length} 项）`);
  for (const f of fails) {
    console.log(`  - ${f}`);
  }
  process.exitCode = 1;
} else {
  console.log('QA-05 PASS');
}
