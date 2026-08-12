// QA-01 备份恢复全链路：畸形输入攻击 + 脏数据渗透检查。
//
// 被测：src/lib/backup.ts (parseBackup / buildBackupJson) 与其依赖的
//       src/lib/storageSchema.ts (migrateBundle / normalize*)。
//
// 验收视角：parseBackup 是「不可信文件 → 应用 state」的唯一信任边界。
// 设计文档承诺（backup.ts 文件头）：
//   ① 老版本备份必须能被读懂（先迁移再归一化）
//   ② 字段缺失降级为默认值而不是整份拒绝
//   ③ 解析失败返回结构化错误，绝不 throw 出去
// 本脚本逐条证伪，并额外追问一个文件头没承诺的问题：
//   「降级」是否降过头了？有没有让语义上不一致的脏数据进入 state？
//
// 运行：vite build --ssr scripts/qaBackup.ts --outDir <tmp> && node <tmp>/qaBackup.js

import './smokeShim';
import type { DataSnapshot } from '../src/types/state';
import type { Doctor, MonthSchedule } from '../src/types/domain';
import { buildBackupJson, parseBackup } from '../src/lib/backup';
import { createDefaultRules, SCHEMA_VERSION } from '../src/constants/defaults';
import { computeDerived } from '../src/core/stats';

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

/** parseBackup 绝不允许抛异常，任何 throw 都直接判定为缺陷 */
function safeParse(text: string): ReturnType<typeof parseBackup> | { threw: string } {
  try {
    return parseBackup(text);
  } catch (reason) {
    return { threw: reason instanceof Error ? reason.message : String(reason) };
  }
}

function isThrown(r: unknown): r is { threw: string } {
  return typeof r === 'object' && r !== null && 'threw' in r;
}

function makeDoctor(id: string, name: string): Doctor {
  return {
    id,
    name,
    title: '主治医师',
    color: '#6D4C41',
    fixedClinicDays: [],
    constraints: { noDayShift: false, noNightShift: false, weekendOff: false },
    leaves: [],
  };
}

console.log('\n===== QA-01 备份恢复：畸形输入 =====\n');

// ---------- [1] 非法 JSON / 非对象顶层 ----------
console.log('[1] 非法 JSON 与非对象顶层');
{
  const cases: Array<[string, string]> = [
    ['空字符串', ''],
    ['纯空白', '   \n\t '],
    ['截断的 JSON', '{"app":"warmshift","data":{"doctors":[{"id":"a","nam'],
    ['只有半个数组', '{"doctors":[{"id":"a"},'],
    ['裸字符串', '"hello"'],
    ['裸数字', '12345'],
    ['裸 null', 'null'],
    ['顶层数组', '[1,2,3]'],
    ['顶层 true', 'true'],
    ['HTML 误选', '<!DOCTYPE html><html><body>not json</body></html>'],
    ['二进制噪声', '\u0000\u0001\u0002\uFFFD'],
    ['只有 BOM', '\uFEFF'],
  ];
  for (const [label, text] of cases) {
    const r = safeParse(text);
    if (isThrown(r)) {
      check(`${label} 不抛异常`, false, `throw: ${r.threw}`);
      continue;
    }
    check(`${label} → ok:false 且有错误文案`, r.ok === false && typeof r.error === 'string' && r.error.length > 0);
  }
}

