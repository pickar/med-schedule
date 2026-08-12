// T05b 烟测：洞察面板 + 生成流程接线 + 备份恢复（SSR 渲染验证）。
// 覆盖六类场景：
//   [1] InsightPanel 容器整体结构 + 生成说明（lastDiagnostics）过滤
//   [2] ViolationList：定位按钮 + severity 着色 + 空态
//   [3] WorkloadBoard：四维度条 + clinic tooltip + 极值 null + 夜班豁免
//   [4] RestShortageSection（内联于 InsightPanel）：缺口进度 + 全员达标空态
//   [5] GenerateNote：仅渲染 high 级诊断，中低档被过滤
//   [6] BackupControls：parseBackup 单元（合法/非法/超版本）+ 源纪律
// 不参与 src 构建（tsconfig include 仅 ["src"]），用 `vite build --ssr` 打包后由 node 执行。
//
// 关于 Portal 的取舍：BackupControls / ConfirmDialog / Modal 依赖 createPortal，
// 在 renderToStaticMarkup 下会抛 "Portals are not currently supported"。因此烟测只渲染
// 纯展示层（InsightPanel 及其三个子块，均不碰 Portal），BackupControls 仅做 parseBackup
// 单元级断言与源纪律检查，与「容器 / 纯视图」分家的设计一一对应。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './smokeShim';
import type { AppState } from '../src/types/state';
import type { Diagnostic } from '../src/types/domain';
import type { DerivedData, DoctorStat, FairnessResult, Violation } from '../src/core/stats';
import type { ValidationResult } from '../src/types/validation';
import { computeFairness } from '../src/core/stats/fairness';
import { emptyValidationResult } from '../src/types/validation';
import { indexDoctorStats } from '../src/core/stats/doctor';
import { createEmptyCounts } from '../src/core/stats/daily';
import {
  AppDispatchContext,
  AppStateContext,
  DerivedContext,
  ToastContext,
  type ToastApi,
} from '../src/state/contexts';
import { createInitialState, reducer } from '../src/state/reducer';
import { TEXTS } from '../src/constants/texts';
import { createDefaultRules, SCHEMA_VERSION } from '../src/constants/defaults';
import { buildBackupJson, parseBackup } from '../src/lib/backup';
import { InsightPanel } from '../src/components/InsightPanel/InsightPanel';
import { ViolationList } from '../src/components/InsightPanel/ViolationList';
import { WorkloadBoard } from '../src/components/InsightPanel/WorkloadBoard';

const fails: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function noop(): void {
  /* SSR 烟测不触发交互，dispatch 用空操作占位 */
}

const noopToast: ToastApi = { show: () => '', dismiss: () => undefined, clear: () => undefined };

/** 手动下发 Context，避免 AppProvider 的浮层 / 副作用拖累 SSR */
function withContexts(state: AppState, derived: DerivedData, children: ReactNode): ReactElement {
  return (
    <AppDispatchContext.Provider value={noop}>
      <AppStateContext.Provider value={state}>
        <DerivedContext.Provider value={derived}>
          <ToastContext.Provider value={noopToast}>{children}</ToastContext.Provider>
        </DerivedContext.Provider>
      </AppStateContext.Provider>
    </AppDispatchContext.Provider>
  );
}

// ============ 兜底构造器 ============

function makeDoctorStat(partial: Partial<DoctorStat> & { doctorId: string; name: string }): DoctorStat {
  return {
    doctorId: partial.doctorId,
    name: partial.name,
    color: '#D84315',
    counts: createEmptyCounts(),
    clinicCount: 0,
    rotationClinicCount: 0,
    dayShiftCount: 0,
    wardCount: 0,
    dayCount: 0,
    nightCount: 0,
    otherWorkCount: 0,
    workCount: 0,
    shouldRest: 8,
    actualRest: 8,
    postNightCount: 0,
    restGap: 0,
    leaveDays: 0,
    unassignedDays: 0,
    excludedFromNight: false,
    burden: 0,
    ...partial,
  };
}

