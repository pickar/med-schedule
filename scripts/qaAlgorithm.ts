/**
 * QA-03 算法边界与性能验收（独立验收，非开发方烟测）。
 *
 * 刻意避开 smokeT02 已覆盖的用例（2 人 / 全员禁夜 / 单人整月请假 / 空名册 / 非法月份 / 单次锁定格），
 * 只打它没打到的地方：
 *   G1 月份边界（平年/闰年/世纪年/小月）
 *   G2 极小名册（1 人 / 1 人三禁）
 *   G3 全员整月请假
 *   G4 全员三禁（无人可用）
 *   G5 全格锁定后重新生成（必须原样保留）
 *   G6 restDaysPerMonth 荒谬值
 *   G7 人数区间荒谬值（min>max / min=999 / 全 0）
 *   G8 脏轮流规则（指向已删除医生 / 空名单 / weekday 越界）
 *   G9 脏 existingSchedule（孤儿锁定格 / 跨月日期 / 非法班次）
 *   G10 重复医生 ID / 全员固定门诊 7 天
 *   G11 性能 p95（100 次）
 *   G12 幂等性（全场景两次生成必须字节一致）
 */
import type { Doctor, MonthSchedule, Rules, ScheduleEntry, ShiftType } from '../src/types/domain';
import { generateSchedule } from '../src/core/generator';
import { validateMonth, countByType } from '../src/core/validator';
import { computeDoctorStats } from '../src/core/stats/doctor';
import { createDefaultRules, createSampleDoctors } from '../src/constants/defaults';
import { SHIFT_ORDER } from '../src/constants/shifts';
import { getDaysInMonth, listMonthDates, monthOfDate } from '../src/lib/date';

const VALID_SHIFTS = new Set<string>(SHIFT_ORDER as readonly string[]);
const HARD_TYPES = ['constraintNoDay', 'constraintNoNight', 'missingPostRest', 'consecutiveNight'] as const;
/** 单次生成硬性能红线（DESIGN.md 要求） */
const PERF_BUDGET_MS = 100;

