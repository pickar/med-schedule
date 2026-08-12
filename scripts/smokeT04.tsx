// T04 主排班表格烟测：
//   A. 性能红线：15 医生 × 31 天，改一格只有 1 行 / 1 格的 props 真的变了
//   B. 表格 SSR 结构：冻结表头 / 冻结首列 / 统计行 / 图例 / 空状态 / 各类标记
//   C. 纪律静态检查：叶子不碰 Context、文案不自造、样式不硬编码、单文件 ≤ 300 行
// 不参与 src 构建（tsconfig include 仅 ["src"]），用 `vite build --ssr` 打包后由 node 执行。
//
// 关于 A 段的方法论：React.memo 的默认行为就是「props 浅比较相等则跳过渲染」。
// 所以「有几个组件会重渲染」等价于「有几个组件的 props 浅比较不相等」。
// 这里把真实组件的 props 在渲染期截获下来做前后比对，
// 比在浏览器里数 render 次数更精确，而且能进 CI 反复跑。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import './smokeShim';
import type { Doctor, ScheduleEntry, ShiftType } from '../src/types/domain';
import type { AppState } from '../src/types/state';
import type { DoctorStat } from '../src/core/stats';
import type { ValidationResult } from '../src/types/validation';
import { createInitialState, reducer } from '../src/state/reducer';
import { selectMonthSchedule } from '../src/state/selectors';
import { computeDerived } from '../src/core/stats';
import { generateSchedule } from '../src/core/generator';
import { isWeekend, listMonthDates } from '../src/lib/date';
import { PRIMARY_STAT_SHIFTS, SHIFT_METAS, SHIFT_ORDER } from '../src/constants/shifts';
import { TEXTS } from '../src/constants/texts';
import type { DoctorRowData } from '../src/components/ScheduleTable/rowData';
import { buildDoctorRows, createRowCache } from '../src/components/ScheduleTable/rowData';
import type { DoctorRowProps } from '../src/components/ScheduleTable/DoctorRow';
import { DoctorRow } from '../src/components/ScheduleTable/DoctorRow';
import type { CellPickHandler, ShiftCellProps } from '../src/components/ScheduleTable/ShiftCell';
import { ShiftCell } from '../src/components/ScheduleTable/ShiftCell';
import { ScheduleTable } from '../src/components/ScheduleTable/ScheduleTable';

const MONTH = '2026-08';
const DATES = listMonthDates(MONTH);
const FLAGS = DATES.map((d) => isWeekend(d));
const TODAY = DATES[14];
const DOCTOR_COUNT = 15;
const stablePick: CellPickHandler = () => {};
const noopHandler = (): void => {};

const fails: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** React 对文本节点只转义 & < >，属性额外转义引号；断言前统一处理 */
function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * 静态检查前先剥掉注释。
 * 否则「注释里写了 useAppState 提醒后人别用」会被判成真的用了 ——
 * 这条纪律必须靠代码本身证明，不能被文档误伤，也不能靠删注释来蒙混。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ============ 数据播种 ============

const TITLES = ['主任医师', '副主任医师', '主治医师', '住院医师'] as const;

function seedState(): AppState {
  let state = reducer(createInitialState(), { type: 'doctor/loadSamples' });
  let i = 1;
  while (state.doctors.length < DOCTOR_COUNT) {
    state = reducer(state, {
      type: 'doctor/add',
      payload: {
        name: `补位医生${i}`,
        title: TITLES[i % TITLES.length],
        fixedClinicDays: [],
        constraints: { noDayShift: false, noNightShift: false, weekendOff: false },
        leaves: [],
      },
    });
    i += 1;
  }
  const gen = generateSchedule({ month: MONTH, doctors: state.doctors, rules: state.rules });
  return reducer(state, {
    type: 'schedule/applyGenerated',
    payload: { month: MONTH, entries: gen.schedule },
  });
}

function derivedOf(state: AppState) {
  return computeDerived({
    month: MONTH,
    schedule: selectMonthSchedule(state, MONTH),
    doctors: state.doctors,
    rules: state.rules,
  });
}