// ---------- [2] schemaVersion 边界 ----------
console.log('\n[2] schemaVersion 边界');
{
  const high = JSON.stringify({ app: 'warmshift', schemaVersion: SCHEMA_VERSION + 1, data: { doctors: [], rules: {}, schedules: {} } });
  const r1 = safeParse(high);
  check(
    '版本高于当前 → 拒绝恢复',
    !isThrown(r1) && r1.ok === false && /高于当前应用/.test(r1.error),
  );

  const huge = JSON.stringify({ schemaVersion: 999999, data: { doctors: [], rules: {}, schedules: {} } });
  const r2 = safeParse(huge);
  check('版本 999999 → 拒绝恢复', !isThrown(r2) && r2.ok === false);

  // 版本为字符串：代码用 typeof === 'number' 判定，落回 SCHEMA_VERSION，属于「宽容降级」
  const strVer = JSON.stringify({ schemaVersion: '99', data: { doctors: [], rules: {}, schedules: {} } });
  const r3 = safeParse(strVer);
  check('版本为字符串 "99" → 按当前版本宽容处理（不误判为超版本）', !isThrown(r3) && r3.ok === true);

  // 负数 / NaN 序列化后为 null
  const neg = JSON.stringify({ schemaVersion: -5, data: { doctors: [], rules: {}, schedules: {} } });
  const r4 = safeParse(neg);
  check('版本为负数 → 不崩溃（迁移循环不死锁）', !isThrown(r4) && r4.ok === true);
}

// ---------- [3] 字段类型错误 → 降级为默认值 ----------
console.log('\n[3] 字段类型错误的降级');
{
  const bad = JSON.stringify({
    schemaVersion: 1,
    data: {
      doctors: 'not-an-array',
      rules: 42,
      schedules: 'nope',
    },
  });
  const r = safeParse(bad);
  check('doctors/rules/schedules 全类型错误 → 仍 ok:true 并降级', !isThrown(r) && r.ok === true);
  if (!isThrown(r) && r.ok) {
    check('  doctors 降级为空数组', Array.isArray(r.snapshot.doctors) && r.snapshot.doctors.length === 0);
    check('  rules 降级为默认规则', r.snapshot.rules.departmentName === createDefaultRules().departmentName);
    check('  schedules 降级为空对象', Object.keys(r.snapshot.schedules).length === 0);
  }

  // 医生数组内混入垃圾条目
  const mixed = JSON.stringify({
    data: {
      doctors: [
        null,
        123,
        'str',
        [],
        { name: '缺 id' },
        { id: 'has-id-no-name' },
        { id: 'ok1', name: '张三', title: '不存在的职称', color: 999, fixedClinicDays: 'bad', constraints: 'bad' },
        { id: 'ok2', name: '李四', fixedClinicDays: [0, 3, 99, -1, 6, 'x'] },
      ],
      rules: {},
      schedules: {},
    },
  });
  const r2 = safeParse(mixed);
  check('医生数组混入垃圾 → 只保留合法条目', !isThrown(r2) && r2.ok === true);
  if (!isThrown(r2) && r2.ok) {
    const ds = r2.snapshot.doctors;
    check('  垃圾条目被丢弃，仅剩 2 位合法医生', ds.length === 2, `实际 ${ds.length}`);
    const ok1 = ds.find((d) => d.id === 'ok1');
    check('  非法 title 回落为「主治医师」', ok1?.title === '主治医师', `实际 ${ok1?.title}`);
    check('  非法 color 回落为默认色', ok1?.color === '#6D4C41', `实际 ${ok1?.color}`);
    check('  非法 fixedClinicDays 回落为空数组', Array.isArray(ok1?.fixedClinicDays) && ok1.fixedClinicDays.length === 0);
    check('  constraints 非对象时三个开关均为 false',
      ok1?.constraints.noDayShift === false && ok1?.constraints.noNightShift === false && ok1?.constraints.weekendOff === false);
    const ok2 = ds.find((d) => d.id === 'ok2');
    check('  fixedClinicDays 过滤越界值 [0,3,6]',
      JSON.stringify(ok2?.fixedClinicDays) === JSON.stringify([0, 3, 6]), `实际 ${JSON.stringify(ok2?.fixedClinicDays)}`);
  }
}

