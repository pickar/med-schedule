// 品牌重塑 + 移动端适配 烟测（增量变更专用）。
//
// 这一轮改动的性质决定了它需要一份和以往不同的烟测：改的是**颜色常量、文案字符串、
// CSS 断点**，绝大多数缺陷不会让程序崩溃，只会让某个角落还留着旧品牌、
// 或者让某两处断点悄悄错开一像素。功能测跑不出来，只能靠静态自检。
//
// 七组断言：
//   [1] 品牌词残留：全 src + index.html + public 里「暖班台」零命中
//   [2] 旧令牌残留：var(--brown-*) / var(--accent-*) / var(--bg-cream*) 零引用，且定义已删
//   [3] 数据语义色未被换肤波及：DOCTOR_COLORS 12 色 + 11 组 --shift-* 逐值比对
//   [4] WCAG 对比度：本轮三个修订色值 + 主色按钮 + 工作量徽标，实算相对亮度
//   [5] 断点一致性：MOBILE_MAX / tokens 的 --bp-mobile / layout.css 的 @media 三处同值
//   [6] BottomTabBar：SSR 渲染 + 默认落在「排班」+ reducer 切换生效 + locate 回排班
//   [7] 品牌产物：favicon 主色、medcross 图标存在且 coffee 已删、旧硬降级块已移除
//
// 不参与 src 构建（tsconfig include 仅 ["src"]）。执行：npx vite-node scripts/smokeRebrand.tsx

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './smokeShim';
import type { AppState } from '../src/types/state';
import { AppDispatchContext, AppStateContext } from '../src/state/contexts';
import { createInitialState, reducer } from '../src/state/reducer';
import { DOCTOR_COLORS } from '../src/constants/palette';
import { MOBILE_MAX, MOBILE_QUERY } from '../src/constants/breakpoints';
import { BRAND, TEXTS } from '../src/constants/texts';
import { BottomTabBar } from '../src/components/layout/BottomTabBar';