function rowsOf(
  state: AppState,
  validation: ValidationResult,
  cache: ReturnType<typeof createRowCache>,
): readonly DoctorRowData[] {
  return buildDoctorRows(
    { dates: DATES, doctors: state.doctors, schedule: selectMonthSchedule(state, MONTH), validation },
    cache,
  );
}

/** 一行的「内容指纹」：只要它没变，行的引用就必须被复用 */
function rowSignature(row: DoctorRowData): string {
  return JSON.stringify([
    row.entries.map((e) => (e ? `${e.shiftType}:${e.isRotation}:${e.locked ?? false}:${e.manual ?? false}` : '')),
    row.violations,
    row.severities,
    row.leaves,
  ]);
}

function validationSignature(validation: ValidationResult): string {
  return Object.keys(validation.byCell)
    .sort()
    .map((key) => `${key}=>${validation.byCell[key].map((v) => v.id).join(',')}`)
    .join('|');
}

// ============ props 截获（利用 memo 对象的 .type 可写） ============

interface MemoBox<P> {
  type: (props: P) => React.ReactElement;
}

const cellBox = ShiftCell as unknown as MemoBox<ShiftCellProps>;
const rowBox = DoctorRow as unknown as MemoBox<DoctorRowProps>;
const innerCell = cellBox.type;
const innerRow = rowBox.type;
const cellProps = new Map<string, ShiftCellProps>();
const rowProps = new Map<string, DoctorRowProps>();

function startCapture(): void {
  cellBox.type = (props) => {
    cellProps.set(`${props.doctorId}|${props.date}`, props);
    return innerCell(props);
  };
  rowBox.type = (props) => {
    rowProps.set(props.doctor.id, props);
    return innerRow(props);
  };
}

function stopCapture(): void {
  cellBox.type = innerCell;
  rowBox.type = innerRow;
}

interface Snapshot {
  cells: Map<string, ShiftCellProps>;
  rows: Map<string, DoctorRowProps>;
}

/** 渲染整个 tbody 并快照每个 DoctorRow / ShiftCell 实际收到的 props */
function snapshotProps(
  doctors: readonly Doctor[],
  rows: readonly DoctorRowData[],
  statsById: Record<string, DoctorStat>,
): Snapshot {
  cellProps.clear();
  rowProps.clear();
  renderToStaticMarkup(
    <table>
      <tbody>
        {doctors.map((doctor, index) => {
          const stat = statsById[doctor.id];
          return (
            <DoctorRow
              key={doctor.id}
              doctor={doctor}
              dates={DATES}
              weekendFlags={FLAGS}
              todayDate={TODAY}
              row={rows[index]}
              shouldRest={stat?.shouldRest ?? 0}
              actualRest={stat?.actualRest ?? 0}
              postNightCount={stat?.postNightCount ?? 0}
              restGap={stat?.restGap ?? 0}
              isHighlightedRow={false}
              onPick={stablePick}
            />
          );
        })}
      </tbody>
    </table>,
  );
  return { cells: new Map(cellProps), rows: new Map(rowProps) };
}

/** memo 的默认比较器就是这个：任一 key 的引用/值变了就会重渲染 */
function changedKeys(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !Object.is(a[key], b[key]));
}

function diffCount(before: Map<string, object>, after: Map<string, object>): string[] {
  const changed: string[] = [];
  for (const [key, next] of after) {
    const prev = before.get(key);
    if (prev === undefined || changedKeys(prev, next).length > 0) {
      changed.push(key);
    }
  }
  return changed;
}

// ============ A. 性能红线 ============

console.log(`\n[A] 行数据引用复用（${DOCTOR_COUNT} 医生 × ${DATES.length} 天 = ${DOCTOR_COUNT * DATES.length} 格）`);

const base = seedState();
const baseDerived = derivedOf(base);
const cache = createRowCache();
const rows1 = rowsOf(base, baseDerived.validation, cache);

check('当月天数为 31', DATES.length === 31, `${DATES.length}`);
check(`医生数为 ${DOCTOR_COUNT}`, base.doctors.length === DOCTOR_COUNT, `${base.doctors.length}`);
check('每行数组与日期同序等长', rows1.every((r) => r.entries.length === DATES.length && r.leaves.length === DATES.length));
check('生成器已填满排班', rows1.every((r) => r.entries.every((e) => e !== undefined)));