// ---------- [4] 规则数值越界钳制 ----------
console.log('\n[4] 规则数值越界钳制');
{
  const wild = JSON.stringify({
    data: {
      doctors: [],
      rules: {
        departmentName: '',
        restDaysPerMonth: 9999,
        shiftsByWeekday: {
          '0': { dayShift: { min: 50, max: -3 }, nightShift: { min: 'x', max: null } },
          '1': { dayShift: { min: 5, max: 2 } },
        },
        rotationRules: [
          { weekday: 99, doctorIds: ['ghost-1', 42, null], mode: 'nonsense' },
          'garbage',
          { noWeekday: true },
        ],
      },
      schedules: {},
    },
  });
  const r = safeParse(wild);
  check('极端规则值 → ok:true', !isThrown(r) && r.ok === true);
  if (!isThrown(r) && r.ok) {
    const ru = r.snapshot.rules;
    check('  空科室名回落默认值', ru.departmentName === '内分泌科', `实际「${ru.departmentName}」`);
    check('  restDaysPerMonth 9999 被钳制到 ≤31', ru.restDaysPerMonth <= 31, `实际 ${ru.restDaysPerMonth}`);
    const d0 = ru.shiftsByWeekday[0].dayShift;
    check('  min/max 倒挂被纠正为 min ≤ max', d0.min <= d0.max, `实际 min=${d0.min} max=${d0.max}`);
    check('  人数上限被钳制到 ≤20', d0.max <= 20 && d0.min <= 20, `实际 min=${d0.min} max=${d0.max}`);
    const d1 = ru.shiftsByWeekday[1].dayShift;
    check('  周一 min5/max2 纠正为 min2/max5', d1.min === 2 && d1.max === 5, `实际 min=${d1.min} max=${d1.max}`);
    check('  非法 rotationRule 条目被丢弃', ru.rotationRules.length === 1, `实际 ${ru.rotationRules.length}`);
    if (ru.rotationRules.length === 1) {
      const rot = ru.rotationRules[0];
      check('  weekday 99 被钳制到 0-6', rot.weekday >= 0 && rot.weekday <= 6, `实际 ${rot.weekday}`);
      check('  非法 mode 回落为 all', rot.mode === 'all', `实际 ${rot.mode}`);
      check('  doctorIds 过滤非字符串', rot.doctorIds.length === 1 && rot.doctorIds[0] === 'ghost-1');
    }
  }
}

