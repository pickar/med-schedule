// T05a 烟测：医生名册 + 规则抽屉（SSR 渲染验证）。
// 覆盖四类场景：
//   ① DoctorPanel 空态 / 有数据 / 搜索无结果
//   ② DoctorForm 新增 / 编辑（纯展示层，拆自 DoctorDrawer 容器）
//   ③ RulesForm + 三种轮流模式（纯展示层，拆自 RulesDrawer 容器）
//   ④ 姓名空值 / 重名两分支（含渲染层断言）
// 不参与 src 构建（tsconfig include 仅 ["src"]），用 `vite build --ssr` 打包后由 node 执行。
//
// 关于抽屉的取舍：DoctorDrawer / RulesDrawer 依赖 createPortal（Overlay 底层），
// 在 renderToStaticMarkup 下会抛 "Portals are not currently supported by the server renderer"。
// 因此烟测只渲染拆出来的纯展示层 DoctorForm / RulesForm（不含 Portal），
// 与 T05a 把「容器 / 表单」分家的设计一一对应。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './smokeShim';
import type { AppState, Rules } from '../src/types/state';
import type { RotationRule } from '../src/types/domain';
import { createInitialState, reducer } from '../src/state/reducer';
import { AppDispatchContext, AppStateContext } from '../src/state/contexts';
import { createId } from '../src/lib/id';
import { TEXTS } from '../src/constants/texts';
import { createDefaultRules } from '../src/constants/defaults';
import { DoctorPanel } from '../src/components/DoctorPanel/DoctorPanel';
import { DoctorForm, createDoctorDraft, checkDoctorName } from '../src/components/DoctorPanel/DoctorForm';
import { RulesForm } from '../src/components/RulesDrawer/RulesDrawer';
import type { RulesFormHandlers } from '../src/components/RulesDrawer/RulesDrawer';

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

/** 静态检查前先剥掉注释，避免「注释里提醒后人别用」被误判为真的用了 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function noop(): void {
  /* SSR 烟测不触发交互，dispatch 用空操作占位 */
}

/** 手动下发两层 Context，避免 AppProvider 的浮层 / 副作用拖累 SSR */
function withState(state: AppState, children: ReactNode): ReactElement {
  return (
    <AppDispatchContext.Provider value={noop}>
      <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>
    </AppDispatchContext.Provider>
  );
}

// ============ 数据播种 ============

function withDoctors(): AppState {
  return reducer(createInitialState(), { type: 'doctor/loadSamples' });
}

const noopHandlers: RulesFormHandlers = {
  onDepartmentName: noop,
  onShiftBound: noop,
  onRestDays: noop,
  onNoConsecutiveNight: noop,
  onAddRotation: noop,
  onUpdateRotation: noop,
  onRemoveRotation: noop,
};

// ============ ① DoctorPanel 左栏名册 ============

console.log('\n[1] DoctorPanel 左栏名册');
{
  const empty = createInitialState();
  const emptyHtml = renderToStaticMarkup(withState(empty, <DoctorPanel />));
  check('空态引导文案', emptyHtml.includes(TEXTS.doctorEmpty));
  check('空态不渲染医生列表', !emptyHtml.includes('class="doctor-list"'));

  const data = withDoctors();
  const dataHtml = renderToStaticMarkup(withState(data, <DoctorPanel />));
  check('有数据时渲染医生列表', dataHtml.includes('class="doctor-list"'));
  check('计数统计正确', dataHtml.includes(TEXTS.doctorCountLabel(data.doctors.length)));
  check('出现示例医生姓名', dataHtml.includes(data.doctors[0].name));
  check('搜索框占位文案存在', dataHtml.includes(TEXTS.doctorSearchPlaceholder));
  // 固定门诊日（如张伟 周一/周四）→ 卡片应显示「固定门诊 一二三四五六日」式缩写
  check('卡片渲染固定门诊缩写', dataHtml.includes('固定门诊'));

  const searching: AppState = { ...data, ui: { ...data.ui, doctorSearch: 'zzzzz' } };
  const searchHtml = renderToStaticMarkup(withState(searching, <DoctorPanel />));
  check('搜索无结果落到过滤空态', searchHtml.includes(TEXTS.doctorFilterEmpty));
  check('搜索无结果不再显示任何医生姓名', !searchHtml.includes(data.doctors[0].name));
  check(
    '搜索无结果仍保留计数与新增入口',
    searchHtml.includes(TEXTS.doctorCountLabel(data.doctors.length)) && searchHtml.includes(TEXTS.doctorAdd),
  );
}

// ============ ② DoctorForm 新增 / 编辑 ============