function makeDerived(overrides: Partial<DerivedData> = {}): DerivedData {
  const doctorStats = overrides.doctorStats ?? [];
  return {
    month: '2026-08',
    validation: overrides.validation ?? emptyValidationResult(),
    dailyStats: [],
    dailyStatsByDate: {},
    doctorStats,
    doctorStatsById: indexDoctorStats(doctorStats),
    fairness: overrides.fairness ?? computeFairness([]),
    restShortages: overrides.restShortages ?? [],
    outOfRangeDays: 0,
  };
}

function withDiagnostics(diagnostics: readonly Diagnostic[]): AppState {
  const state = createInitialState();
  return { ...state, ui: { ...state.ui, lastDiagnostics: [...diagnostics] } };
}

// ============ [1] InsightPanel 容器整体结构 + 生成说明过滤 ============

console.log('\n[1] InsightPanel 容器结构 + 生成说明过滤');
{
  const derived = makeDerived();
  const state = withDiagnostics([]);
  const html = renderToStaticMarkup(withContexts(state, derived, <InsightPanel />));

  check('渲染待处理冲突区', html.includes(TEXTS.violationTitle));
  check('渲染工作量均衡区', html.includes(TEXTS.workloadTitle));
  check('渲染休息天数不足区', html.includes(TEXTS.restShortageTitle));
  check('全员达标时显示肯定空态', html.includes(TEXTS.restAllOk));
  // 无生成说明时整块不渲染（含标题）
  check('无 high 诊断时不渲染「生成说明」', !html.includes(TEXTS.generationNotesTitle));
}

// ============ [2] ViolationList：定位按钮 + severity 着色 + 空态 ============

console.log('\n[2] ViolationList 定位 + severity 着色');
{
  const violations: Violation[] = [
    {
      id: 'high1',
      type: 'belowMin',
      severity: 'high',
      message: '8/3 白班 1/2 人，低于下限',
      date: '2026-08-03',
      doctorId: 'd1',
    },
    { id: 'low1', type: 'restShortage', severity: 'low', message: '某医生休息不足', detail: '详情说明' },
  ];
  const html = renderToStaticMarkup(<ViolationList violations={violations} onLocate={noop} />);

  check('按 severity 着色（high 边框类）', html.includes('violation-item--high'));
  check('有 date+doctorId 的违规渲染「定位」按钮', html.includes(TEXTS.violationLocate));
  check('存在违规时不显示空态文案', !html.includes(TEXTS.violationEmpty));
  check('含违规明细说明', html.includes('详情说明'));

  const emptyHtml = renderToStaticMarkup(<ViolationList violations={[]} onLocate={noop} />);
  check('空违规列表显示空态文案', emptyHtml.includes(TEXTS.violationEmpty));
}

// ============ [3] WorkloadBoard：四维度 + clinic tooltip + 极值 null + 豁免 ============

console.log('\n[3] WorkloadBoard 四维度 + tooltip + 极值');
{
  const doc1 = makeDoctorStat({ doctorId: 'd1', name: '张伟', clinicCount: 5, rotationClinicCount: 2 });
  const doc2 = makeDoctorStat({ doctorId: 'd2', name: '李娜', clinicCount: 3, rotationClinicCount: 1, excludedFromNight: true });
  const fairness: FairnessResult = {
    score: 80,
    level: 'good',
    label: '比较均衡',
    dimensions: [
      { key: 'night', label: TEXTS.workloadDimensionNight, mean: 3, stdDev: 1, min: 2, max: 4, spread: 2, score: 85, weight: 0.35 },
      { key: 'clinic', label: TEXTS.workloadDimensionClinic, mean: 1, stdDev: 0.5, min: 0, max: 2, spread: 2, score: 70, weight: 0.2 },
      { key: 'day', label: TEXTS.workloadDimensionDay, mean: 15, stdDev: 2, min: 12, max: 18, spread: 6, score: 90, weight: 0.2 },
      { key: 'work', label: TEXTS.workloadDimensionTotal, mean: 20, stdDev: 3, min: 15, max: 25, spread: 10, score: 80, weight: 0.25 },
    ],
    heaviest: null,
    lightest: null,
  };

  const html = renderToStaticMarkup(
    <WorkloadBoard fairness={fairness} doctorStats={[doc1, doc2]} exemptDoctors={[doc2]} />,
  );

  check('渲染四个维度标签', html.includes(TEXTS.workloadDimensionNight) && html.includes(TEXTS.workloadDimensionClinic) && html.includes(TEXTS.workloadDimensionDay) && html.includes(TEXTS.workloadDimensionTotal));
  // doc1: (5-2)=3, doc2: (3-1)=2 → 固定 5；轮流 2+1=3
  check('clinic tooltip 拆分固定/轮流', html.includes(TEXTS.workloadClinicTooltip(5, 3)));
  check('极值标存在', html.includes(TEXTS.workloadHeaviest) && html.includes(TEXTS.workloadLightest));
  check('极值 null 时显示占位破折号', html.includes('>—</span>'));
  check('夜班豁免标注渲染', html.includes(TEXTS.nightExemptBadge) && html.includes('李娜'));

  const noExempt = renderToStaticMarkup(
    <WorkloadBoard fairness={fairness} doctorStats={[doc1]} exemptDoctors={[]} />,
  );
  check('无豁免医生时不渲染豁免标注', !noExempt.includes(TEXTS.nightExemptBadge));
}