// ---------- [5] 月份键与日期键的合法性 ----------
console.log('\n[5] 月份键 / 日期键合法性');
{
  const weird = JSON.stringify({
    data: {
      doctors: [makeDoctor('d1', '张三')],
      rules: {},
      schedules: {
        'not-a-month': { '2026-08-01': { d1: { doctorId: 'd1', shiftType: 'dayShift' } } },
        '2026-8': { '2026-08-01': { d1: { doctorId: 'd1', shiftType: 'dayShift' } } },
        '2026-08': {
          '2026-08-01': { d1: { doctorId: 'd1', shiftType: 'dayShift' } },
          'bad-date': { d1: { doctorId: 'd1', shiftType: 'dayShift' } },
          '2026-08-02': { d1: { doctorId: 'd1', shiftType: '不存在的班次' } },
        },
      },
    },
  });
  const r = safeParse(weird);
  check('畸形月份键 → ok:true', !isThrown(r) && r.ok === true);
  if (!isThrown(r) && r.ok) {
    const months = Object.keys(r.snapshot.schedules);
    check('  非法月份键 not-a-month / 2026-8 被丢弃', !months.includes('not-a-month') && !months.includes('2026-8'), `实际 ${JSON.stringify(months)}`);
    check('  合法月份 2026-08 保留', months.includes('2026-08'));
    const aug = r.snapshot.schedules['2026-08'] ?? {};
    check('  非法日期键 bad-date 被丢弃', !('bad-date' in aug));
    check('  未知 shiftType 的条目被丢弃', !('2026-08-02' in aug), `实际残留 ${JSON.stringify(Object.keys(aug))}`);
  }

  // 语义非法但格式合法的日期：正则只校验 \d{4}-\d{2}-\d{2}
  const semantic = JSON.stringify({
    data: {
      doctors: [makeDoctor('d1', '张三')],
      rules: {},
      schedules: {
        '2026-13': { '2026-13-45': { d1: { doctorId: 'd1', shiftType: 'dayShift' } } },
        '2026-02': { '2026-02-31': { d1: { doctorId: 'd1', shiftType: 'dayShift' } } },
      },
    },
  });
  const r2 = safeParse(semantic);
  if (!isThrown(r2) && r2.ok) {
    const months = Object.keys(r2.snapshot.schedules);
    check(
      '  语义非法月份 2026-13 被接受（正则未校验语义）→ 记录为观察项',
      months.includes('2026-13'),
      '若此断言失败说明已加语义校验，是改进',
    );
    check(
      '  语义非法日期 2026-02-31 被接受 → 记录为观察项',
      Object.keys(r2.snapshot.schedules['2026-02'] ?? {}).includes('2026-02-31'),
    );
  }

  // 日期与所属月份不一致
  const crossMonth = JSON.stringify({
    data: {
      doctors: [makeDoctor('d1', '张三')],
      rules: {},
      schedules: { '2026-08': { '2026-09-15': { d1: { doctorId: 'd1', shiftType: 'dayShift' } } } },
    },
  });
  const r3 = safeParse(crossMonth);
  if (!isThrown(r3) && r3.ok) {
    const aug = r3.snapshot.schedules['2026-08'] ?? {};
    check(
      '  跨月日期 2026-09-15 存进 2026-08 桶 → 记录为观察项',
      Object.keys(aug).includes('2026-09-15'),
    );
  }
}

// ---------- [6] 孤儿数据：排班引用了不存在的医生 ----------
console.log('\n[6] 孤儿数据渗透（重点）');
{
  const orphan = JSON.stringify({
    data: {
      doctors: [makeDoctor('alive', '在册医生')],
      rules: {},
      schedules: {
        '2026-08': {
          '2026-08-03': {
            alive: { doctorId: 'alive', shiftType: 'dayShift' },
            ghost1: { doctorId: 'ghost1', shiftType: 'dayShift' },
            ghost2: { doctorId: 'ghost2', shiftType: 'dayShift' },
            ghost3: { doctorId: 'ghost3', shiftType: 'nightShift' },
          },
        },
      },
    },
  });
  const r = safeParse(orphan);
  check('孤儿数据文件 → ok:true（不拒绝整份）', !isThrown(r) && r.ok === true);

  if (!isThrown(r) && r.ok) {
    const aug = r.snapshot.schedules['2026-08']['2026-08-03'];
    const orphanIds = Object.keys(aug).filter((id) => id !== 'alive');
    const leaked = orphanIds.length > 0;
    check(
      '  parseBackup 未剔除孤儿条目（缺陷探针）',
      !leaked,
      `孤儿 id 进入 state: ${JSON.stringify(orphanIds)} —— 若此项 FAIL 即为已确认缺陷`,
    );

    // 下游影响：孤儿是否污染统计与校验
    const derived = computeDerived({
      month: '2026-08',
      schedule: r.snapshot.schedules['2026-08'],
      doctors: r.snapshot.doctors,
      rules: r.snapshot.rules,
    });
    const day3 = derived.dailyStats.find((s) => s.date === '2026-08-03');
    const dayCount = day3?.counts.dayShift ?? -1;
    const nightCount = day3?.counts.nightShift ?? -1;
    check(
      '  每日统计只计在册医生（白班应为 1）',
      dayCount === 1,
      `实际白班 ${dayCount} 人 —— 孤儿被计入则为 3`,
    );
    check(
      '  每日统计夜班应为 0（唯一夜班属于孤儿）',
      nightCount === 0,
      `实际夜班 ${nightCount} 人`,
    );
    const phantom = derived.validation.violations.filter((v) => v.doctorId !== undefined && v.doctorId.startsWith('ghost'));
    check('  校验器不产出针对孤儿医生的违规', phantom.length === 0, `实际 ${phantom.length} 条`);
  }
}