console.log('\n[2] DoctorForm 新增 / 编辑');
{
  const addHtml = renderToStaticMarkup(
    <DoctorForm draft={createDoctorDraft(null, '#D84315')} onPatch={noop} nameCheck={checkDoctorName('', [], null)} showError={false} />,
  );
  check('新增态含姓名占位', addHtml.includes(TEXTS.doctorNamePlaceholder));
  check('含固定门诊日分区', addHtml.includes(TEXTS.fixedClinicDaysLabel));
  check('含个人约束分区', addHtml.includes(TEXTS.constraintsLabel));
  check('含请假登记分区', addHtml.includes(TEXTS.leaveDrawerTitle));
  // 精确匹配色板按钮（排除 `color-swatches` 容器自身）：未选中为 `class="color-swatch"`，
  // 选中为 `class="color-swatch is-checked"`，容器是 `class="color-swatches"`（不匹配）
  const swatchMatches = addHtml.match(/class="color-swatch("| is-checked")/g) ?? [];
  check('12 色板齐全', swatchMatches.length === 12, `${swatchMatches.length}`);
  check('新增态姓名输入为空', !addHtml.includes('value="张'));

  const data = withDoctors();
  const target = data.doctors[0];
  const editHtml = renderToStaticMarkup(
    <DoctorForm
      draft={createDoctorDraft(target, '#D84315')}
      onPatch={noop}
      nameCheck={checkDoctorName(target.name, data.doctors, target.id)}
      showError={false}
    />,
  );
  check('编辑态回填姓名', editHtml.includes(`value="${target.name}"`));
  check('编辑态回填职称', editHtml.includes(`<option value="${target.title}"`));
  check('编辑态回填固定门诊日', editHtml.includes('class="toggle-chip is-checked"'));
}

// ============ ③ RulesForm + 三种轮流模式 ============

console.log('\n[3] RulesForm 规则抽屉（含三种轮流模式）');
{
  const doctors = withDoctors().doctors;
  const rules: Rules = createDefaultRules();
  const rotationRules: RotationRule[] = [
    { id: createId(), weekday: 1, mode: 'all', doctorIds: [] },
    { id: createId(), weekday: 3, mode: 'selected', doctorIds: [doctors[0].id, doctors[1].id] },
    { id: createId(), weekday: 5, mode: 'random', doctorIds: [] },
  ];
  const html = renderToStaticMarkup(
    <RulesForm rules={{ ...rules, rotationRules }} doctors={doctors} handlers={noopHandlers} />,
  );

  check('科室名输入存在', html.includes(TEXTS.departmentNameLabel));
  check('每日班次人数表存在', html.includes('class="rules-grid"'));
  // 周一~周日 7 行（不含表头行，表头 class 带 --head 后缀，不匹配 exact 子串）
  check('周一~周日 7 行人数区间', countOf(html, 'class="rules-grid__row"') === 7, `${countOf(html, 'class="rules-grid__row"')}`);
  check('休息天数 Stepper 存在', html.includes(TEXTS.restDaysLabel));
  check('自动规则区存在', html.includes(TEXTS.autoRulesTitle));
  check('夜下休锁定态（标签 + 锁定提示）', html.includes(TEXTS.autoPostNightRestLabel) && html.includes(TEXTS.autoPostNightRestLocked));
  check('禁止连续夜班开关', html.includes(TEXTS.noConsecutiveNightLabel));
  check('轮流门诊区存在', html.includes(TEXTS.rotationTitle));
  check('全员轮流模式文案', html.includes(TEXTS.rotationModeAll));
  check('指定医生轮流模式文案', html.includes(TEXTS.rotationModeSelected));
  check('随机分配模式文案', html.includes(TEXTS.rotationModeRandom));
  check('selected 模式渲染参与医生多选', html.includes(TEXTS.rotationDoctorsLabel) && html.includes(doctors[0].name));
  check('random 模式渲染随机说明', html.includes(TEXTS.randomModeLabel));
  check('三种模式并集为 3 条规则', countOf(html, 'class="rotation-item"') === 3, `${countOf(html, 'class="rotation-item"')}`);
}

// ============ ④ 姓名校验 · 空值 / 重名 ============

console.log('\n[4] 姓名校验 · 空值 / 重名');
{
  const data = withDoctors();
  const emptyCheck = checkDoctorName('', data.doctors, null);
  check('空姓名阻断保存（error）', emptyCheck.error === TEXTS.doctorNameRequired && emptyCheck.warning === null);

  const dupName = data.doctors[0].name;
  const dupCheck = checkDoctorName(dupName, data.doctors, null);
  check('重名不阻断、只提醒（warning）', dupCheck.error === null && dupCheck.warning === TEXTS.doctorNameDuplicated);

  // 编辑本人时同名不算重名：editingId 命中自己
  const selfCheck = checkDoctorName(data.doctors[0].name, data.doctors, data.doctors[0].id);
  check('编辑本人同名不报重名', selfCheck.warning === null);

  const emptyForm = renderToStaticMarkup(
    <DoctorForm draft={createDoctorDraft(null, '#D84315')} onPatch={noop} nameCheck={emptyCheck} showError />,
  );
  check('空值渲染必填错误', emptyForm.includes(TEXTS.doctorNameRequired));
  check('空值输入框标红 aria-invalid', emptyForm.includes('aria-invalid="true"'));

  const dupForm = renderToStaticMarkup(
    <DoctorForm draft={createDoctorDraft(data.doctors[0], '#D84315')} onPatch={noop} nameCheck={dupCheck} showError />,
  );
  check('重名渲染提醒而非阻断', dupForm.includes(TEXTS.doctorNameDuplicated) && !dupForm.includes(TEXTS.doctorNameRequired));
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

  const t05Files = files.filter((f) => rel(f).startsWith('src/components/DoctorPanel/') || rel(f).startsWith('src/components/RulesDrawer/'));
  check('T05a 组件文件齐全（6 个）', t05Files.length === 6, `${t05Files.length}`);

  // 红线一：DoctorCard / RotationRuleItem 必须 memo
  for (const name of ['DoctorCard', 'RotationRuleItem']) {
    const text = readFileSync(join(root, `src/components/${name === 'DoctorCard' ? 'DoctorPanel' : 'RulesDrawer'}`, `${name}.tsx`), 'utf8');
    check(`${name} 已 React.memo`, new RegExp(`export const ${name} = memo\\(`).test(text));
  }

  // 红线二：父级容器必须用 useCallback 固定回调引用
  const panelSrc = readFileSync(join(root, 'src/components/DoctorPanel/DoctorPanel.tsx'), 'utf8');
  check('DoctorPanel 用 useCallback 固定 onEdit', /const handleEdit = useCallback\(/.test(panelSrc));
  const rulesSrc = readFileSync(join(root, 'src/components/RulesDrawer/RulesDrawer.tsx'), 'utf8');
  check('RulesDrawer 用 useCallback 固定 handlers', /useCallback\(/.test(rulesSrc));

  // 红线三：删除走 ConfirmDialog，不得 window.confirm
  for (const name of ['DoctorDrawer', 'DoctorForm']) {
    const text = stripComments(readFileSync(join(root, `src/components/DoctorPanel/${name}.tsx`), 'utf8'));
    check(`${name} 不使用 window.confirm`, !/\bwindow\.confirm\b/.test(text));
  }
  const drawerText = readFileSync(join(root, 'src/components/DoctorPanel/DoctorDrawer.tsx'), 'utf8');
  check('DoctorDrawer 接入 ConfirmDialog', drawerText.includes('ConfirmDialog'));

  // 红线四：panels.css 已挂载且无硬编码颜色
  const indexCss = readFileSync(join(root, 'src/styles/index.css'), 'utf8');
  check('panels.css 已挂载到 index.css', indexCss.includes('./panels.css'));
  const panelCss = readFileSync(join(root, 'src/styles/panels.css'), 'utf8');
  const hardcoded = panelCss.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/g) ?? [];
  check('panels.css 无硬编码颜色', hardcoded.length === 0, hardcoded.join(' '));

  // 红线五：T05a 自有文件单文件 ≤ 300 行（共享文件 texts.ts / canvasTable.ts 属 T05 其他子任务，
  // 不在 T05a 交付边界内，单独登记、不计入本任务门禁）
  const t05Owned = [...t05Files, join(root, 'src/styles/panels.css')];
  const tooLong = t05Owned
    .map((f) => [rel(f), readFileSync(f, 'utf8').split('\n').length] as const)
    .filter(([, lines]) => lines > 300);
  check('T05a 自有文件无超过 300 行的', tooLong.length === 0, tooLong.map(([f, n]) => `${f}:${n}`).join(', '));

  // 红线六：文案只走 TEXTS，组件层不得自造竞品原文冗余
  const panelBundle = t05Files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  // 竞品原文硬约束短语不应以字面量散落在组件里（应统一进 TEXTS）
  for (const phrase of ['全员轮流（公平轮值）', '指定医生轮流', '随机分配一人', '夜班后自动夜下休', '禁止连续夜班', '不上白班']) {
    check(`组件未自造竞品原文「${phrase}」`, !panelBundle.includes(phrase));
  }
}

console.log(fails.length === 0 ? '\nT05a SMOKE PASS' : `\nT05a SMOKE FAIL (${fails.length}): ${fails.join(' | ')}`);
if (fails.length > 0) {
  process.exitCode = 1;
}
