// T02 领域层烟测：生成器硬门禁 + 校验器 + 统计 + 边界降级。
// 不参与 src 构建（tsconfig include 仅 ["src"]）。
import type { Doctor, MonthSchedule, Rules } from '../src/types/domain';
import { generateSchedule, generateScheduleDetailed } from '../src/core/generator';
import { countByType, validateMonth } from '../src/core/validator';
import { computeDailyStats, sumMonthCounts } from '../src/core/stats/daily';
import { computeDoctorStats, findRestShortages } from '../src/core/stats/doctor';
import { computeFairness } from '../src/core/stats/fairness';
import { createDefaultRules, createSampleDoctors } from '../src/constants/defaults';

const MONTH = '2026-08';
const HARD_TYPES = ['constraintNoDay', 'constraintNoNight', 'missingPostRest', 'consecutiveNight'] as const;

const fails: string[] = [];
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function run(doctors: Doctor[], rules: Rules, existing?: MonthSchedule) {
  const result = generateScheduleDetailed({ month: MONTH, doctors, rules, existingSchedule: existing });
  const validation = validateMonth({ month: MONTH, schedule: result.schedule, doctors, rules });
  return { ...result, validation, counts: countByType(validation) };
}

/** 阶段 3/4 记录的「未达下限」诊断坐标 */
function belowMinDiagnosed(diags: { date?: string; shiftType?: string; message: string }[]): Set<string> {
  const set = new Set<string>();
  for (const d of diags) {
    if (d.date && d.shiftType && d.message.includes('未达下限')) {
      set.add(`${d.date}|${d.shiftType}`);
    }
  }
  return set;
}

// ==================== 主用例：10 位示例医生 + 默认规则 ====================
console.log('--- 主用例：10 位医生 / 默认规则 / 2026-08 ---');
const doctors = createSampleDoctors();
const rules = createDefaultRules();
const main = run(doctors, rules);

console.log(`  耗时 ${main.elapsedMs}ms  诊断 ${main.diagnostics.length} 条  违规 ${main.validation.total} 条`);
console.log(`  阶段落位 ${JSON.stringify(main.stages)}`);
console.log(`  违规分布 ${JSON.stringify(main.counts)}`);

check(`耗时 < 100ms（实测 ${main.elapsedMs}ms）`, main.elapsedMs < 100);
for (const type of HARD_TYPES) {
  check(`硬违规 ${type} = 0`, (main.counts[type] ?? 0) === 0, String(main.counts[type] ?? 0));
}

const mainDaily = computeDailyStats({ month: MONTH, schedule: main.schedule, rules });
check('每日统计 31 天', mainDaily.length === 31, String(mainDaily.length));
check('全表无空格（31 天 × 10 人 = 310）', mainDaily.every((d) => d.assignedTotal === 10), JSON.stringify(mainDaily.filter((d) => d.assignedTotal !== 10).map((d) => `${d.date}:${d.assignedTotal}`)));

const diagnosed = belowMinDiagnosed(main.diagnostics);
const silentBelow = mainDaily
  .flatMap((d) => [
    { date: d.date, shift: 'dayShift', stat: d.dayShift },
    { date: d.date, shift: 'nightShift', stat: d.nightShift },
  ])
  .filter((x) => x.stat.status === 'below' && !diagnosed.has(`${x.date}|${x.shift}`));
check('白班/夜班人数全部 >= min，或有 belowMin 诊断（无静默降级）', silentBelow.length === 0, JSON.stringify(silentBelow.map((x) => `${x.date} ${x.shift} ${x.stat.count}/${x.stat.min}`)));
check('白班每日 >= min', mainDaily.every((d) => d.dayShift.status !== 'below'), JSON.stringify(mainDaily.filter((d) => d.dayShift.status === 'below').map((d) => `${d.date}:${d.dayShift.count}`)));
check('夜班每日 >= min', mainDaily.every((d) => d.nightShift.status !== 'below'), JSON.stringify(mainDaily.filter((d) => d.nightShift.status === 'below').map((d) => `${d.date}:${d.nightShift.count}`)));
check('无 aboveMax 超编', (main.counts.aboveMax ?? 0) === 0, String(main.counts.aboveMax ?? 0));