// ---------- [7] 空数组 / 空对象 / 缺字段 ----------
console.log('\n[7] 空值与缺字段');
{
  const cases: Array<[string, string]> = [
    ['完全空对象 {}', '{}'],
    ['只有 app 字段', '{"app":"warmshift"}'],
    ['data 为空对象', '{"data":{}}'],
    ['三字段皆空', '{"data":{"doctors":[],"rules":{},"schedules":{}}}'],
    ['data 为 null（回落裸快照）', '{"data":null,"doctors":[],"rules":{},"schedules":{}}'],
    ['schedules 内月份值为 null', '{"data":{"doctors":[],"rules":{},"schedules":{"2026-08":null}}}'],
    ['schedules 内某日为空对象', '{"data":{"doctors":[],"rules":{},"schedules":{"2026-08":{"2026-08-01":{}}}}}'],
  ];
  for (const [label, text] of cases) {
    const r = safeParse(text);
    check(`${label} → ok:true 且结构完整`,
      !isThrown(r) && r.ok === true && Array.isArray(r.snapshot.doctors) && typeof r.snapshot.rules === 'object' && typeof r.snapshot.schedules === 'object',
      isThrown(r) ? `throw: ${r.threw}` : '');
  }

  const emptyDay = safeParse('{"data":{"doctors":[],"rules":{},"schedules":{"2026-08":{"2026-08-01":{}}}}}');
  if (!isThrown(emptyDay) && emptyDay.ok) {
    check('  空壳月份不写入 schedules（避免空 key）', Object.keys(emptyDay.snapshot.schedules).length === 0);
  }
}

// ---------- [8] 原型污染 ----------
console.log('\n[8] 原型污染防御');
{
  const pollute = '{"data":{"doctors":[],"rules":{},"schedules":{"2026-08":{"2026-08-01":{"__proto__":{"polluted":true},"constructor":{"shiftType":"rest"}}}}},"__proto__":{"hacked":true}}';
  const r = safeParse(pollute);
  check('含 __proto__ 的备份不抛异常', !isThrown(r));
  const probe: Record<string, unknown> = {};
  check('Object.prototype 未被污染 (polluted)', (probe as { polluted?: unknown }).polluted === undefined);
  check('Object.prototype 未被污染 (hacked)', (probe as { hacked?: unknown }).hacked === undefined);
}

// ---------- [9] 超大文件 ----------
console.log('\n[9] 超大输入');
{
  const doctors: Doctor[] = [];
  for (let i = 0; i < 200; i += 1) {
    doctors.push(makeDoctor(`d${i}`, `医生${i}`));
  }
  const schedules: Record<string, MonthSchedule> = {};
  for (let m = 1; m <= 12; m += 1) {
    const month = `2026-${String(m).padStart(2, '0')}`;
    const ms: MonthSchedule = {};
    for (let day = 1; day <= 28; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const bucket: MonthSchedule[string] = {};
      for (const d of doctors) {
        bucket[d.id] = { doctorId: d.id, shiftType: 'dayShift', isRotation: false };
      }
      ms[date] = bucket;
    }
    schedules[month] = ms;
  }
  const snapshot: DataSnapshot = { doctors, rules: createDefaultRules(), schedules };
  const json = buildBackupJson(snapshot);
  const sizeMb = Buffer.byteLength(json, 'utf8') / 1024 / 1024;

  const started = performance.now();
  const r = safeParse(json);
  const elapsed = performance.now() - started;
  check(`超大备份 (${sizeMb.toFixed(1)}MB / 200 医生 × 12 月) 解析不抛异常`, !isThrown(r));
  check(`  解析耗时 ${elapsed.toFixed(0)}ms < 3000ms`, elapsed < 3000);
  if (!isThrown(r) && r.ok) {
    check('  医生数量无损', r.snapshot.doctors.length === 200, `实际 ${r.snapshot.doctors.length}`);
    check('  月份数量无损', Object.keys(r.snapshot.schedules).length === 12);
  }
}

