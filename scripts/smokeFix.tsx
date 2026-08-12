// QA 缺陷修复烟测（BUG-01 ~ BUG-04）。
// 与其他 smoke 脚本同构：不参与 src 构建，用 `vite build --ssr` 打包后由 node 执行。
//
// 覆盖范围：
//   [1] BUG-01 层2  四条已验证崩溃路径进 computeDerived 不抛，且产出仍可消费
//   [2] BUG-01 层2  同样的脏数据直连 validateMonth（生成器 stage6Repair 路径）不抛
//   [3] BUG-01 层1  dataShape 形状保证：null / undefined 子对象一律补齐
//   [4] BUG-01 层3  ErrorBoundary 降级 UI + 清空本地数据 + 已挂载在 App 外层
//   [5] BUG-02      parseBackup 剔除孤儿排班条目，在册条目全部保留
//   [6] BUG-03      锁定格非法 shiftType 被拦截，合法锁定格照常保留
//   [7] BUG-04      11 种班次色卡对比度 >= 4.5:1，且 tokens.css 与 SHIFT_METAS 同步

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './smokeShim';
import type { Doctor, MonthSchedule, Rules, ShiftType } from '../src/types/domain';
import { createDefaultRules, createSampleDoctors, STORAGE_KEYS, STORAGE_NAMESPACE } from '../src/constants/defaults';
import { SHIFT_METAS, SHIFT_ORDER } from '../src/constants/shifts';
import { computeDerived } from '../src/core/stats';
import { validateMonth } from '../src/core/validator';
import { generateSchedule } from '../src/core/generator';
import { ensureDoctorsShape, ensureRulesShape, pruneOrphanEntries } from '../src/lib/dataShape';
import { buildBackupJson, parseBackup } from '../src/lib/backup';
import { ErrorBoundary, clearAppStorage } from '../src/components/ui/ErrorBoundary';

const ROOT = process.cwd();
const MONTH = '2026-08';
const fails: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

/** 跑一段可能抛错的代码，把「抛没抛」和「抛了什么」一并交回 */
function attempt<T>(fn: () => T): { ok: boolean; value?: T; message: string } {
  try {
    return { ok: true, value: fn(), message: '' };
  } catch (reason) {
    return { ok: false, message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason) };
  }
}

