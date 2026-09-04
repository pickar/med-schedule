/**
 * 根 reducer：分发到四个域 handler，并在出口统一做「历史记录 + 规则不变量」。
 *
 * 三条设计约定：
 * 1. **handler 只管数据，历史由这里统一记**。散落在各 handler 里记历史，
 *    迟早会出现「某个新 action 忘了记」的漏网之鱼。
 * 2. **数据没变就不记历史**。所有 handler 在无变化时返回原 state 引用，
 *    这里靠 `next === state` 判断。否则用户连点两次同一个班次会压进两条空历史，
 *    撤销时按一下没反应。
 * 3. UI 类 action（`ui/*`、`app/saveStatus`、`history/*`）**不进历史**。
 *    撤销栈里混进「折叠了左栏」这种事，会让 Ctrl+Z 变成俄罗斯轮盘。
 */

import type { Action, AppState, UIState } from '../types/state';
import type { DataSnapshot } from '../types/state';
import { createDefaultRules, SCHEMA_VERSION } from '../constants/defaults';
import { seedBuiltinShifts } from '../constants/shifts';
import { currentMonthKey, formatMD, formatMonthLabel, monthOfDate } from '../lib/date';
import { weekdayLabel } from '../constants/texts';
import { emptyHistory, pushHistory, redo, snapshotOf, undo } from './history';
import * as doctors from './handlers/doctorHandlers';
import * as rules from './handlers/rulesHandlers';
import * as schedule from './handlers/scheduleHandlers';
import * as shiftDef from './handlers/shiftHandlers';

/** 参与撤销的数据类 action */
type DataAction = Extract<
  Action,
  | { type: `doctor/${string}` }
  | { type: `rules/${string}` }
  | { type: `schedule/${string}` }
  | { type: `shiftDef/${string}` }
  | { type: 'app/clearAll' }
>;

export function createInitialUIState(): UIState {
  return {
    currentMonth: currentMonthKey(),
    doctorPanelCollapsed: false,
    insightPanelCollapsed: false,
    mobileTab: 'schedule',
    mobileDoctorId: null,
    activeDrawer: 'none',
    editingDoctorId: null,
    doctorSearch: '',
    highlightDoctorId: null,
    highlightCell: null,
    statsExpanded: false,
    legendExpanded: false,
    shiftCycleOpen: false,
    shiftCycleDoctorId: null,
    generating: false,
    lastDiagnostics: [],
    saveStatus: 'idle',
    lastSavedAt: null,
    storageError: null,
  };
}

export function createInitialState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    doctors: [],
    rules: createDefaultRules(),
    schedules: {},
    customShifts: seedBuiltinShifts([]),
    ui: createInitialUIState(),
    history: emptyHistory(),
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'history/undo':
      return timeTravel(state, 'undo');
    case 'history/redo':
      return timeTravel(state, 'redo');
    case 'app/hydrate':
      return hydrate(state, action.payload);
    case 'app/saveStatus':
      return patchUI(state, {
        saveStatus: action.payload.status,
        lastSavedAt: action.payload.at ?? state.ui.lastSavedAt,
        storageError: action.payload.status === 'error' ? (action.payload.error ?? '') : null,
      });
    case 'ui/patch':
      return patchUI(state, action.payload);
    case 'ui/setMonth':
      return patchUI(state, {
        currentMonth: action.payload.month,
        highlightDoctorId: null,
        highlightCell: null,
      });
    case 'ui/openDoctorDrawer':
      return patchUI(state, { activeDrawer: 'doctor', editingDoctorId: action.payload.doctorId });
    case 'ui/setMobileTab':
      return patchUI(state, { mobileTab: action.payload.tab });
    case 'ui/locate':
      return locate(state, action.payload);
    default:
      return applyData(state, action);
  }
}

// ============ 数据类 action ============

/** 数据变更统一出口：先算新数据，再补历史与不变量 */
function applyData(state: AppState, action: DataAction): AppState {
  const mutated = mutate(state, action);
  // 引用未变 = 这次操作没产生实际改动，不记历史（见文件头约定 2）
  if (mutated === state) {
    return state;
  }

  const normalized = rules.enforceRulesInvariants(mutated.rules);
  const next = normalized === mutated.rules ? mutated : { ...mutated, rules: normalized };

  return { ...next, history: pushHistory(state.history, snapshotOf(state), labelOf(state, action)) };
}