// ---------- [10] 往返保真 ----------
console.log('\n[10] 导出 → 恢复 往返保真');
{
  const doctors = [makeDoctor('d1', '张伟'), makeDoctor('d2', '李娜')];
  doctors[0].fixedClinicDays = [1, 4];
  doctors[0].constraints.noNightShift = true;
  doctors[0].leaves = [{ id: 'l1', start: '2026-08-10', end: '2026-08-12', note: '年假' }];
  const rules = createDefaultRules();
  rules.departmentName = '心血管内科';
  rules.restDaysPerMonth = 6;
  rules.rotationRules = [{ id: 'r1', weekday: 2, doctorIds: ['d1'], mode: 'selected' }];
  const schedules: Record<string, MonthSchedule> = {
    '2026-08': {
      '2026-08-01': {
        d1: { doctorId: 'd1', shiftType: 'clinic', isRotation: true, locked: true },
        d2: { doctorId: 'd2', shiftType: 'nightShift', isRotation: false, manual: true },
      },
    },
  };
  const snapshot: DataSnapshot = { doctors, rules, schedules };
  const r = safeParse(buildBackupJson(snapshot));
  check('往返解析成功', !isThrown(r) && r.ok === true);
  if (!isThrown(r) && r.ok) {
    const s = r.snapshot;
    check('  医生数与姓名保真', s.doctors.length === 2 && s.doctors[0].name === '张伟');
    check('  固定门诊日保真', JSON.stringify(s.doctors[0].fixedClinicDays) === JSON.stringify([1, 4]));
    check('  个人约束保真', s.doctors[0].constraints.noNightShift === true);
    check('  请假记录保真', s.doctors[0].leaves?.length === 1 && s.doctors[0].leaves[0].note === '年假');
    check('  科室名保真', s.rules.departmentName === '心血管内科');
    check('  月休天数保真', s.rules.restDaysPerMonth === 6);
    check('  轮流规则保真', s.rules.rotationRules.length === 1 && s.rules.rotationRules[0].mode === 'selected');
    const cell = s.schedules['2026-08']['2026-08-01'];
    check('  班次类型保真', cell.d1.shiftType === 'clinic' && cell.d2.shiftType === 'nightShift');
    check('  isRotation 保真', cell.d1.isRotation === true);
    check('  locked 保真', cell.d1.locked === true);
    check('  manual 保真', cell.d2.manual === true);
  }
}

// ---------- [11] 裸快照兼容 ----------
console.log('\n[11] 裸快照（无 data 包装）兼容');
{
  const bare = JSON.stringify({
    doctors: [makeDoctor('d1', '王芳')],
    rules: { departmentName: '呼吸科' },
    schedules: { '2026-08': { '2026-08-01': { d1: { doctorId: 'd1', shiftType: 'rest' } } } },
  });
  const r = safeParse(bare);
  check('裸快照被识别', !isThrown(r) && r.ok === true);
  if (!isThrown(r) && r.ok) {
    check('  医生读入', r.snapshot.doctors.length === 1 && r.snapshot.doctors[0].name === '王芳');
    check('  科室名读入', r.snapshot.rules.departmentName === '呼吸科');
    check('  排班读入', Object.keys(r.snapshot.schedules).length === 1);
  }
}

console.log(`\n---- QA-01 结果：${total - fails.length}/${total} 通过 ----`);
console.log(fails.length === 0 ? 'QA-01 PASS' : `QA-01 FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