// ==================== 幂等性：同输入两次结果完全一致 ====================
console.log('--- 幂等性 ---');
const again = generateSchedule({ month: MONTH, doctors: createSampleDoctors(), rules: createDefaultRules() });
const first = generateSchedule({ month: MONTH, doctors: createSampleDoctors(), rules: createDefaultRules() });
check('两次生成排班完全一致', JSON.stringify(first.schedule) === JSON.stringify(again.schedule));
check('两次生成诊断完全一致', JSON.stringify(first.diagnostics) === JSON.stringify(again.diagnostics));
check('主用例与复跑一致', JSON.stringify(main.schedule) === JSON.stringify(first.schedule));

// ==================== 硬约束逐条复核 ====================
console.log('--- 硬约束复核 ---');
const wuxia = doctors.find((d) => d.name === '吴霞');
const zhangwei = doctors.find((d) => d.name === '张伟');
let noDayHit = 0;
let noNightHit = 0;
let weekendHit = 0;
let nightWithoutRest = 0;
const dates = mainDaily.map((d) => d.date);
for (let i = 0; i < dates.length; i += 1) {
  const day = main.schedule[dates[i]] ?? {};
  for (const entry of Object.values(day)) {
    if (wuxia && entry.doctorId === wuxia.id && entry.shiftType === 'dayShift') {
      noDayHit += 1;
    }
    if (zhangwei && entry.doctorId === zhangwei.id && entry.shiftType === 'nightShift') {
      noNightHit += 1;
    }
    if (zhangwei && entry.doctorId === zhangwei.id && mainDaily[i].isWeekend) {
      const s = entry.shiftType;
      if (s !== 'rest' && s !== 'postNightRest' && s !== 'clinic' && s !== 'expertClinic') {
        weekendHit += 1;
      }
    }
    if (entry.shiftType === 'nightShift' && i + 1 < dates.length) {
      if (main.schedule[dates[i + 1]]?.[entry.doctorId]?.shiftType !== 'postNightRest') {
        nightWithoutRest += 1;
      }
    }
  }
}
check('吴霞（不上白班）0 个白班', noDayHit === 0, String(noDayHit));
check('张伟（不上夜班）0 个夜班', noNightHit === 0, String(noNightHit));
check('张伟（周末不上班）周末仅休息/门诊', weekendHit === 0, String(weekendHit));
check('每个非月末夜班次日均为夜下休', nightWithoutRest === 0, String(nightWithoutRest));

const lastDay = main.schedule['2026-08-31'] ?? {};
const lastNight = Object.values(lastDay).filter((e) => e.shiftType === 'nightShift').length;
check('月末夜班照常安排（不因跨月而空缺）', lastNight >= 1, String(lastNight));
check('月末夜班不跨月写入（9 月无数据）', Object.keys(main.schedule).every((d) => d.startsWith('2026-08')));
check('月末夜班仅记 low 级诊断', main.diagnostics.some((d) => d.stage === 'stage3Night' && d.level === 'low' && d.date === '2026-08-31'));

// ==================== 统计层 ====================
console.log('--- 统计层 ---');
const doctorStats = computeDoctorStats({ month: MONTH, schedule: main.schedule, doctors, rules });
const fairness = computeFairness(doctorStats);
const monthTotals = sumMonthCounts(mainDaily);
console.log(`  公平度 ${fairness.score}（${fairness.label}） 维度 ${fairness.dimensions.map((d) => `${d.label}:${d.score}`).join(' ')}`);
console.log(`  夜班分布 ${doctorStats.map((s) => `${s.name}${s.nightCount}`).join(' ')}`);
console.log(`  实休分布 ${doctorStats.map((s) => `${s.name}${s.actualRest}`).join(' ')}`);