{
  // 同样的入参再算一次：整批行对象必须原样退回，否则 memo 从第一帧起就没用
  const rows1b = rowsOf(base, baseDerived.validation, cache);
  check('入参不变时整批行复用原引用', rows1b.every((row, i) => row === rows1[i]));

  // validation 换成一个全新但内容相同的对象：字符串压缩必须挡住这层抖动
  const reValidated = derivedOf(base).validation;
  check('validation 是全新对象', reValidated !== baseDerived.validation);
  const rows1c = rowsOf(base, reValidated, cache);
  check('validation 对象换新但内容相同时仍复用行引用', rows1c.every((row, i) => row === rows1[i]));
}

// 找一处「不引发任何违规变化」的改动：门诊 ↔ 专家门诊，两者都是工作班且不参与人数区间
const baseValidationSig = validationSignature(baseDerived.validation);
let quiet: { state: AppState; date: string; doctorId: string } | null = null;
{
  const schedule = selectMonthSchedule(base, MONTH);
  outer: for (const doctor of base.doctors) {
    for (const date of DATES) {
      const entry: ScheduleEntry | undefined = schedule[date]?.[doctor.id];
      if (entry === undefined) {
        continue;
      }
      const alt: ShiftType | null =
        entry.shiftType === 'clinic' ? 'expertClinic' : entry.shiftType === 'expertClinic' ? 'clinic' : null;
      if (alt === null) {
        continue;
      }
      const next = reducer(base, {
        type: 'schedule/setCell',
        payload: { date, doctorId: doctor.id, shiftType: alt, manual: true },
      });
      if (validationSignature(derivedOf(next).validation) === baseValidationSig) {
        quiet = { state: next, date, doctorId: doctor.id };
        break outer;
      }
    }
  }
}
check('找到一处不牵动违规的改格操作', quiet !== null);

if (quiet !== null) {
  const nextDerived = derivedOf(quiet.state);
  const rows2 = rowsOf(quiet.state, nextDerived.validation, cache);

  const refChanged = rows2.filter((row, i) => row !== rows1[i]).map((row) => row.doctorId);
  check(`改一格只有 1 行数据换新引用（实际 ${refChanged.length}）`, refChanged.length === 1, refChanged.join(','));
  check('换新的正是被改的那位医生', refChanged[0] === quiet.doctorId, `${refChanged[0]} vs ${quiet.doctorId}`);

  // 引用变化必须与内容变化严格一一对应：不多也不少
  const sigChanged = rows2.filter((row, i) => rowSignature(row) !== rowSignature(rows1[i])).map((r) => r.doctorId);
  check(
    '引用变化与内容变化严格一致（无虚假失效、无漏更新）',
    refChanged.join(',') === sigChanged.join(','),
    `ref=[${refChanged}] sig=[${sigChanged}]`,
  );

  startCapture();
  const snap1 = snapshotProps(base.doctors, rows1, baseDerived.doctorStatsById);
  const snap2 = snapshotProps(quiet.state.doctors, rows2, nextDerived.doctorStatsById);
  stopCapture();

  check(
    `截获到全部 ${DOCTOR_COUNT * DATES.length} 个单元格 props`,
    snap1.cells.size === DOCTOR_COUNT * DATES.length,
    `${snap1.cells.size}`,
  );

  const changedRows = diffCount(snap1.rows as Map<string, object>, snap2.rows as Map<string, object>);
  const changedCells = diffCount(snap1.cells as Map<string, object>, snap2.cells as Map<string, object>);
  check(`只有 1 个 DoctorRow 的 props 变化（实际 ${changedRows.length}）`, changedRows.length === 1, changedRows.join(','));
  check(`只有 1 个 ShiftCell 的 props 变化（实际 ${changedCells.length}）`, changedCells.length === 1, changedCells.join(','));
  check(
    '变化的正是被点击的那一格',
    changedCells[0] === `${quiet.doctorId}|${quiet.date}`,
    `${changedCells[0]} vs ${quiet.doctorId}|${quiet.date}`,
  );
  check('该格变化的是 entry 而非回调引用', changedKeys(
    snap1.cells.get(`${quiet.doctorId}|${quiet.date}`) as object,
    snap2.cells.get(`${quiet.doctorId}|${quiet.date}`) as object,
  ).join(',') === 'entry');

  // 手动标记必须落在数据上，否则右下角小三角永远不出现
  const editedEntry = selectMonthSchedule(quiet.state, MONTH)[quiet.date][quiet.doctorId];
  check('手动改格写入 manual: true', editedEntry.manual === true);
}

