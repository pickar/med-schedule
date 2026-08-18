/**
 * 应用状态与 Action 联合类型。
 *
 * 约定：Action type 采用 `domain/verb` 串式命名，reducer 每个 case 必须 return
 * （`noFallthroughCasesInSwitch` 已开启）。
 */

import type {
  Diagnostic,
  Doctor,
  LeaveRange,
  RotationRule,
  Rules,
  ScheduleEntry,
  SchedulesByMonth,
  ShiftType,
} from './domain';

/** 自动保存状态机 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** 抽屉互斥，同一时刻至多打开一个 */
export type ActiveDrawer = 'none' | 'rules' | 'doctor' | 'leave';

/** 定位高亮的单元格坐标 */
export interface CellRef {
  date: string;
  doctorId: string;
}

/** 移动端底部 Tab 的三个页签，与 BottomTabBar 的 tablist 一一对应 */
export type MobileTab = 'roster' | 'schedule' | 'insight';

export interface UIState {
  /** 'YYYY-MM' */
  currentMonth: string;
  doctorPanelCollapsed: boolean;
  insightPanelCollapsed: boolean;
  /**
   * 移动端（≤768px）底部 Tab 当前选中项，默认 'schedule'——
   * 用户打开应用最想先看到的是排班表本身，不是名册也不是洞察。
   *
   * 与 `doctorPanelCollapsed` / `insightPanelCollapsed` 是**两套正交机制**：
   * 折叠态描述桌面端三栏同屏时某栏是否收成竖条，Tab 描述小屏上三块内容谁在前台。
   * 桌面端此字段不影响任何渲染。
   *
   * 刻意不进 `DataSnapshot`（不入撤销栈）也不落 localStorage：
   * 它描述的是「此刻在小屏上看哪一块」，撤销它或跨会话恢复它都没有意义。
   */
  mobileTab: MobileTab;
  activeDrawer: ActiveDrawer;
  /** null 表示新增医生 */
  editingDoctorId: string | null;
  doctorSearch: string;
  /** 洞察面板「定位」后高亮的医生行 */
  highlightDoctorId: string | null;
  /** 洞察面板「定位」后高亮的单元格 */
  highlightCell: CellRef | null;
  statsExpanded: boolean;
  legendExpanded: boolean;
  /** 轮班弹窗是否打开（P2-1 按医生循环班次序列） */
  shiftCycleOpen: boolean;
  /** 轮班弹窗预选医生 id，来自医生抽屉「设轮班」；null 表示未预选 */
  shiftCycleDoctorId: string | null;
  generating: boolean;
  /**
   * 最近一次生成产出的诊断，供洞察面板「生成说明」解释「为什么这样排」。
   *
   * 放在 UIState 而不是数据层，是因为它**不该进撤销栈**：
   * 撤销掉一次生成，说明也就跟着失去意义；跟着快照来回复活反而会误导。
   * 同理它也不进 localStorage —— 下次开页面时上一次的取舍说明已经过期。
   */
  lastDiagnostics: Diagnostic[];
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  storageError: string | null;
}

/** 参与撤销/重做的数据快照（不含 UI 状态） */
export interface DataSnapshot {
  doctors: Doctor[];
  rules: Rules;
  schedules: SchedulesByMonth;
}

export interface HistoryEntry {
  snapshot: DataSnapshot;
  /** 操作描述，如「修改 张伟 8/12 班次」，用于按钮 tooltip */
  label: string;
}

export interface HistoryState {
  /** 最大 30 条，超出丢弃最旧的 */
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface AppState {
  schemaVersion: number;
  doctors: Doctor[];
  rules: Rules;
  schedules: SchedulesByMonth;
  ui: UIState;
  history: HistoryState;
}

// ============ Action ============

export type Action =
  // --- 医生 ---
  | { type: 'doctor/add'; payload: Omit<Doctor, 'id' | 'color'> & { color?: string } }
  | { type: 'doctor/update'; payload: Doctor }
  | { type: 'doctor/remove'; payload: { id: string } }
  | { type: 'doctor/loadSamples' }
  | { type: 'doctor/addLeave'; payload: { doctorId: string; leave: Omit<LeaveRange, 'id'> } }
  | { type: 'doctor/removeLeave'; payload: { doctorId: string; leaveId: string } }
  // --- 规则 ---
  | { type: 'rules/patch'; payload: Partial<Omit<Rules, 'rotationRules'>> }
  | {
      type: 'rules/setWeekdayShift';
      payload: {
        weekday: number;
        shift: 'dayShift' | 'nightShift';
        bound: 'min' | 'max';
        value: number;
      };
    }
  | { type: 'rules/addRotation'; payload: Omit<RotationRule, 'id'> }
  | { type: 'rules/updateRotation'; payload: RotationRule }
  | { type: 'rules/removeRotation'; payload: { id: string } }
  // --- 排班 ---
  | {
      type: 'schedule/setCell';
      payload: { date: string; doctorId: string; shiftType: ShiftType | null; manual?: boolean };
    }
  | { type: 'schedule/toggleLock'; payload: { date: string; doctorId: string } }
  | { type: 'schedule/unlockAll'; payload: { month: string } }
  | {
      type: 'schedule/applyGenerated';
      payload: { month: string; entries: Record<string, Record<string, ScheduleEntry>> };
    }
  | { type: 'schedule/clearMonth'; payload: { month: string } }
  | {
      type: 'schedule/applyShiftCycle';
      payload: {
        doctorId: string;
        sequence: ShiftType[];
        startDate: string;
        endDate: string;
        overwrite: boolean;
      };
    }
  // --- 历史 ---
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  // --- UI ---
  | { type: 'ui/patch'; payload: Partial<UIState> }
  | { type: 'ui/setMonth'; payload: { month: string } }
  | { type: 'ui/openDoctorDrawer'; payload: { doctorId: string | null } }
  | { type: 'ui/setMobileTab'; payload: { tab: MobileTab } }
  | { type: 'ui/locate'; payload: { date?: string; doctorId?: string } }
  // --- 全局 ---
  | { type: 'app/hydrate'; payload: DataSnapshot }
  | { type: 'app/clearAll' }
  | { type: 'app/saveStatus'; payload: { status: SaveStatus; at?: number; error?: string } };

/** 便于在组件中标注 dispatch 类型 */
export type AppDispatch = (action: Action) => void;