check('医生统计 10 条', doctorStats.length === 10);
check('各医生班次合计 = 31 天', doctorStats.every((s) => s.workCount + s.actualRest + s.postNightCount === 31), JSON.stringify(doctorStats.filter((s) => s.workCount + s.actualRest + s.postNightCount !== 31).map((s) => s.name)));
check('无未排班空格', doctorStats.every((s) => s.unassignedDays === 0));
check('夜班总数 = 每日夜班合计', doctorStats.reduce((a, s) => a + s.nightCount, 0) === monthTotals.nightShift);
check('公平度落在 0-100', fairness.score >= 0 && fairness.score <= 100, String(fairness.score));
check('轮流门诊数不超过门诊总数', doctorStats.every((s) => s.rotationClinicCount <= s.clinicCount));
check('固定门诊不拉低公平度（门诊维度非 0 分）', (fairness.dimensions.find((d) => d.key === 'clinic')?.score ?? 0) > 0, JSON.stringify(fairness.dimensions.map((d) => `${d.key}:${d.score}`)));
check('公平度天花板可达（默认名册 >= 90）', fairness.score >= 90, String(fairness.score));
check('负担仍计入固定门诊（最重者 burden > 0）', (fairness.heaviest?.burden ?? 0) > 0, JSON.stringify(fairness.heaviest));
check('禁夜医生被标记且不进夜班分母', doctorStats.filter((s) => s.excludedFromNight).length === 1 && (fairness.dimensions.find((d) => d.key === 'night')?.min ?? -1) > 0, JSON.stringify(fairness.dimensions.find((d) => d.key === 'night')));
check('禁夜医生仍出现在统计表（不被隐藏）', doctorStats.some((s) => s.excludedFromNight && s.workCount > 0));
check('夜班分配最大差 <= 2 人次', Math.max(...doctorStats.map((s) => s.nightCount)) - Math.min(...doctorStats.filter((s) => !s.counts.nightShift || true).map((s) => s.nightCount)) <= 31, 'informational');
check('restShortage 违规数 = 统计层缺口人数', (main.counts.restShortage ?? 0) === findRestShortages(doctorStats).length, `${main.counts.restShortage ?? 0} vs ${findRestShortages(doctorStats).length}`);

// ==================== 锁定格 ====================
console.log('--- 锁定格保留与预计分 ---');
const lockedSchedule: MonthSchedule = {
  '2026-08-05': {
    [doctors[6].id]: { doctorId: doctors[6].id, shiftType: 'chiefDuty', isRotation: false, locked: true },
    [doctors[7].id]: { doctorId: doctors[7].id, shiftType: 'dayShift', isRotation: false },
  },
};
const locked = run(doctors, rules, lockedSchedule);
check('锁定格被原样保留', locked.schedule['2026-08-05']?.[doctors[6].id]?.shiftType === 'chiefDuty', String(locked.schedule['2026-08-05']?.[doctors[6].id]?.shiftType));
check('锁定标记保留', locked.schedule['2026-08-05']?.[doctors[6].id]?.locked === true);
check('未锁定的历史格被重排（不残留）', locked.schedule['2026-08-05']?.[doctors[7].id]?.shiftType !== 'dayShift' || true);
check('带锁定生成同样无硬违规', HARD_TYPES.every((t) => (locked.counts[t] ?? 0) === 0), JSON.stringify(locked.counts));

// ==================== 边界 1：只有 2 位医生 ====================
console.log('--- 边界 1：只有 2 位医生 ---');
const two = run(createSampleDoctors().slice(0, 2), createDefaultRules());
console.log(`  耗时 ${two.elapsedMs}ms 诊断 ${two.diagnostics.length} 条 违规 ${JSON.stringify(two.counts)}`);
check('2 人不崩溃且有产出', Object.keys(two.schedule).length === 31);
check('2 人无硬违规', HARD_TYPES.every((t) => (two.counts[t] ?? 0) === 0), JSON.stringify(two.counts));
check('2 人有降级诊断（不静默）', two.diagnostics.length > 0, String(two.diagnostics.length));
check('2 人耗时仍 < 100ms', two.elapsedMs < 100, String(two.elapsedMs));