// ============ B. 表格 SSR 结构 ============

console.log('\n[B] 表格首帧结构');

const tableProps = {
  dates: DATES,
  weekendFlags: FLAGS,
  todayDate: TODAY,
  doctors: base.doctors,
  rows: rows1,
  doctorStatsById: baseDerived.doctorStatsById,
  dailyStatsByDate: baseDerived.dailyStatsByDate,
  hasSchedule: true,
  highlightCell: null,
  highlightDoctorId: null,
  stale: false,
  onSetCell: noopHandler,
  onToggleLock: noopHandler,
  onToggleStats: noopHandler,
  onToggleLegend: noopHandler,
};

{
  const html = renderToStaticMarkup(
    <ScheduleTable {...tableProps} statsExpanded={false} legendExpanded={false} />,
  );

  check('左上角交叉格存在', html.includes('class="table__corner"'));
  check('冻结首列条数 = 医生数', countOf(html, 'class="table__doctor"') === DOCTOR_COUNT);
  check(
    '日期列头数 = 当月天数',
    countOf(html, '<th scope="col" class="table__day') === DATES.length,
    `${countOf(html, '<th scope="col" class="table__day')}`,
  );
  check('右上角应休/实休两个列头', countOf(html, 'class="table__rest-head"') === 2);
  check('单元格总数 = 医生 × 天数', countOf(html, '<td class="cell') === DOCTOR_COUNT * DATES.length);
  check('周末列已标记', html.includes('table__day is-weekend'));
  check('今天列已标记', html.includes('is-today'));
  check('底部统计行吸底容器存在', html.includes('class="table__foot"'));
  check(
    `收起态统计行数 = 1 + ${PRIMARY_STAT_SHIFTS.length}`,
    countOf(html, 'class="table__stat-row') === 1 + PRIMARY_STAT_SHIFTS.length,
    `${countOf(html, 'class="table__stat-row')}`,
  );
  check('统计行含在岗合计', html.includes(esc(TEXTS.statsWorkTotal)));
  check('图例含日夜说明', html.includes(esc(TEXTS.legendDayNightNote)));
  check('折叠态不铺开 11 种班次', !html.includes('class="legend__list"'));
  check('未开选择器时不渲染浮层', !html.includes('shift-picker'));
}

{
  const html = renderToStaticMarkup(
    <ScheduleTable {...tableProps} statsExpanded legendExpanded />,
  );
  check(
    `展开态统计行数 = 1 + ${SHIFT_ORDER.length}`,
    countOf(html, 'class="table__stat-row') === 1 + SHIFT_ORDER.length,
    `${countOf(html, 'class="table__stat-row')}`,
  );
  check('图例展开后 11 种班次齐全', SHIFT_ORDER.every((s) => html.includes(esc(SHIFT_METAS[s].label))));
}

{
  const noDoctor = renderToStaticMarkup(
    <ScheduleTable {...tableProps} doctors={[]} rows={[]} hasSchedule={false} statsExpanded={false} legendExpanded={false} />,
  );
  check('无医生时落空状态', noDoctor.includes(esc(TEXTS.emptyTitle)));
  check('无医生时提示先添加医生', noDoctor.includes(esc(TEXTS.emptyNeedSetup)));
  check(
    '空状态三步引导齐全',
    [TEXTS.step1Title, TEXTS.step2Title, TEXTS.step3Title, TEXTS.step1Desc, TEXTS.step2Desc, TEXTS.step3Desc].every(
      (t) => noDoctor.includes(esc(t)),
    ),
  );
  check('空状态不渲染表格', !noDoctor.includes('<table'));

  const noSchedule = renderToStaticMarkup(
    <ScheduleTable {...tableProps} hasSchedule={false} statsExpanded={false} legendExpanded={false} />,
  );
  check('有医生无排班时改用生成引导文案', noSchedule.includes(esc(TEXTS.emptySubtitle)));
}