function readSrc(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

// ============ 脏数据构造器：逐条对应 QA 报告里的崩溃路径 ============

function cleanDoctors(): Doctor[] {
  return createSampleDoctors().slice(0, 3);
}

/** 一份结构正常的两日排班，作为「脏数据只污染自己」的对照组 */
function cleanSchedule(doctors: Doctor[]): MonthSchedule {
  return {
    '2026-08-01': {
      [doctors[0].id]: { doctorId: doctors[0].id, shiftType: 'dayShift', isRotation: false },
      [doctors[1].id]: { doctorId: doctors[1].id, shiftType: 'nightShift', isRotation: false },
    },
    '2026-08-02': {
      [doctors[0].id]: { doctorId: doctors[0].id, shiftType: 'rest', isRotation: false },
      [doctors[1].id]: { doctorId: doctors[1].id, shiftType: 'postNightRest', isRotation: false },
    },
  };
}

/** 路径 A：entry = null */
function scheduleWithNullEntry(doctors: Doctor[]): MonthSchedule {
  const schedule = cleanSchedule(doctors);
  (schedule['2026-08-01'] as Record<string, unknown>)[doctors[2].id] = null;
  return schedule;
}

/** 路径 B：rules.shiftsByWeekday = null */
function rulesWithNullWeekdays(): Rules {
  return { ...createDefaultRules(), shiftsByWeekday: null } as unknown as Rules;
}

/** 路径 C：rules.rules = undefined */
function rulesWithUndefinedRules(): Rules {
  const rules = { ...createDefaultRules() } as Record<string, unknown>;
  delete rules.rules;
  return rules as unknown as Rules;
}

/** 路径 D：医生缺 constraints */
function doctorsWithoutConstraints(): Doctor[] {
  const doctors = cleanDoctors();
  const broken = { ...doctors[1] } as Record<string, unknown>;
  delete broken.constraints;
  return [doctors[0], broken as unknown as Doctor, doctors[2]];
}

// ============ [1] BUG-01 层2：四条崩溃路径进 computeDerived ============

console.log('\n[1] BUG-01 computeDerived 四条崩溃路径');
{
  const doctors = cleanDoctors();

  const caseA = attempt(() =>
    computeDerived({ month: MONTH, schedule: scheduleWithNullEntry(doctors), doctors, rules: createDefaultRules() }),
  );
  check('路径A entry=null 不抛', caseA.ok, caseA.message);
  check('路径A 其余干净条目仍被统计', (caseA.value?.dailyStats[0]?.assignedTotal ?? -1) === 2);

  const caseB = attempt(() =>
    computeDerived({ month: MONTH, schedule: cleanSchedule(doctors), doctors, rules: rulesWithNullWeekdays() }),
  );
  check('路径B rules.shiftsByWeekday=null 不抛', caseB.ok, caseB.message);
  check('路径B 区间配置已补默认值', (caseB.value?.dailyStats[0]?.dayShift.status ?? 'none') !== 'none');

  const caseC = attempt(() =>
    computeDerived({ month: MONTH, schedule: cleanSchedule(doctors), doctors, rules: rulesWithUndefinedRules() }),
  );
  check('路径C rules.rules=undefined 不抛', caseC.ok, caseC.message);
  check('路径C 仍产出 31 天统计', (caseC.value?.dailyStats.length ?? 0) === 31);

  const brokenDoctors = doctorsWithoutConstraints();
  const caseD = attempt(() =>
    computeDerived({
      month: MONTH,
      schedule: cleanSchedule(brokenDoctors),
      doctors: brokenDoctors,
      rules: createDefaultRules(),
    }),
  );
  check('路径D 医生缺 constraints 不抛', caseD.ok, caseD.message);
  check('路径D 缺约束医生按「无约束」处理', caseD.value?.doctorStats[1]?.excludedFromNight === false);
  check('路径D 医生统计条数与名册一致', (caseD.value?.doctorStats.length ?? 0) === 3);

  // 四条同时发作：最坏情况也只能造成局部缺失
  const worst = attempt(() =>
    computeDerived({
      month: MONTH,
      schedule: scheduleWithNullEntry(brokenDoctors),
      doctors: brokenDoctors,
      rules: { shiftsByWeekday: null } as unknown as Rules,
    }),
  );
  check('四条崩溃路径叠加仍不抛', worst.ok, worst.message);
  check('叠加场景产出结构完整', worst.value?.validation !== undefined && (worst.value?.doctorStats.length ?? 0) === 3);

  // 极端入参：整份 params 全空
  const empty = attempt(() =>
    computeDerived({ month: MONTH, schedule: null, doctors: null, rules: null } as unknown as {
      month: string;
      schedule: MonthSchedule;
      doctors: Doctor[];
      rules: Rules;
    }),
  );
  check('schedule/doctors/rules 全为 null 不抛', empty.ok, empty.message);
}

// ============ [2] BUG-01 层2：脏数据直连 validateMonth（生成器修复阶段路径）============

console.log('\n[2] BUG-01 validateMonth 直连脏数据');
{
  const brokenDoctors = doctorsWithoutConstraints();
  const dirty = scheduleWithNullEntry(brokenDoctors);

  const r1 = attempt(() =>
    validateMonth({ month: MONTH, schedule: dirty, doctors: brokenDoctors, rules: createDefaultRules() }),
  );
  check('entry=null + 缺 constraints 直连校验不抛', r1.ok, r1.message);

  const r2 = attempt(() =>
    validateMonth({ month: MONTH, schedule: dirty, doctors: brokenDoctors, rules: rulesWithNullWeekdays() }),
  );
  check('shiftsByWeekday=null 直连校验不抛', r2.ok, r2.message);

  const r3 = attempt(() =>
    validateMonth({ month: MONTH, schedule: dirty, doctors: brokenDoctors, rules: rulesWithUndefinedRules() }),
  );
  check('rules.rules=undefined 直连校验不抛', r3.ok, r3.message);

  const r4 = attempt(() =>
    validateMonth({ month: MONTH, schedule: null, doctors: null, rules: createDefaultRules() } as unknown as {
      month: string;
      schedule: MonthSchedule;
      doctors: Doctor[];
      rules: Rules;
    }),
  );
  check('schedule/doctors 为 null 时校验返回空结果', r4.ok && r4.value?.total === 0, r4.message);
}

// ============ [3] BUG-01 层1：dataShape 形状保证 ============

console.log('\n[3] BUG-01 dataShape 形状保证');
{
  const fromNull = ensureRulesShape(null);
  check('ensureRulesShape(null) 覆盖 0~6 全部 weekday', [0, 1, 2, 3, 4, 5, 6].every((w) => !!fromNull.shiftsByWeekday[w]));
  check('ensureRulesShape(null) 补出 rules 子对象', typeof fromNull.rules?.noConsecutiveNightShift === 'boolean');

  const fixedB = ensureRulesShape(rulesWithNullWeekdays());
  check('shiftsByWeekday=null 被补为完整区间表', !!fixedB.shiftsByWeekday[6]?.nightShift);
  const fixedC = ensureRulesShape(rulesWithUndefinedRules());
  check('rules=undefined 被补为默认开关', fixedC.rules.noConsecutiveNightShift === true);
  check('rotationRules 恒为数组', Array.isArray(ensureRulesShape({} as unknown as Rules).rotationRules));

  const shaped = ensureDoctorsShape(doctorsWithoutConstraints());
  check('缺 constraints 的医生被补齐三项开关', shaped[1].constraints.noDayShift === false && shaped[1].constraints.weekendOff === false);
  check('ensureDoctorsShape(null) 返回空数组', ensureDoctorsShape(null).length === 0);
  check('无法识别的医生条目被剔除', ensureDoctorsShape([null, undefined, {}] as unknown as Doctor[]).length === 0);
}

// ============ [4] BUG-01 层3：ErrorBoundary ============

console.log('\n[4] BUG-01 ErrorBoundary 降级 UI 与自救出口');
{
  // 正常态：原样透传 children
  const pass = renderToStaticMarkup(
    <ErrorBoundary>
      <p>正常内容</p>
    </ErrorBoundary>,
  );
  check('未出错时原样渲染 children', pass.includes('正常内容'));

  // 降级态：SSR 不触发错误边界，因此直接驱动 getDerivedStateFromError + render
  const state = ErrorBoundary.getDerivedStateFromError(
    new TypeError("Cannot read properties of null (reading 'shiftType')"),
  );
  check('getDerivedStateFromError 产出错误态', state.error instanceof Error);

  const boundary = new ErrorBoundary({ children: null });
  boundary.state = state;
  const fallback = renderToStaticMarkup(boundary.render() as ReactElement);
  check('降级 UI 提供「清空本地数据并重新开始」', fallback.includes('清空本地数据并重新开始'));
  check('降级 UI 有中文安抚文案', fallback.includes('这不是你的操作问题'));
  check('降级 UI 说明刷新后仍白屏的处置', fallback.includes('如果刷新之后还是这个页面'));
  check('降级 UI 提示清空不可撤销', fallback.includes('不可撤销'));
  check('降级 UI 带 role=alert', fallback.includes('role="alert"'));
  // 注意：renderToStaticMarkup 会把单引号转义成 &#x27;，断言只取无特殊字符的片段
  check('降级 UI 附技术细节供反馈', fallback.includes('TypeError: Cannot read properties of null'));

  // 自救按钮的实际行为：清掉本应用 key，不碰别人的数据
  const store = globalThis.localStorage;
  store.setItem(STORAGE_KEYS.doctors, '[bad');
  store.setItem(STORAGE_KEYS.rules, '{bad');
  store.setItem(STORAGE_KEYS.meta, '{"schemaVersion":1,"months":["2026-08"]}');
  store.setItem(`${STORAGE_NAMESPACE}:schedules:2026-08`, '{}');
  store.setItem(STORAGE_KEYS.backup, '{"at":1}');
  store.setItem('other-app:key', 'keep-me');
  const removed = clearAppStorage();
  check('clearAppStorage 清掉全部业务 key', removed === 4, `removed=${removed}`);
  check('清空后 doctors/rules/meta 均不存在', store.getItem(STORAGE_KEYS.doctors) === null && store.getItem(STORAGE_KEYS.rules) === null && store.getItem(STORAGE_KEYS.meta) === null);
  check('保留 backup key 供事后追溯', store.getItem(STORAGE_KEYS.backup) === '{"at":1}');
  check('不误伤其他应用的 key', store.getItem('other-app:key') === 'keep-me');
  store.clear();

  // 源纪律：必须是 class 组件、必须实现 componentDidCatch、必须挂在 App 外层
  const boundarySrc = readSrc('src/components/ui/ErrorBoundary.tsx');
  check('ErrorBoundary 是 class 组件', /class ErrorBoundary extends Component</.test(boundarySrc));
  check('实现 componentDidCatch', boundarySrc.includes('componentDidCatch'));
  check('实现 getDerivedStateFromError', boundarySrc.includes('static getDerivedStateFromError'));
  check('清空后触发 reload', boundarySrc.includes('location.reload()'));

  const mainSrc = readSrc('src/main.tsx');
  check('main.tsx 引入 ErrorBoundary', mainSrc.includes("from './components/ui/ErrorBoundary'"));
  check('ErrorBoundary 包在 App 外层', /<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/.test(mainSrc));
}

// ============ [5] BUG-02：parseBackup 剔除孤儿排班条目 ============

console.log('\n[5] BUG-02 备份恢复剔除孤儿条目');
{
  const doctors = cleanDoctors();
  const [keep, alsoKeep] = doctors;
  const schedule: MonthSchedule = {
    '2026-08-01': {
      [keep.id]: { doctorId: keep.id, shiftType: 'dayShift', isRotation: false },
      'ghost-1': { doctorId: 'ghost-1', shiftType: 'nightShift', isRotation: false },
      [alsoKeep.id]: { doctorId: alsoKeep.id, shiftType: 'clinic', isRotation: true },
    },
    // 整天只有孤儿：该日应被整体丢弃
    '2026-08-02': {
      'ghost-2': { doctorId: 'ghost-2', shiftType: 'rest', isRotation: false },
    },
  };
  const json = buildBackupJson({ doctors: [keep, alsoKeep], rules: createDefaultRules(), schedules: { [MONTH]: schedule } });
  const result = parseBackup(json);

  check('含孤儿条目的备份仍可恢复', result.ok === true, result.ok ? '' : result.error);
  if (result.ok) {
    const restored = result.snapshot.schedules[MONTH] ?? {};
    const day1 = restored['2026-08-01'] ?? {};
    check('孤儿条目被剔除', day1['ghost-1'] === undefined);
    check('在册条目全部保留', Object.keys(day1).length === 2 && !!day1[keep.id] && !!day1[alsoKeep.id]);
    check('在册条目内容未被改写', day1[keep.id]?.shiftType === 'dayShift' && day1[alsoKeep.id]?.isRotation === true);
    check('仅剩孤儿的日期被整日丢弃', restored['2026-08-02'] === undefined);
    check('医生名册保持不变', result.snapshot.doctors.length === 2);
  }

  // 名册为空时全部条目都是孤儿
  const noDoctorJson = buildBackupJson({ doctors: [], rules: createDefaultRules(), schedules: { [MONTH]: schedule } });
  const noDoctor = parseBackup(noDoctorJson);
  check('名册为空时排班被全部剔除', noDoctor.ok === true && noDoctor.snapshot.schedules[MONTH] === undefined);

  // 单元级：只剔孤儿，不动其它
  const pruned = pruneOrphanEntries(schedule, new Set([keep.id, alsoKeep.id]));
  check('pruneOrphanEntries 只剔孤儿', Object.keys(pruned['2026-08-01'] ?? {}).length === 2 && pruned['2026-08-02'] === undefined);
}

// ============ [6] BUG-03：锁定格 shiftType 白名单 ============

console.log('\n[6] BUG-03 锁定格非法 shiftType 拦截');
{
  const doctors = cleanDoctors();
  const [d0, d1, d2] = doctors;
  const existing: MonthSchedule = {
    '2026-08-05': {
      [d0.id]: { doctorId: d0.id, shiftType: 'wtf-shift' as unknown as ShiftType, isRotation: false, locked: true },
      [d1.id]: { doctorId: d1.id, shiftType: 'nightShift', isRotation: false, locked: true },
      [d2.id]: { doctorId: d2.id, shiftType: '' as unknown as ShiftType, isRotation: false, locked: true },
      'ghost-x': { doctorId: 'ghost-x', shiftType: 'dayShift', isRotation: false, locked: true },
    },
  };

  const run = attempt(() =>
    generateSchedule({ month: MONTH, doctors, rules: createDefaultRules(), existingSchedule: existing }),
  );
  check('含非法锁定格的生成不抛', run.ok, run.message);

  const day = run.value?.schedule['2026-08-05'] ?? {};
  const shiftTypes = new Set(Object.values(day).map((entry) => entry.shiftType));
  check('非法 shiftType 未进入生成结果', !shiftTypes.has('wtf-shift' as unknown as ShiftType));
  check('空串 shiftType 未进入生成结果', !shiftTypes.has('' as unknown as ShiftType));
  check('孤儿医生锁定格未进入生成结果', day['ghost-x'] === undefined);
  check('合法锁定格被原样保留', day[d1.id]?.shiftType === 'nightShift' && day[d1.id]?.locked === true);
  check('被拦截的格子按「不存在」处理，交还给算法重排', day[d0.id]?.locked !== true);

  // 全月每一格都必须是白名单内的班次
  const legal = new Set<string>(SHIFT_ORDER);
  const illegal: string[] = [];
  for (const [date, dayEntries] of Object.entries(run.value?.schedule ?? {})) {
    for (const entry of Object.values(dayEntries)) {
      if (!legal.has(entry.shiftType)) {
        illegal.push(`${date}/${entry.doctorId}=${entry.shiftType}`);
      }
    }
  }
  check('生成结果全月无非法班次', illegal.length === 0, illegal.slice(0, 3).join(', '));

  const ctxSrc = readSrc('src/core/generator/context.ts');
  check('restoreLockedCells 引入 isShiftType 白名单', /isShiftType\(entry\.shiftType\)/.test(ctxSrc));
}

// ============ [7] BUG-04：班次色卡对比度 ============

console.log('\n[7] BUG-04 色卡对比度（WCAG AA >= 4.5:1）');
{
  /** sRGB 通道线性化（WCAG 2.x 定义） */
  function channel(value: number): number {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }

  /** 相对亮度 L = 0.2126R + 0.7152G + 0.0722B */
  function luminance(hex: string): number {
    const v = parseInt(hex.replace('#', ''), 16);
    const r = channel((v >> 16) & 0xff);
    const g = channel((v >> 8) & 0xff);
    const b = channel(v & 0xff);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** 对比度 (L_light + 0.05) / (L_dark + 0.05) */
  function contrast(fg: string, bg: string): number {
    const a = luminance(fg);
    const b = luminance(bg);
    const [light, dark] = a > b ? [a, b] : [b, a];
    return (light + 0.05) / (dark + 0.05);
  }

  // 自检：公式必须能算对两个已知锚点（纯黑/纯白 = 21，同色 = 1）
  check('对比度公式自检 #000/#fff = 21', Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  check('对比度公式自检 同色 = 1', Math.abs(contrast('#558B2F', '#558B2F') - 1) < 0.001);

  const ratios = new Map<ShiftType, number>();
  for (const key of SHIFT_ORDER) {
    const meta = SHIFT_METAS[key];
    const ratio = contrast(meta.fg, meta.bg);
    ratios.set(key, ratio);
    check(`${meta.label}「${meta.short}」对比度 >= 4.5`, ratio >= 4.5, `${ratio.toFixed(2)}:1 (${meta.fg} on ${meta.bg})`);
  }

  // 三个被点名的色卡：逐个报出修复后的具体数值
  for (const key of ['clinic', 'continuousShift', 'deputyShift'] as ShiftType[]) {
    console.log(`       · ${SHIFT_METAS[key].label} ${SHIFT_METAS[key].fg} on ${SHIFT_METAS[key].bg} = ${(ratios.get(key) ?? 0).toFixed(2)}:1`);
  }

  // 协调性：不能为了达标把某一色压得远深于其余（极差控制在 6 以内）
  const values = Array.from(ratios.values());
  const spread = Math.max(...values) - Math.min(...values);
  check('11 色对比度分布协调（极差 < 6）', spread < 6, `spread=${spread.toFixed(2)}`);

  // 双向绑定：tokens.css 的 --shift-*-bg/fg 必须与 SHIFT_METAS 完全一致
  const tokens = readSrc('src/styles/tokens.css');
  for (const key of SHIFT_ORDER) {
    const meta = SHIFT_METAS[key];
    for (const slot of ['bg', 'fg'] as const) {
      const match = new RegExp(`--shift-${key}-${slot}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
      const declared = match?.[1]?.toLowerCase() ?? '';
      check(`tokens.css --shift-${key}-${slot} 与 SHIFT_METAS 同步`, declared === meta[slot].toLowerCase(), `${declared} vs ${meta[slot].toLowerCase()}`);
    }
  }
}

console.log(fails.length === 0 ? '\nFIX SMOKE PASS' : `\nFIX SMOKE FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