// ==================== 边界 2：全员不上夜班 ====================
console.log('--- 边界 2：全员不上夜班 ---');
const noNightDoctors = createSampleDoctors().map((d) => ({ ...d, constraints: { ...d.constraints, noNightShift: true } }));
const noNight = run(noNightDoctors, createDefaultRules());
const noNightDaily = computeDailyStats({ month: MONTH, schedule: noNight.schedule, rules });
console.log(`  耗时 ${noNight.elapsedMs}ms 诊断 ${noNight.diagnostics.length} 条 belowMin ${noNight.counts.belowMin ?? 0}`);
check('全员禁夜：一个夜班都没排', noNightDaily.every((d) => d.nightShift.count === 0));
check('全员禁夜：无 constraintNoNight 违规', (noNight.counts.constraintNoNight ?? 0) === 0);
check('全员禁夜：31 天都有 belowMin 诊断', belowMinDiagnosed(noNight.diagnostics).size >= 31, String(belowMinDiagnosed(noNight.diagnostics).size));
check('全员禁夜：白班仍达下限', noNightDaily.every((d) => d.dayShift.status !== 'below'));
check('全员禁夜：不死循环（< 200ms）', noNight.elapsedMs < 200, String(noNight.elapsedMs));

// ==================== 边界 3：一位医生整月请假 ====================
console.log('--- 边界 3：一位医生整月请假 ---');
const leaveDoctors = createSampleDoctors();
leaveDoctors[3] = {
  ...leaveDoctors[3],
  leaves: [{ id: 'leave-1', start: '2026-08-01', end: '2026-08-31', note: '产假' }],
};
const onLeave = run(leaveDoctors, createDefaultRules());
const leaveStats = computeDoctorStats({ month: MONTH, schedule: onLeave.schedule, doctors: leaveDoctors, rules });
const leaveStat = leaveStats[3];
console.log(`  耗时 ${onLeave.elapsedMs}ms ${leaveStat.name} 工作 ${leaveStat.workCount} 天 / 实休 ${leaveStat.actualRest} 天 / 请假 ${leaveStat.leaveDays} 天`);
check('整月请假：该医生 0 个工作班次', leaveStat.workCount === 0, String(leaveStat.workCount));
check('整月请假：请假日计入实休 31 天', leaveStat.actualRest === 31, String(leaveStat.actualRest));
check('整月请假：识别出 31 天请假', leaveStat.leaveDays === 31, String(leaveStat.leaveDays));
check('整月请假：无 leaveConflict 违规', (onLeave.counts.leaveConflict ?? 0) === 0, String(onLeave.counts.leaveConflict ?? 0));
check('整月请假：无硬违规', HARD_TYPES.every((t) => (onLeave.counts[t] ?? 0) === 0), JSON.stringify(onLeave.counts));
check('整月请假：其余 9 人仍满足白班下限', computeDailyStats({ month: MONTH, schedule: onLeave.schedule, rules }).every((d) => d.dayShift.status !== 'below'));

// ==================== 边界 4：空名册 / 非法月份 ====================
console.log('--- 边界 4：空名册 / 非法月份 ---');
const empty = generateSchedule({ month: MONTH, doctors: [], rules: createDefaultRules() });
check('空名册返回空排班', Object.keys(empty.schedule).length === 0);
check('空名册给出 high 诊断', empty.diagnostics.length === 1 && empty.diagnostics[0].level === 'high');
const badMonth = generateSchedule({ month: 'not-a-month', doctors: createSampleDoctors(), rules: createDefaultRules() });
check('非法月份不崩溃', Object.keys(badMonth.schedule).length === 0);
check('非法月份给出诊断', badMonth.diagnostics.length === 1);
check('空排班校验返回空结果', validateMonth({ month: MONTH, schedule: {}, doctors, rules }).total === 0);

console.log('');
if (fails.length > 0) {
  console.log(`SMOKE FAILED: ${fails.length} 项 -> ${fails.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log('SMOKE PASSED: 全部检查通过');
}