// B2. 单元格各类标记：用手工构造的行，避免依赖生成器恰好产出某种班次
console.log('\n[B2] 单元格标记与违规高亮');
{
  const doctor = base.doctors[0];
  const entryOf = (shiftType: ShiftType, extra: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
    doctorId: doctor.id,
    shiftType,
    isRotation: false,
    ...extra,
  });
  const marked: DoctorRowData = {
    doctorId: doctor.id,
    entries: [
      entryOf('nightShift'),
      entryOf('clinic', { isRotation: true }),
      entryOf('dayShift', { locked: true }),
      entryOf('rest', { manual: true }),
      undefined,
    ],
    violations: [undefined, undefined, undefined, '连续两天夜班', undefined],
    severities: [undefined, undefined, undefined, 'high', undefined],
    leaves: [false, false, false, false, true],
  };
  const html = renderToStaticMarkup(
    <table>
      <tbody>
        <DoctorRow
          doctor={doctor}
          dates={DATES.slice(0, 5)}
          weekendFlags={FLAGS.slice(0, 5)}
          todayDate={TODAY}
          row={marked}
          shouldRest={8}
          actualRest={5}
          postNightCount={2}
          restGap={3}
          isHighlightedRow={false}
          onPick={stablePick}
        />
      </tbody>
    </table>,
  );

  check('班次简写来自元数据表', html.includes(`>${SHIFT_METAS.nightShift.short}<`));
  check('配色走 CSS 变量而非写死色值', html.includes('--cell-bg:var(--shift-nightShift-bg)'));
  check('轮流格有标记', html.includes('class="cell__rotation"'));
  check('锁定格有锁图标', html.includes('class="icon cell__lock"'));
  check('手动改过的格有三角标', html.includes('class="cell__manual"'));
  check('违规格有角标与描边类', html.includes('class="cell__flag"') && html.includes('cell is-violation'));
  check('违规严重度落到 data-severity', html.includes('data-severity="high"'));
  check('违规原因进 title', html.includes('连续两天夜班'));
  check('请假格有斜纹类', html.includes('is-leave'));
  check('未排班格标记为空格', html.includes('cell is-empty'));
  check('实休不足标红', html.includes('table__rest is-short'));
  check('实休 tooltip 走文案表', html.includes(esc(TEXTS.actualRestTooltip(5, 2))));
}

// B3. 违规链路端到端：真实构造一次连续夜班，看红框能不能一路透到单元格
console.log('\n[B3] 违规链路 validator → rowData → 单元格');
{
  const victim = base.doctors[0];
  const first = DATES[9];
  const second = DATES[10];
  let broken = base;
  for (const date of [first, second]) {
    broken = reducer(broken, {
      type: 'schedule/setCell',
      payload: { date, doctorId: victim.id, shiftType: 'nightShift', manual: true },
    });
  }
  const brokenDerived = derivedOf(broken);
  check('构造出真实违规', brokenDerived.validation.total > 0, `${brokenDerived.validation.total}`);

  const hits = brokenDerived.validation.byCell[`${second}|${victim.id}`] ?? [];
  check('违规已索引到目标格', hits.length > 0);

  const brokenRows = rowsOf(broken, brokenDerived.validation, createRowCache());
  const html = renderToStaticMarkup(
    <ScheduleTable
      {...tableProps}
      doctors={broken.doctors}
      rows={brokenRows}
      doctorStatsById={brokenDerived.doctorStatsById}
      dailyStatsByDate={brokenDerived.dailyStatsByDate}
      statsExpanded={false}
      legendExpanded={false}
    />,
  );
  check('表格渲染出违规描边', html.includes('cell is-violation'));
  check(
    'tooltip 与 validator 文案逐字一致',
    hits.every((v) => html.includes(esc(v.message))),
    hits.map((v) => v.message).join(' / '),
  );

  // 定位高亮：优先级高于违规描边，两者叠加时都必须在
  const located = renderToStaticMarkup(
    <ScheduleTable
      {...tableProps}
      doctors={broken.doctors}
      rows={brokenRows}
      doctorStatsById={brokenDerived.doctorStatsById}
      dailyStatsByDate={brokenDerived.dailyStatsByDate}
      highlightCell={{ date: second, doctorId: victim.id }}
      highlightDoctorId={victim.id}
      statsExpanded={false}
      legendExpanded={false}
    />,
  );
  check('定位高亮同时命中行与格', located.includes('table__row is-highlighted') && located.includes('is-highlighted'));
}