let passed = 0;
const fails: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra ? `-> ${extra}` : ''}`);
  }
}

function group(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// ==================== 通用结构不变量 ====================

/**
 * 对任意生成结果做结构体检，返回违反项描述。
 * 这是所有边界用例共用的兜底断言：无论输入多脏，输出结构必须始终自洽。
 */
function structuralIssues(month: string, schedule: MonthSchedule, doctors: Doctor[]): string[] {
  const issues: string[] = [];
  const roster = new Set(doctors.map((d) => d.id));
  const legalDates = new Set(listMonthDates(month));

  for (const [date, day] of Object.entries(schedule)) {
    if (!legalDates.has(date)) {
      issues.push(`越界日期 ${date}`);
      continue;
    }
    if (day === null || typeof day !== 'object') {
      issues.push(`${date} 的 daySchedule 非对象`);
      continue;
    }
    for (const [key, entry] of Object.entries(day)) {
      const e = entry as ScheduleEntry;
      if (!e || typeof e !== 'object') {
        issues.push(`${date}/${key} 条目非对象`);
        continue;
      }
      if (e.doctorId !== key) {
        issues.push(`${date} key(${key}) 与 doctorId(${e.doctorId}) 不一致`);
      }
      if (!roster.has(e.doctorId)) {
        issues.push(`${date} 出现名册外医生 ${e.doctorId}`);
      }
      if (!VALID_SHIFTS.has(e.shiftType as string)) {
        issues.push(`${date}/${key} 非法班次 ${String(e.shiftType)}`);
      }
      if (typeof e.isRotation !== 'boolean') {
        issues.push(`${date}/${key} isRotation 非布尔`);
      }
    }
  }
  return issues;
}

interface RunOpts {
  month?: string;
  doctors: Doctor[];
  rules: Rules;
  existing?: MonthSchedule;
}

function runCase(label: string, opts: RunOpts) {
  const month = opts.month ?? '2026-08';
  const result = generateSchedule({
    month,
    doctors: opts.doctors,
    rules: opts.rules,
    existingSchedule: opts.existing,
  });
  const issues = structuralIssues(month, result.schedule, opts.doctors);
  check(`${label}：结构不变量无违反`, issues.length === 0, issues.slice(0, 5).join(' / '));
  check(`${label}：耗时 < ${PERF_BUDGET_MS}ms（实测 ${result.elapsedMs}ms）`, result.elapsedMs < PERF_BUDGET_MS);
  return result;
}

/** 幂等性：同一构造函数产出的输入连跑两次，结果必须字节一致 */
function checkIdempotent(label: string, build: () => RunOpts): void {
  const a = build();
  const b = build();
  const ra = generateSchedule({
    month: a.month ?? '2026-08',
    doctors: a.doctors,
    rules: a.rules,
    existingSchedule: a.existing,
  });
  const rb = generateSchedule({
    month: b.month ?? '2026-08',
    doctors: b.doctors,
    rules: b.rules,
    existingSchedule: b.existing,
  });
  check(`幂等 ${label}：两次排班字节一致`, JSON.stringify(ra.schedule) === JSON.stringify(rb.schedule));
  check(`幂等 ${label}：两次诊断字节一致`, JSON.stringify(ra.diagnostics) === JSON.stringify(rb.diagnostics));
}

/** 入参未被篡改（纯函数承诺） */
function snapshot(v: unknown): string {
  return JSON.stringify(v);
}

// ==================== G1 月份边界 ====================
group('G1 月份边界：平年 / 闰年 / 世纪年 / 小月');

const MONTH_CASES: { month: string; expect: number; note: string }[] = [
  { month: '2026-02', expect: 28, note: '平年 2 月' },
  { month: '2028-02', expect: 29, note: '闰年 2 月' },
  { month: '2000-02', expect: 29, note: '世纪闰年（能被 400 整除）' },
  { month: '2100-02', expect: 28, note: '世纪平年（能被 100 不能被 400）' },
  { month: '2026-04', expect: 30, note: '小月 30 天' },
  { month: '2026-01', expect: 31, note: '大月 31 天' },
  { month: '2025-12', expect: 31, note: '跨年边界 12 月' },
];

for (const mc of MONTH_CASES) {
  const doctors = createSampleDoctors();
  const rules = createDefaultRules();
  const res = generateSchedule({ month: mc.month, doctors, rules });
  const dates = Object.keys(res.schedule);
  const issues = structuralIssues(mc.month, res.schedule, doctors);

  check(
    `${mc.month}（${mc.note}）天数 = ${mc.expect}`,
    getDaysInMonth(mc.month) === mc.expect && dates.length === mc.expect,
    `getDaysInMonth=${getDaysInMonth(mc.month)} 实排=${dates.length}`,
  );
  check(`${mc.month} 无跨月写入`, dates.every((d) => monthOfDate(d) === mc.month));
  check(`${mc.month} 结构不变量无违反`, issues.length === 0, issues.slice(0, 3).join(' / '));
  check(`${mc.month} 无硬违规`, (() => {
    const c = countByType(validateMonth({ month: mc.month, schedule: res.schedule, doctors, rules }));
    return HARD_TYPES.every((t) => (c[t] ?? 0) === 0);
  })());
  check(`${mc.month} 耗时 < ${PERF_BUDGET_MS}ms（${res.elapsedMs}ms）`, res.elapsedMs < PERF_BUDGET_MS);
}

// 2 月最后一天的夜班不得写入 3 月
const feb = generateSchedule({ month: '2028-02', doctors: createSampleDoctors(), rules: createDefaultRules() });
check(
  '闰年 2/29 有排班且不溢出到 3 月',
  feb.schedule['2028-02-29'] !== undefined && feb.schedule['2028-03-01'] === undefined,
);

// ==================== G2 极小名册 ====================
group('G2 极小名册：1 人 / 1 人三禁');

const solo = createSampleDoctors().slice(0, 1);
const soloRes = runCase('单医生', { doctors: solo, rules: createDefaultRules() });
check('单医生：仍产出 31 天', Object.keys(soloRes.schedule).length === 31, String(Object.keys(soloRes.schedule).length));
check('单医生：给出降级诊断（不静默）', soloRes.diagnostics.length > 0, String(soloRes.diagnostics.length));
check(
  '单医生：无硬违规',
  (() => {
    const c = countByType(validateMonth({ month: '2026-08', schedule: soloRes.schedule, doctors: solo, rules: createDefaultRules() }));
    return HARD_TYPES.every((t) => (c[t] ?? 0) === 0);
  })(),
);

const banned: Doctor[] = [
  {
    ...createSampleDoctors()[3],
    constraints: { noDayShift: true, noNightShift: true, weekendOff: true },
  },
];
const bannedRes = runCase('单医生三禁', { doctors: banned, rules: createDefaultRules() });
const bannedWork = Object.values(bannedRes.schedule).flatMap((d) =>
  Object.values(d).filter((e) => e.shiftType === 'dayShift' || e.shiftType === 'nightShift'),
);
check('单医生三禁：0 个白班/夜班', bannedWork.length === 0, String(bannedWork.length));
check('单医生三禁：不死循环（诊断有限条 < 2000）', bannedRes.diagnostics.length < 2000, String(bannedRes.diagnostics.length));

// ==================== G3 全员整月请假 ====================
group('G3 全员整月请假');

function allOnLeave(): Doctor[] {
  return createSampleDoctors().map((d, i) => ({
    ...d,
    leaves: [{ id: `lv-${i}`, start: '2026-08-01', end: '2026-08-31', note: '集体休假' }],
  }));
}
const leaveAll = allOnLeave();
const leaveRes = runCase('全员整月请假', { doctors: leaveAll, rules: createDefaultRules() });
const leaveWorked = Object.values(leaveRes.schedule).flatMap((d) =>
  Object.values(d).filter((e) => e.shiftType !== 'rest' && e.shiftType !== 'postNightRest'),
);
check('全员请假：0 个工作班次', leaveWorked.length === 0, `${leaveWorked.length} 个：${leaveWorked.slice(0, 3).map((e) => e.shiftType).join(',')}`);
const leaveStats = computeDoctorStats({ month: '2026-08', schedule: leaveRes.schedule, doctors: leaveAll, rules: createDefaultRules() });
check('全员请假：每人请假 31 天', leaveStats.every((s) => s.leaveDays === 31), JSON.stringify(leaveStats.map((s) => s.leaveDays)));
check('全员请假：无 leaveConflict 违规', (() => {
  const c = countByType(validateMonth({ month: '2026-08', schedule: leaveRes.schedule, doctors: leaveAll, rules: createDefaultRules() }));
  return (c.leaveConflict ?? 0) === 0;
})());
check('全员请假：产出 belowMin 诊断（把缺口说出来）', leaveRes.diagnostics.length > 0, String(leaveRes.diagnostics.length));

// ==================== G4 全员三禁 ====================
group('G4 全员三禁（无人可上班）');

const allBanned = createSampleDoctors().map((d) => ({
  ...d,
  fixedClinicDays: [],
  constraints: { noDayShift: true, noNightShift: true, weekendOff: true },
}));
const allBannedRes = runCase('全员三禁', { doctors: allBanned, rules: createDefaultRules() });
const abWork = Object.values(allBannedRes.schedule).flatMap((d) =>
  Object.values(d).filter((e) => e.shiftType === 'dayShift' || e.shiftType === 'nightShift'),
);
check('全员三禁：0 个白班/夜班', abWork.length === 0, String(abWork.length));
check('全员三禁：无硬违规', (() => {
  const c = countByType(validateMonth({ month: '2026-08', schedule: allBannedRes.schedule, doctors: allBanned, rules: createDefaultRules() }));
  return HARD_TYPES.every((t) => (c[t] ?? 0) === 0);
})());
check('全员三禁：全表填满不留空格', Object.values(allBannedRes.schedule).every((d) => Object.keys(d).length === 10));

// ==================== G5 全格锁定后重新生成 ====================
group('G5 全格锁定后重新生成');

const baseDoctors = createSampleDoctors();
const baseRules = createDefaultRules();
const baseline = generateSchedule({ month: '2026-08', doctors: baseDoctors, rules: baseRules });

const fullyLocked: MonthSchedule = {};
for (const [date, day] of Object.entries(baseline.schedule)) {
  fullyLocked[date] = {};
  for (const [id, e] of Object.entries(day)) {
    fullyLocked[date][id] = { ...e, locked: true };
  }
}
const lockedInput = snapshot(fullyLocked);
const regen = runCase('全格锁定重生成', { doctors: baseDoctors, rules: baseRules, existing: fullyLocked });

function flatten(s: MonthSchedule): string {
  return Object.keys(s)
    .sort()
    .map((d) =>
      Object.keys(s[d])
        .sort()
        .map((id) => `${d}|${id}|${s[d][id].shiftType}`)
        .join(','),
    )
    .join(';');
}
check('全格锁定：重新生成结果与锁定内容完全一致', flatten(regen.schedule) === flatten(fullyLocked), `锁定 ${flatten(fullyLocked).length} 字符 vs 结果 ${flatten(regen.schedule).length} 字符`);
check('全格锁定：locked 标记全部保留', Object.values(regen.schedule).every((d) => Object.values(d).every((e) => e.locked === true)));
check('全格锁定：未篡改入参 existingSchedule', snapshot(fullyLocked) === lockedInput);

// 一半锁定：锁定部分必须原样，未锁定部分允许变化
const halfLocked: MonthSchedule = {};
let toggle = false;
for (const [date, day] of Object.entries(baseline.schedule)) {
  halfLocked[date] = {};
  for (const [id, e] of Object.entries(day)) {
    toggle = !toggle;
    halfLocked[date][id] = toggle ? { ...e, locked: true } : { ...e };
  }
}
const halfRes = runCase('半数锁定重生成', { doctors: baseDoctors, rules: baseRules, existing: halfLocked });
let lockedKept = 0;
let lockedLost = 0;
for (const [date, day] of Object.entries(halfLocked)) {
  for (const [id, e] of Object.entries(day)) {
    if (e.locked !== true) continue;
    if (halfRes.schedule[date]?.[id]?.shiftType === e.shiftType) lockedKept += 1;
    else lockedLost += 1;
  }
}
check(`半数锁定：全部锁定格保留（保留 ${lockedKept} / 丢失 ${lockedLost}）`, lockedLost === 0);

// ==================== G6 restDaysPerMonth 荒谬值 ====================
group('G6 restDaysPerMonth 荒谬值');

for (const restDays of [0, 31, 40, 999, -5, 0.5, Number.NaN]) {
  const rules: Rules = { ...createDefaultRules(), restDaysPerMonth: restDays };
  const doctors = createSampleDoctors();
  const started = Date.now();
  const res = generateSchedule({ month: '2026-08', doctors, rules });
  const wall = Date.now() - started;
  const issues = structuralIssues('2026-08', res.schedule, doctors);
  check(
    `restDaysPerMonth=${String(restDays)}：不崩溃 + 结构自洽 + 墙钟 ${wall}ms < 1000ms`,
    issues.length === 0 && wall < 1000,
    issues.slice(0, 3).join(' / '),
  );
  check(
    `restDaysPerMonth=${String(restDays)}：仍产出 31 天`,
    Object.keys(res.schedule).length === 31,
    String(Object.keys(res.schedule).length),
  );
}

// ==================== G7 人数区间荒谬值 ====================
group('G7 人数区间荒谬值');

function rulesWithRange(min: number, max: number): Rules {
  const r = createDefaultRules();
  for (let w = 0; w <= 6; w += 1) {
    r.shiftsByWeekday[w] = { dayShift: { min, max }, nightShift: { min, max } };
  }
  return r;
}

const rangeCases: { label: string; rules: Rules }[] = [
  { label: 'min=999/max=999（远超名册）', rules: rulesWithRange(999, 999) },
  { label: 'min=5/max=1（min>max 倒挂）', rules: rulesWithRange(5, 1) },
  { label: 'min=0/max=0（全班次关闭）', rules: rulesWithRange(0, 0) },
  { label: 'min=-3/max=-1（负数）', rules: rulesWithRange(-3, -1) },
  { label: 'shiftsByWeekday 全空', rules: { ...createDefaultRules(), shiftsByWeekday: {} } },
];

for (const rc of rangeCases) {
  const doctors = createSampleDoctors();
  const started = Date.now();
  const res = generateSchedule({ month: '2026-08', doctors, rules: rc.rules });
  const wall = Date.now() - started;
  const issues = structuralIssues('2026-08', res.schedule, doctors);
  check(`${rc.label}：结构自洽 + 不挂起（墙钟 ${wall}ms）`, issues.length === 0 && wall < 1000, issues.slice(0, 3).join(' / '));
  check(`${rc.label}：无名册外医生 / 无非法班次`, issues.length === 0);
  const c = countByType(validateMonth({ month: '2026-08', schedule: res.schedule, doctors, rules: rc.rules }));
  check(`${rc.label}：无硬违规`, HARD_TYPES.every((t) => (c[t] ?? 0) === 0), JSON.stringify(c));
}

// max=0 时应确实不排白班/夜班
const zeroRes = generateSchedule({ month: '2026-08', doctors: createSampleDoctors(), rules: rulesWithRange(0, 0) });
const zeroWork = Object.values(zeroRes.schedule).flatMap((d) =>
  Object.values(d).filter((e) => e.shiftType === 'dayShift' || e.shiftType === 'nightShift'),
);
check('min=0/max=0：确实 0 个白班/夜班', zeroWork.length === 0, String(zeroWork.length));

// ==================== G8 脏轮流规则 ====================
group('G8 脏轮流规则');

const dirtyRotations: { label: string; rules: Rules }[] = [
  {
    label: '轮流规则指向已删除医生',
    rules: {
      ...createDefaultRules(),
      rotationRules: [{ id: 'r1', weekday: 3, doctorIds: ['ghost-1', 'ghost-2'], mode: 'selected' }],
    },
  },
  {
    label: 'selected 模式但名单为空',
    rules: {
      ...createDefaultRules(),
      rotationRules: [{ id: 'r2', weekday: 2, doctorIds: [], mode: 'selected' }],
    },
  },
  {
    label: 'weekday 越界 = 9',
    rules: {
      ...createDefaultRules(),
      rotationRules: [{ id: 'r3', weekday: 9, doctorIds: [], mode: 'all' }],
    },
  },
  {
    label: 'weekday 为负 = -1',
    rules: {
      ...createDefaultRules(),
      rotationRules: [{ id: 'r4', weekday: -1, doctorIds: [], mode: 'random' }],
    },
  },
  {
    label: '同一 weekday 重复 3 条规则',
    rules: {
      ...createDefaultRules(),
      rotationRules: [
        { id: 'r5', weekday: 1, doctorIds: [], mode: 'all' },
        { id: 'r6', weekday: 1, doctorIds: [], mode: 'random' },
        { id: 'r7', weekday: 1, doctorIds: ['sample-2'], mode: 'selected' },
      ],
    },
  },
  {
    label: '半数医生已删除的 selected 名单',
    rules: {
      ...createDefaultRules(),
      rotationRules: [{ id: 'r8', weekday: 5, doctorIds: ['sample-2', 'ghost-x', 'sample-3', 'ghost-y'], mode: 'selected' }],
    },
  },
];

for (const dr of dirtyRotations) {
  const doctors = createSampleDoctors();
  const res = generateSchedule({ month: '2026-08', doctors, rules: dr.rules });
  const issues = structuralIssues('2026-08', res.schedule, doctors);
  check(`${dr.label}：不崩溃 + 无幽灵医生进表`, issues.length === 0, issues.slice(0, 3).join(' / '));
  check(`${dr.label}：仍产出 31 天`, Object.keys(res.schedule).length === 31, String(Object.keys(res.schedule).length));
  const c = countByType(validateMonth({ month: '2026-08', schedule: res.schedule, doctors, rules: dr.rules }));
  check(`${dr.label}：无硬违规`, HARD_TYPES.every((t) => (c[t] ?? 0) === 0), JSON.stringify(c));
}

// ==================== G9 脏 existingSchedule ====================
group('G9 脏 existingSchedule');

const dirtyExisting: MonthSchedule = {
  // 孤儿锁定格：医生不在名册
  '2026-08-03': {
    'ghost-doctor': { doctorId: 'ghost-doctor', shiftType: 'nightShift', isRotation: false, locked: true },
    'sample-1': { doctorId: 'sample-1', shiftType: 'clinic', isRotation: false, locked: true },
  },
  // 跨月日期
  '2026-09-15': {
    'sample-2': { doctorId: 'sample-2', shiftType: 'dayShift', isRotation: false, locked: true },
  },
  // 非法日期
  '2026-08-99': {
    'sample-3': { doctorId: 'sample-3', shiftType: 'dayShift', isRotation: false, locked: true },
  },
  // 非法班次（越过类型系统模拟外部脏数据）
  '2026-08-07': {
    'sample-4': { doctorId: 'sample-4', shiftType: 'wtf-shift' as ShiftType, isRotation: false, locked: true },
  },
  // key 与 doctorId 不一致
  '2026-08-09': {
    'sample-5': { doctorId: 'sample-6', shiftType: 'dayShift', isRotation: false, locked: true },
  },
};

const dirtyDoctors = createSampleDoctors();
const dirtySnapshot = snapshot(dirtyExisting);
const dirtyRes = runCase('脏 existingSchedule', { doctors: dirtyDoctors, rules: createDefaultRules(), existing: dirtyExisting });
check(
  '脏 existing：孤儿锁定格未进入结果（ghost-doctor 被拦截）',
  Object.values(dirtyRes.schedule).every((d) => d['ghost-doctor'] === undefined),
);
check('脏 existing：跨月日期未进入结果', dirtyRes.schedule['2026-09-15'] === undefined);
check('脏 existing：非法日期未进入结果', dirtyRes.schedule['2026-08-99'] === undefined);
check(
  '脏 existing：非法班次 wtf-shift 未落入结果',
  Object.values(dirtyRes.schedule).every((d) => Object.values(d).every((e) => VALID_SHIFTS.has(e.shiftType as string))),
  JSON.stringify(dirtyRes.schedule['2026-08-07']),
);
check('脏 existing：合法锁定格 sample-1@08-03 保留为门诊', dirtyRes.schedule['2026-08-03']?.['sample-1']?.shiftType === 'clinic', String(dirtyRes.schedule['2026-08-03']?.['sample-1']?.shiftType));
check('脏 existing：未篡改入参', snapshot(dirtyExisting) === dirtySnapshot);

// ==================== G10 重复 ID / 全员固定门诊 ====================
group('G10 重复医生 ID / 全员 7 天固定门诊');

const dupDoctors = createSampleDoctors();
dupDoctors.push({ ...dupDoctors[0], name: '张伟（重复 ID）' });
const dupRes = runCase('重复医生 ID', { doctors: dupDoctors, rules: createDefaultRules() });
check('重复 ID：不崩溃且产出 31 天', Object.keys(dupRes.schedule).length === 31, String(Object.keys(dupRes.schedule).length));
check(
  '重复 ID：同日同 ID 只出现一个条目（对象 key 天然去重）',
  Object.values(dupRes.schedule).every((d) => Object.keys(d).length <= 10),
  JSON.stringify(Object.entries(dupRes.schedule).filter(([, d]) => Object.keys(d).length > 10).slice(0, 2)),
);

const allClinic = createSampleDoctors().map((d) => ({ ...d, fixedClinicDays: [0, 1, 2, 3, 4, 5, 6] }));
const allClinicRes = runCase('全员 7 天固定门诊', { doctors: allClinic, rules: createDefaultRules() });
const clinicCount = Object.values(allClinicRes.schedule).flatMap((d) =>
  Object.values(d).filter((e) => e.shiftType === 'clinic'),
).length;
check(`全员 7 天固定门诊：门诊落位 ${clinicCount} 个（应接近 310）`, clinicCount > 200, String(clinicCount));
check('全员 7 天固定门诊：无硬违规', (() => {
  const c = countByType(validateMonth({ month: '2026-08', schedule: allClinicRes.schedule, doctors: allClinic, rules: createDefaultRules() }));
  return HARD_TYPES.every((t) => (c[t] ?? 0) === 0);
})());
check(
  '全员 7 天固定门诊：休息不足会被诊断出来（不静默吞掉）',
  allClinicRes.diagnostics.length > 0,
  String(allClinicRes.diagnostics.length),
);

// ==================== G11 性能 p95 ====================
group('G11 性能 p95');

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function bench(label: string, doctors: Doctor[], rules: Rules, month: string, runs: number, budget: number): void {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const r = generateSchedule({ month, doctors, rules });
    samples.push(r.elapsedMs);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1];
  const avg = Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 100) / 100;
  console.log(`  [${label}] n=${runs} avg=${avg}ms p50=${p50}ms p95=${p95}ms max=${max}ms`);
  check(`${label}：p95 ${p95}ms < ${budget}ms`, p95 < budget);
  check(`${label}：max ${max}ms < ${budget * 2}ms（无长尾抖动）`, max < budget * 2);
}

bench('默认 10 人 / 2026-08', createSampleDoctors(), createDefaultRules(), '2026-08', 100, PERF_BUDGET_MS);

// 压力：把示例名册复制到 60 人
const bigRoster: Doctor[] = [];
for (let k = 0; k < 6; k += 1) {
  for (const d of createSampleDoctors()) {
    bigRoster.push({ ...d, id: `${d.id}-r${k}`, name: `${d.name}${k}` });
  }
}
const bigRules = createDefaultRules();
for (let w = 0; w <= 6; w += 1) {
  bigRules.shiftsByWeekday[w] = { dayShift: { min: 8, max: 12 }, nightShift: { min: 2, max: 3 } };
}
bench('压力 60 人 / 白班8-12 夜班2-3', bigRoster, bigRules, '2026-08', 30, PERF_BUDGET_MS * 3);

const bigRes = generateSchedule({ month: '2026-08', doctors: bigRoster, rules: bigRules });
check('压力 60 人：结构自洽', structuralIssues('2026-08', bigRes.schedule, bigRoster).length === 0);
check('压力 60 人：无硬违规', (() => {
  const c = countByType(validateMonth({ month: '2026-08', schedule: bigRes.schedule, doctors: bigRoster, rules: bigRules }));
  return HARD_TYPES.every((t) => (c[t] ?? 0) === 0);
})(), JSON.stringify(countByType(validateMonth({ month: '2026-08', schedule: bigRes.schedule, doctors: bigRoster, rules: bigRules }))));

// ==================== G12 幂等性（全场景） ====================
group('G12 幂等性（全场景两次生成必须字节一致）');

checkIdempotent('默认名册', () => ({ doctors: createSampleDoctors(), rules: createDefaultRules() }));
checkIdempotent('闰年 2 月', () => ({ month: '2028-02', doctors: createSampleDoctors(), rules: createDefaultRules() }));
checkIdempotent('单医生', () => ({ doctors: createSampleDoctors().slice(0, 1), rules: createDefaultRules() }));
checkIdempotent('全员请假', () => ({ doctors: allOnLeave(), rules: createDefaultRules() }));
checkIdempotent('全员三禁', () => ({
  doctors: createSampleDoctors().map((d) => ({
    ...d,
    fixedClinicDays: [],
    constraints: { noDayShift: true, noNightShift: true, weekendOff: true },
  })),
  rules: createDefaultRules(),
}));
checkIdempotent('极端区间 min=999', () => ({ doctors: createSampleDoctors(), rules: rulesWithRange(999, 999) }));
checkIdempotent('脏轮流规则', () => ({
  doctors: createSampleDoctors(),
  rules: {
    ...createDefaultRules(),
    rotationRules: [{ id: 'r1', weekday: 3, doctorIds: ['ghost-1', 'sample-2'], mode: 'selected' as const }],
  },
}));
checkIdempotent('60 人压力名册', () => {
  const roster: Doctor[] = [];
  for (let k = 0; k < 6; k += 1) {
    for (const d of createSampleDoctors()) {
      roster.push({ ...d, id: `${d.id}-r${k}`, name: `${d.name}${k}` });
    }
  }
  const r = createDefaultRules();
  for (let w = 0; w <= 6; w += 1) {
    r.shiftsByWeekday[w] = { dayShift: { min: 8, max: 12 }, nightShift: { min: 2, max: 3 } };
  }
  return { doctors: roster, rules: r };
});

// 入参不可变：跑一次后原始 doctors/rules 未被改动
const pureDoctors = createSampleDoctors();
const pureRules = createDefaultRules();
const beforeD = snapshot(pureDoctors);
const beforeR = snapshot(pureRules);
generateSchedule({ month: '2026-08', doctors: pureDoctors, rules: pureRules });
check('纯函数：未篡改 doctors 入参', snapshot(pureDoctors) === beforeD);
check('纯函数：未篡改 rules 入参', snapshot(pureRules) === beforeR);

// 三次连跑一致（排除首跑 JIT 造成的隐式状态）
const t1 = generateSchedule({ month: '2026-08', doctors: pureDoctors, rules: pureRules });
const t2 = generateSchedule({ month: '2026-08', doctors: pureDoctors, rules: pureRules });
const t3 = generateSchedule({ month: '2026-08', doctors: pureDoctors, rules: pureRules });
check(
  '同一组入参连跑三次结果一致（无跨调用残留状态）',
  JSON.stringify(t1.schedule) === JSON.stringify(t2.schedule) && JSON.stringify(t2.schedule) === JSON.stringify(t3.schedule),
);

// ==================== 汇总 ====================
console.log('');
console.log(`---- QA-03 结果：${passed}/${passed + fails.length} 通过 ----`);
if (fails.length > 0) {
  console.log(`QA-03 FAILED（${fails.length} 项）：`);
  for (const f of fails) {
    console.log(`  - ${f}`);
  }
  process.exitCode = 1;
} else {
  console.log('QA-03 PASS');
}