function mutate(state: AppState, action: DataAction): AppState {
  switch (action.type) {
    case 'doctor/add':
      return doctors.addDoctor(state, action.payload);
    case 'doctor/update':
      return doctors.updateDoctor(state, action.payload);
    case 'doctor/remove':
      return doctors.removeDoctor(state, action.payload.id);
    case 'doctor/loadSamples':
      return doctors.loadSampleDoctors(state);
    case 'doctor/addLeave':
      return doctors.addLeave(state, action.payload.doctorId, action.payload.leave);
    case 'doctor/removeLeave':
      return doctors.removeLeave(state, action.payload.doctorId, action.payload.leaveId);
    case 'rules/patch':
      return rules.patchRules(state, action.payload);
    case 'rules/setWeekdayShift':
      return rules.setWeekdayShift(
        state,
        action.payload.weekday,
        action.payload.shift,
        action.payload.bound,
        action.payload.value,
      );
    case 'rules/addRotation':
      return rules.addRotation(state, action.payload);
    case 'rules/updateRotation':
      return rules.updateRotation(state, action.payload);
    case 'rules/removeRotation':
      return rules.removeRotation(state, action.payload.id);
    case 'schedule/setCell':
      return schedule.setCell(
        state,
        action.payload.date,
        action.payload.doctorId,
        action.payload.shiftType,
        action.payload.manual ?? true,
      );
    case 'schedule/toggleLock':
      return schedule.toggleLock(state, action.payload.date, action.payload.doctorId);
    case 'schedule/unlockAll':
      return schedule.unlockAll(state, action.payload.month);
    case 'schedule/applyGenerated':
      return schedule.applyGenerated(state, action.payload.month, action.payload.entries);
    case 'schedule/clearMonth':
      return schedule.clearMonth(state, action.payload.month);
    case 'schedule/applyShiftCycle':
      return schedule.applyShiftCycle(state, action.payload);
    case 'shiftDef/add':
      return shiftDef.addCustomShift(state, action.payload);
    case 'shiftDef/update':
      return shiftDef.updateCustomShift(state, action.payload);
    case 'shiftDef/remove':
      return shiftDef.removeCustomShift(state, action.payload.id, action.payload.clearUsages);
    case 'app/clearAll':
      return clearAllData(state);
    default:
      return state;
  }
}

/** 清空全部数据但保留 UI 状态（当前月份、面板折叠态不该被重置） */
function clearAllData(state: AppState): AppState {
  if (
    state.doctors.length === 0 &&
    Object.keys(state.schedules).length === 0 &&
    state.customShifts.length === 0
  ) {
    return state;
  }
  return { ...state, doctors: [], schedules: {}, rules: createDefaultRules(), customShifts: seedBuiltinShifts([]) };
}

// ============ 历史文案 ============

function nameOf(state: AppState, doctorId: string): string {
  return state.doctors.find((d) => d.id === doctorId)?.name ?? '医生';
}