// ============ [4] RestShortageSection（内联于 InsightPanel）：缺口进度 + 全员达标 ============

console.log('\n[4] RestShortageSection 缺口进度 + 空态');
{
  const docGap = makeDoctorStat({ doctorId: 'dg', name: '王芳', actualRest: 6, shouldRest: 8, restGap: 2 });
  const derived = makeDerived({ doctorStats: [docGap], restShortages: [docGap] });
  const state = withDiagnostics([]);
  const html = renderToStaticMarkup(withContexts(state, derived, <InsightPanel />));

  check('缺口渲染「还差 N 天」', html.includes(TEXTS.restGapLabel(2)));
  check('渲染实休/应休进度', html.includes(TEXTS.restProgressLabel(6, 8)));

  const okDerived = makeDerived({ doctorStats: [docGap], restShortages: [] });
  const okHtml = renderToStaticMarkup(withContexts(state, okDerived, <InsightPanel />));
  check('无缺口时显示全员达标', okHtml.includes(TEXTS.restAllOk) && !okHtml.includes(TEXTS.restGapLabel(2)));
}

// ============ [5] GenerateNote：仅 high，中低被过滤 ============

console.log('\n[5] GenerateNote 仅渲染 high 级诊断');
{
  const highDiag: Diagnostic = { level: 'high', stage: 'stage3Night', message: '夜班人数不足已尽量降配' };
  const mediumDiag: Diagnostic = { level: 'medium', stage: 'stage5Day', message: '白班分布略有偏差' };
  const state = withDiagnostics([highDiag, mediumDiag]);
  const html = renderToStaticMarkup(withContexts(state, makeDerived(), <InsightPanel />));

  check('渲染「生成说明」区', html.includes(TEXTS.generationNotesTitle));
  check('high 诊断进说明区', html.includes('夜班人数不足已尽量降配'));
  check('medium 诊断被过滤不出现', !html.includes('白班分布略有偏差'));
}

// ============ [6] BackupControls：parseBackup 单元 + 源纪律 ============

console.log('\n[6] BackupControls parseBackup 单元 + 源纪律');
{
  const st = createInitialState();
  const validJson = buildBackupJson({ doctors: st.doctors, rules: st.rules, schedules: st.schedules });
  const ok = parseBackup(validJson);
  check('合法备份可解析', ok.ok === true);
  if (ok.ok) {
    check('解析后医生数一致', ok.snapshot.doctors.length === st.doctors.length);
  }

  const bad = parseBackup('{ 这不是合法 json ');
  check('非法 JSON 被拒绝', bad.ok === false);

  const tooNew = JSON.stringify({
    app: 'warmshift',
    schemaVersion: SCHEMA_VERSION + 9999,
    data: { doctors: [], rules: createDefaultRules(), schedules: {} },
  });
  const future = parseBackup(tooNew);
  check('高于当前版本的备份被拒绝', future.ok === false);

  // 纪律：源文件走 ConfirmDialog 而非 window.confirm，引用 backup 工具函数
  const src = readFileSync(join(process.cwd(), 'src/components/layout/BackupControls.tsx'), 'utf8');
  check('BackupControls 引用 parseBackup', src.includes('parseBackup'));
  check('BackupControls 引用 exportBackup', src.includes('exportBackup'));
  check('BackupControls 接入 ConfirmDialog', src.includes('ConfirmDialog'));
  check('BackupControls 不使用 window.confirm', !/\bwindow\.confirm\b/.test(src));
  check('文件输入限定 .json', src.includes('accept=".json"'));
}