const ROOT = process.cwd();
const fails: string[] = [];

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** 递归收集指定后缀的文件，返回相对 ROOT 的 posix 路径 */
function collect(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (exts.some((ext) => name.endsWith(ext))) {
        out.push(full.slice(ROOT.length + 1).replaceAll('\\', '/'));
      }
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const SRC_FILES = collect('src', ['.ts', '.tsx', '.css']);

// ============ [1] 品牌词残留 ============

console.log('\n[1] 旧品牌词「暖班台」零残留');
{
  const targets = [...SRC_FILES, 'index.html'];
  for (const file of ['public/favicon.svg', 'README.md']) {
    if (existsSync(join(ROOT, file))) {
      targets.push(file);
    }
  }

  const hits = targets.filter((file) => read(file).includes('暖班台'));
  check('src + index.html + public 无「暖班台」', hits.length === 0, hits.join(', '));

  check('BRAND.name 已更名', BRAND.name === '医键排班', BRAND.name);
  check('BRAND.fullTitle 已更名', BRAND.fullTitle === '医键排班 · 医生排班表工作台', BRAND.fullTitle);
  check('BRAND.slogan 已更新', BRAND.slogan === '让排班变简单，早点下班', BRAND.slogan);

  const html = read('index.html');
  check('index.html title 与 BRAND.fullTitle 一致', html.includes(`<title>${BRAND.fullTitle}</title>`));
  check('index.html description 已更名', /content="医键排班 · 医生排班表工作台：/.test(html));

  // 备份文件名是用户能直接看到的产物，改名必须跟上
  const backup = read('src/lib/backup.ts');
  check('backup.ts 备份文件名已更名', backup.includes('医键排班数据备份'));
  check('backup.ts 不含旧备份名', !backup.includes('暖班台数据备份'));

  // 但 JSON 里的 app 标识符不能动：改了会让旧备份文件全部无法恢复
  check('backup.ts 保留 app 标识 warmshift（向后兼容）', /['"]warmshift['"]/.test(backup));

  const errBoundary = read('src/components/ui/ErrorBoundary.tsx');
  check('ErrorBoundary 控制台前缀已更名', errBoundary.includes('[医键排班]'));
  check('ErrorBoundary 已移除咖啡 emoji', !errBoundary.includes('☕'));
}

// ============ [2] 旧设计令牌零引用 ============

console.log('\n[2] 旧令牌 --brown-* / --accent-* / --bg-cream* 零引用');
{
  const usage = /var\(\s*--(brown-|accent-|bg-cream)/;
  const used = SRC_FILES.filter((file) => usage.test(read(file)));
  check('src 内无 var(--brown-*/--accent-*/--bg-cream*) 引用', used.length === 0, used.join(', '));

  // 定义也必须删干净，否则下一个人会以为它们还能用
  const define = /^\s*--(brown-\d+|accent-\d+|bg-cream(-2)?)\s*:/m;
  const defined = SRC_FILES.filter((file) => define.test(read(file)));
  check('tokens 中旧变量定义已删除', defined.length === 0, defined.join(', '));

  // 新令牌齐备
  const tokens = read('src/styles/tokens.css');
  for (const name of [
    '--primary-900',
    '--primary-800',
    '--primary-700',
    '--primary-600',
    '--primary-300',
    '--primary-50',
    '--bg-chrome',
    '--bg-weekend',
    '--scrollbar-fg',
    '--scrollbar-fg-hover',
    '--tabbar-h',
    '--bp-mobile',
    '--z-tabbar',
  ]) {
    check(`tokens.css 定义 ${name}`, new RegExp(`^\\s*${name}\\s*:`, 'm').test(tokens));
  }

  // 阴影换成冷调：不得再出现暖棕的 rgba(62,39,35,...)
  check('阴影已换冷调 rgba(9,38,46,…)', tokens.includes('rgba(9, 38, 46'));
  check('无暖棕阴影残留', !/rgba\(\s*62\s*,\s*39\s*,\s*35/.test(tokens));

  // 死文件已清理
  check('已删除无引用的 src/App.css', !existsSync(join(ROOT, 'src/App.css')));
}

// ============ [3] 数据语义色未被波及 ============

console.log('\n[3] 数据语义色逐值比对（换肤不得触碰）');
{
  const EXPECTED_DOCTOR_COLORS: readonly string[] = [
    '#D84315', '#00695C', '#4527A0', '#558B2F', '#AD1457', '#F57F17',
    '#1565C0', '#6D4C41', '#00838F', '#7B1FA2', '#2E7D32', '#C62828',
  ];
  check('DOCTOR_COLORS 共 12 色', DOCTOR_COLORS.length === 12, `${DOCTOR_COLORS.length}`);
  const drift = DOCTOR_COLORS.filter((c, i) => c !== EXPECTED_DOCTOR_COLORS[i]);
  check('DOCTOR_COLORS 12 色全部未变', drift.length === 0, drift.join(', '));

  const EXPECTED_SHIFTS: Readonly<Record<string, string>> = {
    '--shift-clinic-bg': '#f1f8e9', '--shift-clinic-fg': '#33691e',
    '--shift-expertClinic-bg': '#ede7f6', '--shift-expertClinic-fg': '#4527a0',
    '--shift-emergency-bg': '#ffebee', '--shift-emergency-fg': '#c62828',
    '--shift-dayShift-bg': '#e0f7fa', '--shift-dayShift-fg': '#00695c',
    '--shift-nightShift-bg': '#ede7f6', '--shift-nightShift-fg': '#311b92',
    '--shift-continuousShift-bg': '#fff3e0', '--shift-continuousShift-fg': '#bf360c',
    '--shift-deputyShift-bg': '#fffde7', '--shift-deputyShift-fg': '#84600a',
    '--shift-chiefDuty-bg': '#fce4ec', '--shift-chiefDuty-fg': '#ad1457',
    '--shift-ward-bg': '#e8f5e9', '--shift-ward-fg': '#2e7d32',
    '--shift-rest-bg': '#efebe9', '--shift-rest-fg': '#6d4c41',
    '--shift-postNightRest-bg': '#d7ccc8', '--shift-postNightRest-fg': '#4e342e',
  };
  const tokens = read('src/styles/tokens.css');
  const shiftDrift: string[] = [];
  for (const [name, want] of Object.entries(EXPECTED_SHIFTS)) {
    const found = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
    if (found === null || found[1]?.toLowerCase() !== want) {
      shiftDrift.push(`${name}=${found?.[1] ?? 'MISSING'}`);
    }
  }
  check('11 组 --shift-* 共 22 个色值全部未变', shiftDrift.length === 0, shiftDrift.join(', '));
}

// ============ [4] WCAG 对比度实算 ============

console.log('\n[4] WCAG 对比度（相对亮度实算）');
{
  /** sRGB 分量 -> 线性值（WCAG 2.1 定义） */
  function channel(v: number): number {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function luminance(hex: string): number {
    const h = hex.replace('#', '');
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrast(fg: string, bg: string): number {
    const a = luminance(fg);
    const b = luminance(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  }

  const PAIRS: readonly { name: string; fg: string; bg: string; min: number }[] = [
    // 本轮三个「实测修订值」，正是因为初版算下来不达标才改的，必须钉死
    { name: '--text-tertiary 于 --bg-app（修订值）', fg: '#546E78', bg: '#F2F7F9', min: 4.5 },
    { name: '--text-tertiary 于 --bg-surface（修订值）', fg: '#546E78', bg: '#FFFFFF', min: 4.5 },
    { name: '--text-primary 于 --bg-weekend（修订值）', fg: '#0F2A33', bg: '#EAF2F5', min: 4.5 },
    { name: '--text-primary 于 --primary-50（修订值）', fg: '#0F2A33', bg: '#E4EDF2', min: 4.5 },
    // 主色相关
    { name: '白字于 --primary-600 主按钮', fg: '#FFFFFF', bg: '#00838F', min: 4.5 },
    { name: '白字于 --primary-700 按钮 hover', fg: '#FFFFFF', bg: '#006C7C', min: 4.5 },
    { name: '--primary-700 文字于 --bg-chrome 顶栏', fg: '#006C7C', bg: '#FFFFFF', min: 4.5 },
    // 工作量徽标：--primary-700 在 --border-base 上实测 4.45 不达标，故改用 800
    { name: '--primary-800 于 --border-base 工作量徽标', fg: '#00545F', bg: '#D2DEE3', min: 4.5 },
    { name: '--text-secondary 于 --bg-app', fg: '#4A6570', bg: '#F2F7F9', min: 4.5 },
    { name: '--text-primary 于 --bg-app', fg: '#0F2A33', bg: '#F2F7F9', min: 4.5 },
  ];

  for (const pair of PAIRS) {
    const ratio = contrast(pair.fg, pair.bg);
    check(
      `${pair.name} ≥ ${pair.min}:1（实算 ${ratio.toFixed(2)}）`,
      ratio >= pair.min,
      `${ratio.toFixed(2)}`,
    );
  }

  // 大字/图形件走 AA 的 3:1 档，单列出来避免与正文标准混淆
  const iconRatio = contrast('#00838F', '#FFFFFF');
  check(`--primary-600 图标于白底 ≥ 3:1（实算 ${iconRatio.toFixed(2)}）`, iconRatio >= 3);
}

// ============ [5] 断点三处一致 ============

console.log('\n[5] 移动端断点三处一致（768）');
{
  check('MOBILE_MAX === 768', MOBILE_MAX === 768, `${MOBILE_MAX}`);
  check('MOBILE_QUERY 由 MOBILE_MAX 拼装', MOBILE_QUERY === '(max-width: 768px)', MOBILE_QUERY);

  const tokens = read('src/styles/tokens.css');
  const bp = /--bp-mobile\s*:\s*(\d+)px/.exec(tokens);
  check('tokens.css --bp-mobile 与 MOBILE_MAX 同值', bp?.[1] === String(MOBILE_MAX), bp?.[1] ?? 'MISSING');

  const mobileCss = read('src/styles/mobile.css');
  check(
    'mobile.css 存在 @media (max-width: 768px)',
    new RegExp(`@media \\(max-width:\\s*${MOBILE_MAX}px\\)`).test(mobileCss),
  );
  // 旧的 720 硬降级块必须已经删掉，否则两套断点会在 720~768 之间打架
  const allCss = SRC_FILES.filter((f) => f.endsWith('.css'));
  const stale720 = allCss.filter((f) => /@media \(max-width:\s*720px\)/.test(read(f)));
  check('全站已移除 720px 硬降级块', stale720.length === 0, stale720.join(', '));

  // mobile.css 的加载位置决定它能否不靠 !important 覆盖前面的布局
  const indexCss = read('src/styles/index.css');
  const order = ['./layout.css', './panels.css', './mobile.css', './print.css'].map((n) =>
    indexCss.indexOf(`@import '${n}'`),
  );
  check('mobile.css 已挂载到 index.css', order[2] !== undefined && order[2] > -1);
  check(
    'mobile.css 排在 layout/panels 之后、print 之前',
    order.every((pos, i) => pos > -1 && (i === 0 || pos > (order[i - 1] ?? -1))),
    order.join(','),
  );

  // JS 侧只允许从 breakpoints.ts 取查询串，不许再手写 matchMedia 字面量
  const jsFiles = SRC_FILES.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  const handwritten = jsFiles.filter(
    (f) => f !== 'src/constants/breakpoints.ts' && /matchMedia\(\s*['"`]\(max-width:\s*768/.test(read(f)),
  );
  check('无手写 768 的 matchMedia 字面量', handwritten.length === 0, handwritten.join(', '));

  const useIsMobile = read('src/components/layout/useIsMobile.ts');
  check('useIsMobile 走 useSyncExternalStore', useIsMobile.includes('useSyncExternalStore'));
  check('useIsMobile 引用 MOBILE_QUERY', useIsMobile.includes('MOBILE_QUERY'));

  // 44px 最小可点触面积不得为了塞下更多列而压缩
  check('--cell-min-w 仍为 44px', /--cell-min-w:\s*44px/.test(tokens));
}

// ============ [6] BottomTabBar 渲染 + 状态切换 ============

console.log('\n[6] BottomTabBar 渲染 + 默认值 + 切换');
{
  function withState(state: AppState, children: ReactNode): ReactElement {
    return (
      <AppDispatchContext.Provider value={() => undefined}>
        <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>
      </AppDispatchContext.Provider>
    );
  }

  const initial = createInitialState();
  check('初始 mobileTab 为 schedule', initial.ui.mobileTab === 'schedule', initial.ui.mobileTab);

  const html = renderToStaticMarkup(withState(initial, <BottomTabBar />));
  check('渲染 tablist', html.includes('role="tablist"'));
  check('渲染三个 tab', (html.match(/role="tab"/g) ?? []).length === 3);
  check('三个页签文案齐全',
    html.includes(TEXTS.mobileTabRoster) &&
    html.includes(TEXTS.mobileTabSchedule) &&
    html.includes(TEXTS.mobileTabInsight));
  check('tablist 有无障碍名', html.includes(TEXTS.mobileTabBarLabel));
  check('默认选中「排班」', /id="mobile-tab-schedule"[^>]*aria-selected="true"/.test(html));
  check('未选中项 tabIndex=-1（roving tabindex）', (html.match(/tabindex="-1"/g) ?? []).length === 2);
  check('页签指向对应内容区', html.includes('aria-controls="mobile-tabpanel-schedule"'));
  check('底栏带 no-print（打印不出现）', html.includes('no-print'));

  // reducer 切换
  const switched = reducer(initial, { type: 'ui/setMobileTab', payload: { tab: 'insight' } });
  check('reducer 切到 insight', switched.ui.mobileTab === 'insight', switched.ui.mobileTab);
  const switchedHtml = renderToStaticMarkup(withState(switched, <BottomTabBar />));
  check('切换后「洞察」选中', /id="mobile-tab-insight"[^>]*aria-selected="true"/.test(switchedHtml));
  check('切换后「排班」取消选中', /id="mobile-tab-schedule"[^>]*aria-selected="false"/.test(switchedHtml));

  const backToRoster = reducer(switched, { type: 'ui/setMobileTab', payload: { tab: 'roster' } });
  check('reducer 切到 roster', backToRoster.ui.mobileTab === 'roster', backToRoster.ui.mobileTab);

  // 切页签不得动业务数据，也不得进撤销栈
  check('切页签不改医生名册', backToRoster.doctors === initial.doctors);
  check('切页签不改排班数据', backToRoster.schedules === initial.schedules);
  check('切页签不进撤销栈', backToRoster.history.past.length === initial.history.past.length);

  // 洞察面板「定位」必须把手机端切回排班，否则点了定位屏幕纹丝不动
  const located = reducer(backToRoster, {
    type: 'ui/locate',
    payload: { month: initial.ui.currentMonth, date: `${initial.ui.currentMonth}-01`, doctorId: 'd1' },
  });
  check('定位后自动切回「排班」页签', located.ui.mobileTab === 'schedule', located.ui.mobileTab);

  // mobileTab 属于纯视图态：不得被写进 localStorage，也不得进备份文件。
  // 持久化只认 DataSnapshot（doctors / rules / schedules），ui 整块不在其中，
  // 这里连同存储与备份两条链路一起断言，防止有人「顺手」把 ui 也存了。
  for (const file of ['src/lib/storage.ts', 'src/lib/storageSchema.ts', 'src/lib/backup.ts']) {
    check(`${file} 不涉及 mobileTab`, !read(file).includes('mobileTab'));
  }
  const stateTypes = read('src/types/state.ts');
  const snapshotDecl = /export interface DataSnapshot \{([\s\S]*?)\n\}/.exec(stateTypes);
  check('DataSnapshot 不含 ui 字段', snapshotDecl !== null && !/\bui\s*[?:]/.test(snapshotDecl[1] ?? ''));
}

// ============ [7] 品牌产物 ============

console.log('\n[7] 图标 / favicon / 移动布局产物');
{
  const icons = read('src/components/ui/Icons.tsx');
  check('Icons 新增 medcross', /^\s*medcross:\s*'/m.test(icons));
  check('Icons 已删除 coffee', !/^\s*coffee:/m.test(icons));

  const topbar = read('src/components/layout/TopBar.tsx');
  check('TopBar 品牌图标改用 medcross', topbar.includes('name="medcross"'));
  check('TopBar 不再引用 coffee', !topbar.includes('"coffee"'));
  check('TopBar 依据 useIsMobile 分支', topbar.includes('useIsMobile'));
  check('TopBar 移动端挂载 MoreMenu', topbar.includes('<MoreMenu'));

  const moreMenu = read('src/components/TopBar/MoreMenu.tsx');
  check('MoreMenu 使用「更多操作」无障碍名', moreMenu.includes('TEXTS.moreActions'));
  check('MoreMenu 已 React.memo', /export const MoreMenu = memo\(/.test(moreMenu));
  check('MoreMenu 为纯 props 组件（不订阅 Context）',
    !/use(AppState|AppDispatch|Derived)\(/.test(moreMenu));
  check('MoreMenu 收纳撤销/重做/规则/三种导出',
    ['undoButton', 'redoButton', 'rulesButton', 'exportCsv', 'exportPng', 'printSchedule']
      .every((key) => moreMenu.includes(`TEXTS.${key}`)));
  check('MoreMenu 保留保存状态与重试', moreMenu.includes('SaveIndicator') && moreMenu.includes('onRetrySave'));

  const empty = read('src/components/ScheduleTable/EmptyState.tsx');
  check('EmptyState 图标改用 medcross', empty.includes('name="medcross"'));
  check('EmptyState 展示品牌 slogan', empty.includes('BRAND.slogan'));

  check('favicon.svg 存在', existsSync(join(ROOT, 'public/favicon.svg')));
  const favicon = read('public/favicon.svg');
  check('favicon 使用主色 #00838F', favicon.includes('#00838F'));
  check('favicon 为 32×32 viewBox', favicon.includes('viewBox="0 0 32 32"'));
  check('favicon 描边为白色', /stroke="#FFFFFF"/i.test(favicon));
  check('favicon 不含旧紫色渐变', !/linearGradient/i.test(favicon));

  // 旧的窄屏硬降级提示整条链路都要拆掉：文案、DOM、CSS
  check('texts 已移除 narrowScreenHint', !read('src/constants/texts.ts').includes('narrowScreenHint'));
  const mainArea = read('src/components/layout/MainArea.tsx');
  check('MainArea 已移除窄屏提示 DOM', !mainArea.includes('app-narrow-hint'));
  check('MainArea 接受 a11y 透传', mainArea.includes('TabPanelA11y') && mainArea.includes('{...a11y}'));

  const app = read('src/App.tsx');
  check('App 输出 data-active-tab', app.includes('data-active-tab'));
  check('App 挂载 BottomTabBar', app.includes('<BottomTabBar />'));
  check('App 分发三块内容区的 tabpanel 语义',
    app.includes("tabPanelA11y('roster'") &&
    app.includes("tabPanelA11y('schedule'") &&
    app.includes("tabPanelA11y('insight'"));

  const mobileCss = read('src/styles/mobile.css');
  check('mobile.css 定义 .app-tabbar', mobileCss.includes('.app-tabbar'));
  check('mobile.css 桌面端隐藏底栏', /\.app-tabbar\s*\{\s*display:\s*none;/.test(mobileCss));
  check('mobile.css 按 data-active-tab 切换内容区', mobileCss.includes("data-active-tab='schedule'"));
  check('mobile.css 三个页签各有对应内容区',
    ["data-active-tab='roster'", "data-active-tab='schedule'", "data-active-tab='insight'"]
      .every((sel) => mobileCss.includes(sel)));
  check('mobile.css 移动端抽屉铺满', /\.overlay--right \.drawer\s*\{[^}]*width:\s*100%/.test(mobileCss));
  check('mobile.css 底栏预留安全区', mobileCss.includes('safe-area-inset-bottom'));
  check('mobile.css 无硬编码颜色',
    (mobileCss.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/g) ?? []).length === 0);
  // 手机上按钮/单元格的最小可点触面积不得被这一层压缩
  check('mobile.css 未覆盖 --cell-min-w', !mobileCss.includes('--cell-min-w'));

  // 300 行硬上限：本轮新增/改动的文件逐一过一遍
  const OWNED: readonly string[] = [
    'src/styles/mobile.css',
    'src/styles/tokens.css',
    'src/styles/layout.css',
    'src/components/layout/TopBar.tsx',
    'src/components/layout/BottomTabBar.tsx',
    'src/components/layout/MainArea.tsx',
    'src/components/layout/useIsMobile.ts',
    'src/components/TopBar/MoreMenu.tsx',
    'src/constants/breakpoints.ts',
  ];
  const tooLong = OWNED
    .map((f) => [f, read(f).split('\n').length] as const)
    .filter(([, n]) => n > 300);
  check('本轮自有文件均 ≤ 300 行', tooLong.length === 0, tooLong.map(([f, n]) => `${f}:${n}`).join(', '));
}

console.log(
  fails.length === 0
    ? '\nREBRAND SMOKE PASS'
    : `\nREBRAND SMOKE FAIL (${fails.length}): ${fails.join(' | ')}`,
);
if (fails.length > 0) {
  process.exitCode = 1;
}