// ============ C. 纪律静态检查 ============

console.log('\n[C] 分层纪律与工程约束');
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

  const tableFiles = files.filter((f) => rel(f).startsWith('src/components/ScheduleTable/'));
  check('表格目录文件齐全（8 组件 + 行数据层）', tableFiles.length === 9, `${tableFiles.length}`);

  // 红线一：表格层一个 Context hook 都不许出现
  const ctxOffenders = tableFiles.filter((f) =>
    /\buseApp(State|Dispatch)\b|\buseDerived\b|\buseUIState\b|\buseToast\b/.test(
      stripComments(readFileSync(f, 'utf8')),
    ),
  );
  check('表格层零 Context 消费', ctxOffenders.length === 0, ctxOffenders.map(rel).join(', '));

  const stateImport = tableFiles.filter((f) =>
    /^import\s+(?!type\b)[^;]*from '\.\.\/\.\.\/state\//m.test(stripComments(readFileSync(f, 'utf8'))),
  );
  check('表格层不 import state 运行时', stateImport.length === 0, stateImport.map(rel).join(', '));

  // 红线二：两个热组件必须 memo
  for (const name of ['ShiftCell', 'DoctorRow', 'StatsRows', 'TableHeader']) {
    const text = readFileSync(join(root, `src/components/ScheduleTable/${name}.tsx`), 'utf8');
    check(`${name} 已 React.memo`, new RegExp(`export const ${name} = memo\\(`).test(text));
  }

  // 红线三：下发给 900+ 单元格的回调必须是空依赖 useCallback
  const tableSrc = readFileSync(join(root, 'src/components/ScheduleTable/ScheduleTable.tsx'), 'utf8');
  check(
    'onPick 由空依赖 useCallback 固定引用',
    /const handlePick = useCallback\([\s\S]*?\}, \[\]\);/.test(tableSrc),
  );

  // 违规文案只能来自 validator，组件里不得自造
  const messages = readFileSync(join(root, 'src/core/validator/messages.ts'), 'utf8');
  const phrases = [...messages.matchAll(/[\u4e00-\u9fa5]{4,}/g)].map((m) => m[0]);
  const copycats: string[] = [];
  for (const file of tableFiles) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const phrase of phrases) {
      if (text.includes(phrase)) {
        copycats.push(`${rel(file)}:${phrase}`);
      }
    }
  }
  check('组件层未自造违规文案', copycats.length === 0, copycats.join(', '));

  // 样式：新增三张表同样不许出现字面色值
  for (const name of ['table.css', 'cells.css', 'table-aux.css']) {
    const css = readFileSync(join(root, 'src/styles', name), 'utf8');
    const hardcoded = css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/g) ?? [];
    check(`${name} 无硬编码颜色`, hardcoded.length === 0, hardcoded.join(' '));
  }

  const indexCss = readFileSync(join(root, 'src/styles/index.css'), 'utf8');
  const styleFiles = readdirSync(join(root, 'src/styles')).filter((n) => n.endsWith('.css') && n !== 'index.css');
  check(
    '全部样式表已挂载到 index.css',
    styleFiles.every((n) => indexCss.includes(`./${n}`)),
    styleFiles.filter((n) => !indexCss.includes(`./${n}`)).join(', '),
  );
  check('cells.css 排在 table.css 之后', indexCss.indexOf('./cells.css') > indexCss.indexOf('./table.css'));

  const styleAbs = styleFiles.map((n) => join(root, 'src/styles', n));
  const tooLong = [...files, ...styleAbs]
    .map((f) => [rel(f), readFileSync(f, 'utf8').split('\n').length] as const)
    .filter(([, lines]) => lines > 300);
  check('无超过 300 行的文件', tooLong.length === 0, tooLong.map(([f, n]) => `${f}:${n}`).join(', '));
}

console.log(`\n违规总数：${baseDerived.validation.total}，公平度：${baseDerived.fairness.score}`);
console.log(fails.length === 0 ? '\nT04 SMOKE PASS' : `\nT04 SMOKE FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