/** 撤销按钮 tooltip 显示的操作名，务必写成用户能认出自己刚做了什么的样子 */
function labelOf(state: AppState, action: DataAction): string {
  switch (action.type) {
    case 'doctor/add':
      return `新增医生「${action.payload.name || '未命名'}」`;
    case 'doctor/update':
      return `编辑医生「${action.payload.name}」`;
    case 'doctor/remove':
      return `删除医生「${nameOf(state, action.payload.id)}」`;
    case 'doctor/loadSamples':
      return '载入示例医生';
    case 'doctor/addLeave':
      return `登记 ${nameOf(state, action.payload.doctorId)} 请假`;
    case 'doctor/removeLeave':
      return `删除 ${nameOf(state, action.payload.doctorId)} 的请假`;
    case 'rules/patch':
      return '修改排班规则';
    case 'rules/setWeekdayShift':
      return `调整${weekdayLabel(action.payload.weekday)}班次人数`;
    case 'rules/addRotation':
      return '添加轮流门诊规则';
    case 'rules/updateRotation':
      return '修改轮流门诊规则';
    case 'rules/removeRotation':
      return '删除轮流门诊规则';
    case 'schedule/setCell':
      return `修改 ${nameOf(state, action.payload.doctorId)} ${formatMD(action.payload.date)} 班次`;
    case 'schedule/toggleLock':
      return `${lockVerb(state, action.payload.date, action.payload.doctorId)} ${nameOf(state, action.payload.doctorId)} ${formatMD(action.payload.date)}`;
    case 'schedule/unlockAll':
      return `解除${formatMonthLabel(action.payload.month)}全部锁定`;
    case 'schedule/applyGenerated':
      return `生成${formatMonthLabel(action.payload.month)}排班`;
    case 'schedule/clearMonth':
      return `清空${formatMonthLabel(action.payload.month)}排班`;
    case 'schedule/applyShiftCycle': {
      const range = `${formatMD(action.payload.startDate)}–${formatMD(action.payload.endDate)}`;
      const ids = action.payload.doctorIds;
      return ids.length > 1
        ? `轮班：${ids.length} 位医生 ${range}`
        : `轮班：${nameOf(state, ids[0] ?? '')} ${range}`;
    }
    case 'shiftDef/add':
      return `新增班次「${action.payload.label || '未命名'}」`;
    case 'shiftDef/update':
      return `编辑班次「${action.payload.label}」`;
    case 'shiftDef/remove':
      return `删除班次「${action.payload.id}」`;
    case 'app/clearAll':
      return '清空全部数据';
    default:
      return '修改数据';
  }
}

/** 注意：label 在变更**前**计算，所以这里看到的 locked 是切换前的值 */
function lockVerb(state: AppState, date: string, doctorId: string): string {
  const entry = state.schedules[monthOfDate(date)]?.[date]?.[doctorId];
  return entry?.locked ? '解锁' : '锁定';
}

// ============ UI / 历史 / 水合 ============

/** 逐字段对比后再写，避免 saveStatus 这类高频 action 造出无意义的新 state */
function patchUI(state: AppState, patch: Partial<UIState>): AppState {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof UIState)[]) {
    if (!Object.is(state.ui[key], patch[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    return state;
  }
  return { ...state, ui: { ...state.ui, ...patch } };
}

/** 洞察面板「定位」：跨月违规要顺带把月份切过去，否则点了看不到任何反应 */
function locate(state: AppState, payload: { date?: string; doctorId?: string }): AppState {
  const { date, doctorId } = payload;
  return patchUI(state, {
    currentMonth: date ? monthOfDate(date) : state.ui.currentMonth,
    highlightDoctorId: doctorId ?? null,
    highlightCell: date && doctorId ? { date, doctorId } : null,
    // 定位到左栏被折叠的医生行没有意义，顺手展开
    doctorPanelCollapsed: doctorId ? false : state.ui.doctorPanelCollapsed,
    // 移动端「定位」是从洞察 Tab 发起的，不切回排班 Tab 就等于点了没反应
    mobileTab: 'schedule',
  });
}

function timeTravel(state: AppState, direction: 'undo' | 'redo'): AppState {
  const result =
    direction === 'undo'
      ? undo(state.history, snapshotOf(state))
      : redo(state.history, snapshotOf(state));
  if (!result) {
    return state;
  }
  return {
    ...state,
    doctors: result.snapshot.doctors,
    rules: result.snapshot.rules,
    schedules: result.snapshot.schedules,
    customShifts: result.snapshot.customShifts,
    history: result.history,
    // 时间旅行后原高亮的单元格可能已不存在，一并清掉避免指向空格
    ui: { ...state.ui, highlightCell: null, highlightDoctorId: null },
  };
}

/** 从本地存储水合。历史栈重置——用户不该能撤销到「上次开页面之前」 */
function hydrate(state: AppState, snapshot: DataSnapshot): AppState {
  return {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    doctors: snapshot.doctors,
    rules: rules.enforceRulesInvariants(snapshot.rules),
    schedules: snapshot.schedules,
    customShifts: snapshot.customShifts,
    history: emptyHistory(),
  };
}
