// T03 状态层 + 骨架烟测：
//   A. reducer / 历史 / 结构共享 / 选择器 / 存储失败分码
//   B. 三栏骨架 SSR 渲染（等价于「打开页面看到什么」的可断言版本）
//   C. Context 分层纪律的静态检查（叶子组件不得消费 State/Derived Context）
// 不参与 src 构建（tsconfig include 仅 ["src"]），用 `vite build --ssr` 打包后由 node 执行。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import './smokeShim';
import type { Doctor, ScheduleEntry } from '../src/types/domain';
import type { Action, AppState } from '../src/types/state';
import { createInitialState, reducer } from '../src/state/reducer';
import { snapshotOf } from '../src/state/history';
import { EMPTY_MONTH_SCHEDULE, selectMonthSchedule, selectVisibleDoctors } from '../src/state/selectors';
import { MAX_HISTORY } from '../src/constants/defaults';
import { loadAllDetailed, saveAllSafe } from '../src/lib/storage';
import App from '../src/App';

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

function apply(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

function sampleDoctorState(): AppState {
  return apply(createInitialState(), { type: 'doctor/loadSamples' });
}

/** 把某月排班的全部 entry 摊平成 [key, 引用] 对，用于逐条比对引用是否被保住 */
function entryRefs(state: AppState, month: string): Map<string, ScheduleEntry> {
  const map = new Map<string, ScheduleEntry>();
  for (const [date, day] of Object.entries(state.schedules[month] ?? {})) {
    for (const [doctorId, entry] of Object.entries(day)) {
      map.set(`${date}|${doctorId}`, entry);
    }
  }
  return map;
}

// ============ A1. 初始状态与 UI action ============

console.log('\n[A1] 初始状态 / UI action 不进历史');
{
  const init = createInitialState();
  check('初始无医生、无排班、无历史', init.doctors.length === 0 && Object.keys(init.schedules).length === 0 && init.history.past.length === 0);
  check('初始月份形如 YYYY-MM', /^\d{4}-\d{2}$/.test(init.ui.currentMonth), init.ui.currentMonth);

  const afterUI = apply(init, { type: 'ui/patch', payload: { doctorPanelCollapsed: true } });
  check('ui/patch 生效', afterUI.ui.doctorPanelCollapsed);
  check('ui/patch 不进历史', afterUI.history.past.length === 0);
  check('ui/patch 不动数据引用', afterUI.doctors === init.doctors && afterUI.schedules === init.schedules && afterUI.rules === init.rules);

  const repeat = apply(afterUI, { type: 'ui/patch', payload: { doctorPanelCollapsed: true } });
  check('ui/patch 无变化时返回原 state 引用', repeat === afterUI);

  const saving = apply(afterUI, { type: 'app/saveStatus', payload: { status: 'saving' } });
  const savingAgain = apply(saving, { type: 'app/saveStatus', payload: { status: 'saving' } });
  check('重复 saveStatus 不产生新 state', savingAgain === saving);
}

// ============ A2. 示例医生：工厂而非共享模板 ============

console.log('\n[A2] doctor/loadSamples 必须走工厂，不得共享模板引用');
{
  const a = sampleDoctorState();
  const b = sampleDoctorState();
  check('载入了示例医生', a.doctors.length > 0, `${a.doctors.length}`);
  check('两次载入的 id 互不相同', a.doctors.every((d, i) => d.id !== b.doctors[i].id));
  check('医生对象非同一引用', a.doctors.every((d, i) => d !== b.doctors[i]));
  check(
    '嵌套字段非同一引用（fixedClinicDays / constraints / leaves）',
    a.doctors.every(
      (d, i) =>
        d.fixedClinicDays !== b.doctors[i].fixedClinicDays &&
        d.constraints !== b.doctors[i].constraints &&
        d.leaves !== b.doctors[i].leaves,
    ),
  );

  // 深层污染实测：改 a 的数组，b 与后续新载入都不该受影响
  a.doctors[0].fixedClinicDays.push(6);
  const c = sampleDoctorState();
  check('修改已载入数据不会污染后续载入', c.doctors[0].fixedClinicDays.length === b.doctors[0].fixedClinicDays.length);

  const again = apply(a, { type: 'doctor/loadSamples' });
  check('重复载入按姓名去重（返回原引用）', again === a);
  check('颜色不重复', new Set(a.doctors.map((d) => d.color)).size === a.doctors.length);
}

// ============ A3. 结构共享：改医生名不得动排班引用 ============

console.log('\n[A3] 结构共享：编辑医生姓名不动任何排班条目引用');
{
  let state = sampleDoctorState();
  const [d0, d1] = state.doctors;
  state = apply(
    state,
    { type: 'schedule/setCell', payload: { date: `${MONTH}-03`, doctorId: d0.id, shiftType: 'dayShift' } },
    { type: 'schedule/setCell', payload: { date: `${MONTH}-03`, doctorId: d1.id, shiftType: 'nightShift' } },
    { type: 'schedule/setCell', payload: { date: `${MONTH}-04`, doctorId: d0.id, shiftType: 'clinic' } },
  );

  const before = state;
  const beforeEntries = entryRefs(before, MONTH);
  const renamed: Doctor = { ...before.doctors[0], name: '张伟改' };
  const after = apply(before, { type: 'doctor/update', payload: renamed });

  check('doctors 数组已换新', after.doctors !== before.doctors);
  check('被改的医生对象换新', after.doctors[0] !== before.doctors[0] && after.doctors[0].name === '张伟改');
  check('其余医生对象保持原引用', after.doctors.slice(1).every((d, i) => d === before.doctors[i + 1]));
  check('schedules 根引用不变', after.schedules === before.schedules);
  check('rules 引用不变', after.rules === before.rules);

  const afterEntries = entryRefs(after, MONTH);
  const allEntriesStable = [...beforeEntries].every(([key, entry]) => afterEntries.get(key) === entry);
  check('全部 ScheduleEntry 引用不变（memo 单元格不会重渲染）', allEntriesStable);

  const noop = apply(after, { type: 'doctor/update', payload: after.doctors[0] });
  check('内容未变的 doctor/update 返回原 state', noop === after);
  check('内容未变不压历史', noop.history.past.length === after.history.past.length);
}

// ============ A4. 排班改动的局部性 ============

console.log('\n[A4] setCell 只影响目标日，其他日期保持原引用');
{
  let state = sampleDoctorState();
  const ids = state.doctors.map((d) => d.id);
  state = apply(
    state,
    { type: 'schedule/setCell', payload: { date: `${MONTH}-05`, doctorId: ids[0], shiftType: 'dayShift' } },
    { type: 'schedule/setCell', payload: { date: `${MONTH}-06`, doctorId: ids[1], shiftType: 'dayShift' } },
  );
  const before = state;
  const after = apply(before, {
    type: 'schedule/setCell',
    payload: { date: `${MONTH}-05`, doctorId: ids[2], shiftType: 'nightShift' },
  });

  check('目标日换新', after.schedules[MONTH][`${MONTH}-05`] !== before.schedules[MONTH][`${MONTH}-05`]);
  check('非目标日保持原引用', after.schedules[MONTH][`${MONTH}-06`] === before.schedules[MONTH][`${MONTH}-06`]);
  check(
    '目标日内未触及的条目保持原引用',
    after.schedules[MONTH][`${MONTH}-05`][ids[0]] === before.schedules[MONTH][`${MONTH}-05`][ids[0]],
  );

  const same = apply(after, {
    type: 'schedule/setCell',
    payload: { date: `${MONTH}-05`, doctorId: ids[2], shiftType: 'nightShift' },
  });
  check('设置成相同班次返回原 state（不压空历史）', same === after);
}

// ============ A5. 撤销 / 重做 ============

console.log('\n[A5] 撤销重做：深度 30、分支清空、引用还原');
{
  let state = sampleDoctorState();
  const id = state.doctors[0].id;
  const marks: AppState[] = [];
  for (let i = 1; i <= 35; i += 1) {
    const day = String(i).padStart(2, '0');
    state = apply(state, {
      type: 'schedule/setCell',
      payload: { date: `${MONTH}-${day}`, doctorId: id, shiftType: i % 2 === 0 ? 'dayShift' : 'clinic' },
    });
    marks.push(state);
  }
  check(`历史深度截断到 ${MAX_HISTORY}`, state.history.past.length === MAX_HISTORY, `${state.history.past.length}`);
  check('历史 label 是人话', /修改 .+ 8\/35?/.test(state.history.past[state.history.past.length - 1].label) || state.history.past[state.history.past.length - 1].label.startsWith('修改 '), state.history.past[state.history.past.length - 1].label);

  const beforeUndo = state;
  const undone = apply(state, { type: 'history/undo' });
  check('撤销后 schedules 回到上一步的引用', undone.schedules === marks[marks.length - 2].schedules);
  check('撤销压入 future', undone.history.future.length === 1);
  const redone = apply(undone, { type: 'history/redo' });
  check('重做后 schedules 回到撤销前的引用', redone.schedules === beforeUndo.schedules);
  check('重做清空 future', redone.history.future.length === 0);

  // 撤销后做新操作 → future 必须清空（不能重做到已不存在的时间线）
  const branched = apply(apply(redone, { type: 'history/undo' }), {
    type: 'schedule/setCell',
    payload: { date: `${MONTH}-20`, doctorId: id, shiftType: 'rest' },
  });
  check('产生新分支后 future 清空', branched.history.future.length === 0);

  // 撤销到底后再撤销：应保持原引用而不是抛错
  let drained = branched;
  for (let i = 0; i < MAX_HISTORY + 5; i += 1) {
    drained = apply(drained, { type: 'history/undo' });
  }
  const drainedAgain = apply(drained, { type: 'history/undo' });
  check('历史耗尽后继续撤销返回原 state', drainedAgain === drained);
  check('撤销不会污染 UI 月份', drained.ui.currentMonth === branched.ui.currentMonth);
}

// ============ A6. 跨月定位 / 清空 ============

console.log('\n[A6] ui/locate 跨月 + app/clearAll 幂等');
{
  const state = sampleDoctorState();
  const id = state.doctors[0].id;
  const located = apply(state, { type: 'ui/locate', payload: { date: '2027-01-09', doctorId: id } });
  check('定位跨月时切换当前月', located.ui.currentMonth === '2027-01', located.ui.currentMonth);
  check('定位写入高亮单元格', located.ui.highlightCell?.date === '2027-01-09' && located.ui.highlightCell?.doctorId === id);
  check('定位到医生时自动展开左栏', located.ui.doctorPanelCollapsed === false);

  const cleared = apply(state, { type: 'app/clearAll' });
  check('清空后医生为空', cleared.doctors.length === 0);
  check('清空保留 UI 月份', cleared.ui.currentMonth === state.ui.currentMonth);
  check('清空可撤销', cleared.history.past.length === state.history.past.length + 1);
  const clearedAgain = apply(cleared, { type: 'app/clearAll' });
  check('已空再清空返回原 state', clearedAgain === cleared);
}

// ============ A7. 选择器引用纪律 ============

console.log('\n[A7] 选择器：空月与空搜索必须复用引用');
{
  const state = sampleDoctorState();
  check('空月返回共享常量', selectMonthSchedule(state, '2099-01') === EMPTY_MONTH_SCHEDULE);
  check('连续两次取空月引用相同', selectMonthSchedule(state, '2099-01') === selectMonthSchedule(state, '2098-12'));
  check('空搜索原样返回入参引用', selectVisibleDoctors(state.doctors, '  ') === state.doctors);
  check('有搜索词返回过滤结果', selectVisibleDoctors(state.doctors, state.doctors[0].name).length >= 1);
}

// ============ A8. 存储：往返 + 失败分码 ============

console.log('\n[A8] 存储往返与失败分码');
{
  let state = sampleDoctorState();
  state = apply(state, {
    type: 'schedule/setCell',
    payload: { date: `${MONTH}-11`, doctorId: state.doctors[0].id, shiftType: 'nightShift' },
  });
  const saved = saveAllSafe(snapshotOf(state));
  check('写盘成功', saved.ok, saved.error ?? '');

  const loaded = loadAllDetailed();
  check('读回无错误', loaded.error === null, loaded.error ?? '');
  check('读回医生数一致', loaded.snapshot?.doctors.length === state.doctors.length);
  check(
    '读回排班一致',
    loaded.snapshot?.schedules[MONTH]?.[`${MONTH}-11`]?.[state.doctors[0].id]?.shiftType === 'nightShift',
  );

  const hydrated = apply(createInitialState(), { type: 'app/hydrate', payload: loaded.snapshot! });
  check('水合后历史被重置', hydrated.history.past.length === 0 && hydrated.history.future.length === 0);
  check('水合后数据到位', hydrated.doctors.length === state.doctors.length);

  // 配额失败：setItem 抛 QuotaExceededError → code 必须是 'quota'
  const store = globalThis.localStorage as unknown as { setItem: (k: string, v: string) => void };
  const realSet = store.setItem.bind(store);
  store.setItem = () => {
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  };
  const quotaResult = saveAllSafe(snapshotOf(state));
  check('配额失败被识别为 quota', quotaResult.ok === false && quotaResult.code === 'quota', String(quotaResult.code));

  // 隐私模式：localStorage 整体不可用 → code 必须是 'unavailable'
  const realStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
  const unavailableResult = saveAllSafe(snapshotOf(state));
  check(
    '存储不可用被识别为 unavailable',
    unavailableResult.ok === false && unavailableResult.code === 'unavailable',
    String(unavailableResult.code),
  );
  Object.defineProperty(globalThis, 'localStorage', { value: realStorage, configurable: true });
  store.setItem = realSet;
  check('恢复后写盘再次成功', saveAllSafe(snapshotOf(state)).ok);
}

// ============ B. 三栏骨架 SSR ============

console.log('\n[B] 三栏骨架首帧渲染');
let markup = '';
{
  markup = renderToStaticMarkup(<App />);
  const need: [string, string][] = [
    ['外壳 app-shell', 'class="app-shell"'],
    ['顶栏 app-topbar', 'class="app-topbar no-print"'],
    ['三栏容器 app-body', 'class="app-body"'],
    ['左栏', 'app-panel app-panel--left'],
    ['中间主区', 'class="app-main"'],
    ['右栏', 'app-panel app-panel--right'],
    ['左栏滚动容器', 'class="app-panel__scroll"'],
    ['主区滚动容器', 'class="app-main__scroll"'],
    ['toast 容器', 'class="toast-viewport no-print"'],
    ['撤销按钮', 'aria-label="撤销"'],
    ['重做按钮', 'aria-label="重做"'],
    ['保存状态', '未保存'],
    // T04 已用真实表格替换占位块，无医生无排班时首帧应落到空状态
    ['排班表空状态', '还没有排班表'],
    ['医生名册占位', '医生名册（T04）'],
  ];
  for (const [name, needle] of need) {
    check(`首帧含${name}`, markup.includes(needle), needle);
  }
  check('首帧不含脚手架示例文案', !markup.includes('Vite + React') && !markup.includes('count is'));
  check('左右栏初始展开', markup.includes('data-left="expanded"') && markup.includes('data-right="expanded"'));
  check('撤销按钮初始禁用', /aria-label="撤销"[^>]*disabled|disabled[^>]*aria-label="撤销"/.test(markup));
  check('首帧无 toast', markup.includes('aria-atomic="false"></div>'));
}

// ============ C. Context 分层纪律静态检查 ============

console.log('\n[C] Context 分层纪律');
{
  const root = join(process.cwd(), 'src');
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
  walk(root);

  const rel = (file: string): string => file.slice(process.cwd().length + 1).replaceAll('\\', '/');
  const CONTEXT_HOOKS = /\buseAppState\b|\buseDerived\b|\buseUIState\b/;
  /*
   * 扫描前先剥注释：T04 的 ShiftCell / DoctorRow 在文件头注释里白纸黑字写了
   *「禁止 useAppState()」，那是给后人看的警示，不能反过来被这条断言判成违规。
   */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /*
   * 分层纪律的可执行版本：
   * 只有「容器层」（App / layout / state）能订阅 State/Derived Context；
   * ui / common 下的组件必须靠 props 拿数据。表格单元格将来放在 ui 层之下，
   * 这条断言就是防止有人图省事在叶子里 useAppState —— 那会让 memo 全部失效。
   */
  const containerPrefixes = ['src/App.tsx', 'src/state/', 'src/components/layout/'];
  const offenders = files.filter((file) => {
    const path = rel(file);
    if (containerPrefixes.some((prefix) => path === prefix || path.startsWith(prefix))) {
      return false;
    }
    return CONTEXT_HOOKS.test(stripComments(readFileSync(file, 'utf8')));
  });
  check('ui / common 层不消费 State/Derived Context', offenders.length === 0, offenders.join(', '));

  const leafFiles = files.filter((f) => rel(f).startsWith('src/components/ui/'));
  check('已产出通用组件文件', leafFiles.length >= 8, `${leafFiles.length}`);
  check(
    '通用组件不 import state 目录（除 contexts 的纯类型）',
    leafFiles.every((f) => {
      const text = readFileSync(f, 'utf8');
      return !/^import\s+(?!type\b)[^;]*from '\.\.\/\.\.\/state\//m.test(text);
    }),
  );

  // 样式层不得出现字面色值，必须全部走 tokens
  for (const name of ['components.css', 'overlays.css', 'layout.css']) {
    const css = readFileSync(join(process.cwd(), 'src/styles', name), 'utf8');
    const hardcoded = css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/g) ?? [];
    check(`${name} 无硬编码颜色`, hardcoded.length === 0, hardcoded.join(' '));
  }

  // 所有被 import 的样式表都必须挂在 index.css 上，否则线上会少一整块样式
  const indexCss = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8');
  const styleFiles = readdirSync(join(process.cwd(), 'src/styles')).filter(
    (n) => n.endsWith('.css') && n !== 'index.css',
  );
  check(
    '全部样式表已挂载到 index.css',
    styleFiles.every((n) => indexCss.includes(`./${n}`)),
    styleFiles.filter((n) => !indexCss.includes(`./${n}`)).join(', '),
  );

  // 单文件 300 行硬上限（源码与样式同标准）
  const styleAbs = styleFiles.map((n) => join(process.cwd(), 'src/styles', n));
  const tooLong = [...files, ...styleAbs]
    .map((f) => [rel(f), readFileSync(f, 'utf8').split('\n').length] as const)
    .filter(([, lines]) => lines > 300);
  check('无超过 300 行的文件', tooLong.length === 0, tooLong.map(([f, n]) => `${f}:${n}`).join(', '));
}

console.log(`\n首帧 HTML 长度：${markup.length} 字符`);
console.log(fails.length === 0 ? '\nT03 SMOKE PASS' : `\nT03 SMOKE FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