// ============ D. 工程纪律静态检查 ============

console.log('\n[D] 工程纪律');
{
  const root = process.cwd();
  const rel = (file: string): string => file.slice(root.length + 1).replaceAll('\\', '/');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
        files.push(full);
      }
    }
  };
  walk(join(root, 'src'));

  const owned = files.filter((f) =>
    rel(f).startsWith('src/components/InsightPanel/') ||
    rel(f).startsWith('src/components/GenerateFlow/') ||
    rel(f).startsWith('src/components/layout/BackupControls.tsx') ||
    rel(f).startsWith('src/styles/print.css') ||
    rel(f).startsWith('src/styles/panels.css'),
  );
  check('T05b 自有文件齐全（6 个）', owned.length === 6, `${owned.length}`);

  // 红线一：纯展示子块必须 memo
  for (const name of ['ViolationList', 'WorkloadBoard', 'GenerateNote']) {
    const text = readFileSync(join(root, `src/components/InsightPanel/${name}.tsx`), 'utf8');
    check(`${name} 已 React.memo`, new RegExp(`export const ${name} = memo\\(`).test(text));
  }

  // 红线二：纯展示子块（不含容器 InsightPanel）不订阅 Context（纯 props）。
  // 先剥注释，避免「设计说明里提到 DerivedContext」被误判为真的订阅。
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const subBlocks = ['ViolationList', 'WorkloadBoard', 'GenerateNote']
    .map((name) => stripComments(readFileSync(join(root, `src/components/InsightPanel/${name}.tsx`), 'utf8')))
    .join('\n');
  check('纯展示子块不订阅 Context', !/use(App(State|Dispatch|Derived)|DerivedContext|AppStateContext)/.test(subBlocks));

  // 红线三：print.css 已挂载，panels.css / print.css 无硬编码颜色
  const indexCss = readFileSync(join(root, 'src/styles/index.css'), 'utf8');
  check('print.css 已挂载到 index.css', indexCss.includes('./print.css'));
  for (const cssName of ['panels.css', 'print.css']) {
    const css = readFileSync(join(root, `src/styles/${cssName}`), 'utf8');
    const hardcoded = css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/g) ?? [];
    check(`${cssName} 无硬编码颜色`, hardcoded.length === 0, hardcoded.join(' '));
  }

  // 红线三（补强）：print.css 里每个 .class 选择器必须指向真实 DOM。
  // 初版五处缺陷的根因就是「CSS 写了但 DOM 没有」，这条断言能挡住此类问题。
  const tsxBundle = files
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const printCssText = readFileSync(join(root, 'src/styles/print.css'), 'utf8');
  const printClasses = Array.from(
    new Set((printCssText.match(/\.([A-Za-z_][\w-]*)/g) ?? []).map((s) => s.slice(1))),
  );
  // 打印专用类（白名单）：屏幕交互件不打印；标题由 MainArea 单独断言
  const printOnly = new Set(['no-print', 'print-schedule-title']);
  for (const cls of printClasses) {
    if (printOnly.has(cls)) {
      continue;
    }
    const re = new RegExp(`className="[^"]*\\b${cls.replace(/-/g, '\\-')}\\b[^"]*"`);
    check(`print.css 类名 .${cls} 在 src 有真实 DOM`, re.test(tsxBundle));
  }
  const mainAreaSrc = readFileSync(join(root, 'src/components/layout/MainArea.tsx'), 'utf8');
  check('打印专用类 .print-schedule-title 由 MainArea 渲染', mainAreaSrc.includes('print-schedule-title'));

  // 红线四：单文件 ≤ 300 行（交付边界内文件）
  const tooLong = owned
    .map((f) => [rel(f), readFileSync(f, 'utf8').split('\n').length] as const)
    .filter(([, lines]) => lines > 300);
  check('T05b 自有文件无超过 300 行的', tooLong.length === 0, tooLong.map(([f, n]) => `${f}:${n}`).join(', '));
}

console.log(fails.length === 0 ? '\nT05b SMOKE PASS' : `\nT05b SMOKE FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
