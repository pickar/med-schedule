# 医键排班 · 班次自定义 · 增量架构设计

> 目标功能：**班次自定义**（让使用者自行定义班次类型：名称 / 颜色 / 可选起止时间，支持新增·编辑·删除，并集成进排班与轮班选用流程）
> 基线：`main` @ `392055c`（v1.2.0）｜技术栈：React 19 + Vite 8 + TS(strict) + localStorage（纯前端）
> 工作分支：`feat/shift-custom`（本阶段仅设计，不写实现代码；工程落地时 `git checkout -b feat/shift-custom`）

---

## 0. 设计原则（硬约束）

| 原则 | 落地方式 |
|------|----------|
| **最小变更** | 保留 11 种内置班次（`SHIFT_METAS` / `SHIFT_ORDER` / `ShiftType`）**完全不动**；仅新增 `ShiftDefinition` 描述自定义班次，并把"引用点"改为可识别自定义 id 的统一解析器。 |
| **向后兼容** | 旧排班数据引用的仍是内置 `ShiftType`，渲染/统计零变化；自定义班次存于新字段 `customShifts`，旧数据缺该字段时归一化为 `[]`。 |
| **数据迁移** | `SCHEMA_VERSION` 1 → 2，新增一条 `MIGRATIONS[1]` 仅补 `customShifts: []`，无任何字段破坏。 |
| **桌面 + 移动端** | 所有改动点均覆盖桌面（表格 / ShiftPicker / 图例）与移动端（DayShiftSheet / MobileShiftSheet / CalendarView / DoctorScheduleView）。 |
| **类型优先 / 中文注释** | 新增类型集中在 `domain.ts`，解析器集中在 `constants/shifts.ts`，沿用现有命名与注释风格。 |
| **不破坏性能契约** | `ShiftCell` 等叶子仍**只收 props、不订阅 Context**；`customShifts` 引用仅在用户编辑班次时变化，正常排班时保持引用稳定，`React.memo` 依旧生效。 |

---

## 1. 增量设计说明

### 1.1 数据结构变更

#### 1.1.1 新增类型（放 `src/types/domain.ts`）

```ts
/** 自定义班次定义。与内置 ShiftMeta 同构，额外带 id / 是否内置 / 可选起止时间。 */
export interface ShiftDefinition {
  id: string;            // 唯一 id；内置复用 ShiftType 字面量，自定义用 createPrefixedId('shift')
  label: string;        // 名称（如「门诊加强」），1~8 字
  short: string;        // 表格简写（1~3 字）
  bg: string;           // 背景色 #RRGGBB
  fg: string;           // 文字色 #RRGGBB（建议与 bg 满足 WCAG AA）
  isWork: boolean;      // 是否计为工作班次（false = 休息类）
  autoAssignable: boolean; // 算法是否可主动分配（自定义默认 false）
  isBuiltin: boolean;   // true=内置不可删；false=自定义
  startTime?: string;   // 可选起止时间 'HH:mm'
  endTime?: string;     // 可选起止时间 'HH:mm'
}

/** 排班/轮班中引用的班次 id：内置 ShiftType 或自定义 ShiftDefinition.id。
 *  注：ShiftType 是 ShiftId 的子集，因此 ShiftId 在运行期即 string。 */
export type ShiftId = string;
```

> ⚠️ **`ShiftMeta.key` 处理**：内置 `ShiftMeta.key` 当前为 `ShiftType`。解析器 `resolveShiftMeta` 对自定义班次返回 `key = def.id`（即 `string`）。为兼容，将 `ShiftMeta.key` 类型由 `ShiftType` 放宽到 `string`（`SHIFT_METAS: Record<ShiftType, ShiftMeta>` 记录键仍是 `ShiftType`，不受影响）。其余 `SHIFT_METAS[key]` 取数逻辑全部不变。

#### 1.1.2 状态 / 快照（放 `src/types/state.ts`）

```ts
// DataSnapshot 增加 customShifts（参与撤销栈 + 持久化）
export interface DataSnapshot {
  doctors: Doctor[];
  rules: Rules;
  schedules: SchedulesByMonth;
  customShifts: ShiftDefinition[];   // 新增
}

// AppState 同步增加
export interface AppState {
  schemaVersion: number;
  doctors: Doctor[];
  rules: Rules;
  schedules: SchedulesByMonth;
  customShifts: ShiftDefinition[];   // 新增
  ui: UIState;
  history: HistoryState;
}

// ActiveDrawer 增加 'shiftManager'（与 rules/doctor/leave 互斥）
export type ActiveDrawer = 'none' | 'rules' | 'doctor' | 'leave' | 'shiftManager';

// Action 增加数据类（走现有 applyData → 历史 + 不变量出口）
export type Action =
  // …原有…
  | { type: 'shiftDef/add'; payload: ShiftDefinition }
  | { type: 'shiftDef/update'; payload: ShiftDefinition }
  | { type: 'shiftDef/remove'; payload: { id: string; clearUsages: boolean } };
```

#### 1.1.3 持久化（新增独立 storage key，沿用 doctors/rules 分存模式）

```ts
// constants/defaults.ts
export const SCHEMA_VERSION = 2;
// STORAGE_KEYS 增加：
shifts: `${STORAGE_NAMESPACE}:shifts`,
```

`customShifts` 单独存于 `warmshift:v1:shifts`（与 doctors/rules 同构），由 `storage.ts` 的 `saveAll` / `loadAllDetailed` 读写，`clearAll` 一并清理。

#### 1.1.4 引用类型放宽（影响面）

| 现有类型 | 变更 |
|----------|------|
| `ScheduleEntry.shiftType: ShiftType` | → `ShiftId`（=string） |
| `ShiftCycleDraft.sequence: ShiftType[]` | → `ShiftId[]` |
| `core/shiftCycle` 中 `ShiftSequence` / `DayOutcome.shiftType` | → `ShiftId` |
| `core/stats/daily.ts` `DailyStat.counts` | **保持不变**（`Record<ShiftType, number>`，11 key）；自定义班次不单列统计行，仅计入 `workTotal`/`restTotal` |
| `core/stats/doctor.ts` `DoctorStat.counts` | **保持不变**（同上） |

---

### 1.2 统一解析器（核心新增，放 `src/constants/shifts.ts`）

所有"按 id 取班次展示信息"的地方，从 `SHIFT_METAS[id]` 改为统一解析器，**一次定义、处处复用**，避免散落判断：

```ts
/** 按 id 解析班次元数据：内置→SHIFT_METAS；自定义→customShifts 中按 id 查找；未知→降级为 rest（UI 不崩） */
export function resolveShiftMeta(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): ShiftMeta;

/** 全部可选班次（用于选择器 / 图例 / 轮班序列编辑器）：内置 SHIFT_ORDER 在前，自定义在后 */
export function allShiftMetas(custom: readonly ShiftDefinition[]): ShiftMeta[];

/** custom-aware 的 isWork / isRest（替换校验器与统计里直接用的 isWorkShift） */
export function isWorkShiftId(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): boolean;
export function isRestShiftId(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): boolean;

/** custom-aware 简写（替换 getShiftShort，用于 PNG/CSV） */
export function shiftShort(id: ShiftId | null | undefined, custom: readonly ShiftDefinition[]): string;

/** 单元格配色样式：内置走 CSS 变量（--shift-${key}-bg），自定义走字面色（meta.bg/fg）。
 *  返回 { '--cell-bg': string; '--cell-fg': string }，供 ShiftCell/图例/Picker/移动端复用。 */
export function shiftCellStyle(meta: ShiftMeta): CSSProperties;
```

#### 1.3 颜色渲染策略（关键决策，避免改 tokens.css）

- **内置班次**：颜色来自 `tokens.css` 的 `--shift-${key}-bg/fg`（数据语义色，改动需同步 PNG 手抄副本）。渲染传 `var(--shift-clinic-bg)`。
- **自定义班次**：`ShiftDefinition` 自带 `bg`/`fg` 字面色，`shiftCellStyle` 直接下发 `meta.bg` / `meta.fg`（不依赖新 CSS 变量，因此**无需改 `tokens.css`**，也不会破坏 PNG 导出对照）。
- 全链路统一调 `shiftCellStyle(resolveShiftMeta(...))` 即可，渲染层不再关心内置/自定义差异。

---

### 1.4 与现有逻辑的最小集成点（按层）

| 层 | 现有代码 | 最小改动 |
|----|----------|----------|
| **内置数据** | `constants/shifts.ts` (`SHIFT_METAS`/`SHIFT_ORDER`) | 不变；仅**追加**解析器函数（§1.2） |
| **单元格渲染** | `ShiftCell.tsx`（叶子，memo） | `entry.shiftType` 经 `resolveShiftMeta(entry.shiftType, customShifts)`；`customShifts` 作为**新 prop** 由 `DoctorRow→ScheduleTable→MainArea` 透传（引用稳定） |
| **桌面选择器** | `ShiftPicker.tsx` | `SHIFT_ORDER.map` → `allShiftMetas(customShifts).map`；收 `customShifts` prop；`onSelect(shiftId)` |
| **图例** | `ShiftLegend.tsx` | `SHIFT_ORDER.map` → `allShiftMetas(customShifts).map`；收 `customShifts` prop |
| **移动端日历** | `CalendarView.tsx`（容器，已订阅 state） | 直接用 `resolveShiftMeta` / `shiftCellStyle`，读 `state.customShifts` |
| **移动端医生视角** | `DoctorScheduleView.tsx`（容器） | 同上；`isWork` 判定改 `isWorkShiftId` |
| **移动端日面板** | `DayShiftSheet.tsx` / `MobileShiftSheet.tsx` | 迭代源改 `allShiftMetas(customShifts)`；收 `customShifts` prop |
| **轮班序列编辑** | `SequenceEditor.tsx` | 追加候选项来自 `allShiftMetas`，`sequence: ShiftId[]`；收 `customShifts` prop |
| **轮班预览** | `CyclePreview.tsx` | `SHIFT_METAS[outcome.shiftType]` → `resolveShiftMeta(outcome.shiftType, customShifts)`；收 `customShifts` prop |
| **每日统计** | `core/stats/daily.ts` | `computeDailyStats` 收 `customShifts`；`workTotal`/`restTotal` 按 `isWorkShiftId` 计；`counts` 仍 11 key（自定义不单列） |
| **医生统计** | `core/stats/doctor.ts` | `computeDoctorStats` 收 `customShifts`；`actualRest` 计入 `isRestShiftId` 为真的自定义班次（使"自定义休息"可抵休息天数） |
| **派生入口** | `core/stats/index.ts` | `computeDerived` 收 `customShifts` 并下传；**`sanitizeSchedule` 放宽 `isShiftType` 判定为 `typeof id === 'string'`**（否则自定义班次会被清洗丢弃！） |
| **校验器** | `core/validator/rules.ts` | `isWorkShift`→`isWorkShiftId`（收 `customShifts`），使"自定义工作班次"同样触发 weekendOff / 请假冲突校验 |
| **生成器** | `core/generator/*` | **不改**。自定义班次 `autoAssignable` 默认 `false`，算法永不主动分配（见 §4 约定） |
| **CSV 导出** | `lib/csvExport.ts` | `getShiftShort`→`shiftShort(id, customShifts)`，`buildScheduleCsv` 收 `customShifts`；统计行仍 11 种 |
| **PNG 导出** | `lib/pngExport/canvasTable.ts` | `PngTableParams` 收 `customShifts`；`drawDoctorRow`/`drawLegend` 用 `resolveShiftMeta`/`shiftShort`；图例覆盖 `allShiftMetas(customShifts)` |
| **存储/归一化** | `lib/storage.ts` / `storageSchema.ts` / `dataShape.ts` | 读写 `shifts` key；`normalizeMonthSchedule` 放宽 `isShiftType`→`typeof id==='string'`；新增 `normalizeCustomShifts` |
| **状态/历史** | `reducer.ts` / `history.ts` / `AppProvider.tsx` | `customShifts` 进 `AppState`/`DataSnapshot`/`snapshotOf`/`isSameSnapshot`；hydrate 写入；新增 `shiftDef/*` 三类 Action + `handlers/shiftHandlers.ts` |
| **入口** | `MoreMenu.tsx` / `TopBar.tsx` / `App.tsx` | `ActiveDrawer:'shiftManager'` + 新增 `ShiftManagerDrawer`；MoreMenu 与桌面顶栏均加"班次管理"入口 |

---

### 1.5 删除自定义班次的级联处理（与 §5 待确认联动）

- 删除**未被引用**的自定义班次：直接移除定义。
- 删除**被引用**的班次（待确认 #2 默认方案）：`ShiftManagerDrawer` 先扫描 `schedules` 统计引用数，弹 `ConfirmDialog` 展示数量；确认后 `dispatch({type:'shiftDef/remove', payload:{id, clearUsages:true}})`，reducer 把引用该 id 的 `ScheduleEntry.shiftType` 置为 `null`（级联置空），定义移除。这样表格不会出现"幽灵班次"，且撤销栈可整体回退。

---

## 2. 文件清单

### 2.1 新增文件

| 相对路径 | 说明 |
|----------|------|
| `src/components/ShiftManager/ShiftManagerDrawer.tsx` | 班次管理抽屉容器（复用 `Drawer`/`DrawerSection`），列出内置（只读）+ 自定义（编辑/删除）+ 新增入口；扫描引用数用于删除确认 |
| `src/components/ShiftManager/ShiftDefinitionForm.tsx` | 单个班次定义的增/编表单（纯组件）：名称、简写、颜色（调色板 `SHIFT_PALETTE` + 原生 color 输入）、是否工作、可选起止时间、是否可自动分配 |
| `src/state/handlers/shiftHandlers.ts` | `addCustomShift` / `updateCustomShift` / `removeCustomShift(state, id, clearUsages)` 三个不可变更新函数 |
| `src/constants/palette-shifts.ts`（或并入 `palette.ts`） | 班次可选色板 `SHIFT_PALETTE: readonly string[]`（12 色，与班次浅底深字风格一致） |

### 2.2 修改文件（含改动点）

| 相对路径 | 改动点 |
|----------|--------|
| `src/types/domain.ts` | 新增 `ShiftDefinition` / `ShiftId`；`ScheduleEntry.shiftType: ShiftId` |
| `src/types/state.ts` | `DataSnapshot`/`AppState` 增 `customShifts`；`ActiveDrawer` 增 `'shiftManager'`；`Action` 增 `shiftDef/*` 三项 |
| `src/constants/shifts.ts` | `ShiftMeta.key` 放宽 `string`；**追加** §1.2 解析器函数；新增 `SHIFT_PALETTE`（若不放独立文件） |
| `src/constants/defaults.ts` | `SCHEMA_VERSION` 1→2；`STORAGE_KEYS.shifts`；`MIGRATIONS` 注释补 v2 约定 |
| `src/lib/storageSchema.ts` | `RawBundle` 增 `customShifts`；新增 `normalizeCustomShifts`；`normalizeMonthSchedule` 放宽 `isShiftType`→`string`；`MIGRATIONS` 实现 `1: raw => ({...raw, customShifts: []})` |
| `src/lib/dataShape.ts` | 新增 `ensureCustomShiftsShape`（或并入 normalize）；保证 `customShifts` 形状可信 |
| `src/lib/storage.ts` | `saveAll`/`loadAllDetailed` 读写 `shifts` key；`clearAll` 清理；`RawBundle` 对齐 |
| `src/state/reducer.ts` | `mutate` 增加 `shiftDef/*` 三分支；`createInitialState` 含 `customShifts:[]`；`hydrate` 写入 |
| `src/state/history.ts` | `snapshotOf` / `isSameSnapshot` 纳入 `customShifts` |
| `src/state/AppProvider.tsx` | `app/hydrate` 写入 `customShifts`；`computeDerived` 入参加 `customShifts` |
| `src/core/stats/daily.ts` | `computeDailyStats(params)` 增 `customShifts`；`workTotal`/`restTotal` 按 `isWorkShiftId` |
| `src/core/stats/doctor.ts` | `computeDoctorStats(params)` 增 `customShifts`；`actualRest` 计入自定义休息班次 |
| `src/core/stats/index.ts` | `DerivedParams` 增 `customShifts`；下传；`sanitizeSchedule` 放宽判定 |
| `src/core/validator/rules.ts` | `isWorkShift`→`isWorkShiftId`（收 `customShifts`） |
| `src/lib/csvExport.ts` | `buildScheduleCsv` 收 `customShifts`；`getShiftShort`→`shiftShort` |
| `src/lib/pngExport/canvasTable.ts` | `PngTableParams` 收 `customShifts`；绘制处用 `resolveShiftMeta`/`shiftShort`/`allShiftMetas` |
| `src/components/ScheduleTable/ShiftCell.tsx` | 收 `customShifts` prop；`resolveShiftMeta` + `shiftCellStyle` |
| `src/components/ScheduleTable/DoctorRow.tsx` | 透传 `customShifts` 给 `ShiftCell` |
| `src/components/ScheduleTable/ScheduleTable.tsx` | 收 `customShifts` 透传 `DoctorRow` |
| `src/components/ScheduleTable/ShiftPicker.tsx` | 迭代 `allShiftMetas(customShifts)`；收 `customShifts`；`onSelect(ShiftId)` |
| `src/components/ScheduleTable/ShiftLegend.tsx` | 迭代 `allShiftMetas(customShifts)`；收 `customShifts` |
| `src/components/ScheduleTable/DayShiftSheet.tsx` | 迭代 `allShiftMetas(customShifts)`；收 `customShifts` |
| `src/components/ScheduleTable/MobileShiftSheet.tsx` | 迭代 `allShiftMetas(customShifts)`；收 `customShifts` |
| `src/components/ScheduleTable/CalendarView.tsx` | 直接用 `resolveShiftMeta`/`shiftCellStyle`（已订阅 state） |
| `src/components/ScheduleTable/DoctorScheduleView.tsx` | 同上；`isWork` 判定改 `isWorkShiftId` |
| `src/components/ShiftCycle/SequenceEditor.tsx` | 候选项 `allShiftMetas(customShifts)`；`sequence: ShiftId[]`；收 `customShifts` |
| `src/components/ShiftCycle/CyclePreview.tsx` | `resolveShiftMeta(outcome.shiftType, customShifts)`；收 `customShifts` |
| `src/components/layout/MainArea.tsx` | 读 `state.customShifts` 透传 `ScheduleTable` |
| `src/components/layout/TopBar.tsx` | 加"班次管理"按钮 + `handleOpenShiftManager` |
| `src/components/TopBar/MoreMenu.tsx` | 加"班次管理"菜单项 + `onOpenShiftManager` prop |
| `src/App.tsx` | 挂载 `<ShiftManagerDrawer />` |

---

## 3. 任务列表（有序依赖，按实现顺序）

> 规则适配：本功能在已存在项目上增量开发，无新建工程脚手架/依赖，故 T01 以"数据模型+存储+解析层（基础）”作为地基任务；共 5 个任务，每个 ≥3 个文件，按层分组、尽量仅依赖 T01/T02。

### T01 · 数据模型 + 存储 + 统一解析器（地基）
- **优先级**：P0　**依赖**：无
- **文件**：`src/types/domain.ts`、`src/types/state.ts`、`src/constants/shifts.ts`、`src/constants/defaults.ts`、`src/lib/storageSchema.ts`、`src/lib/dataShape.ts`、`src/lib/storage.ts`
- **做什么**：
  1. 新增 `ShiftDefinition` / `ShiftId`；`ScheduleEntry.shiftType: ShiftId`；`ShiftMeta.key: string`。
  2. `DataSnapshot`/`AppState` 增 `customShifts`；`ActiveDrawer` 增 `'shiftManager'`；`Action` 增 `shiftDef/*`。
  3. `constants/shifts.ts` 追加 §1.2 全部解析器函数；新增 `SHIFT_PALETTE`。
  4. `SCHEMA_VERSION=2`；`STORAGE_KEYS.shifts`；`MIGRATIONS[1]` 补 `customShifts:[]`。
  5. `storageSchema`/`dataShape`/`storage` 读写 `customShifts`；`normalizeMonthSchedule` 与 `sanitizeSchedule` 放宽 `isShiftType`→`typeof id==='string'`。

### T02 · 状态管理与历史
- **优先级**：P0　**依赖**：T01
- **文件**：`src/state/reducer.ts`、`src/state/history.ts`、`src/state/AppProvider.tsx`、`src/state/handlers/shiftHandlers.ts`（新）
- **做什么**：
  1. `reducer`：`createInitialState`/`hydrate` 含 `customShifts`；`mutate` 增 `shiftDef/add|update|remove` 分支（走现有 `applyData` 历史出口）。
  2. `shiftHandlers`：`addCustomShift` / `updateCustomShift` / `removeCustomShift(state, id, clearUsages)`（级联置空引用格）。
  3. `history.snapshotOf`/`isSameSnapshot` 纳入 `customShifts`。
  4. `AppProvider`：`app/hydrate` 写入；`computeDerived` 入参加 `customShifts`。

### T03 · 班次解析与渲染层（桌面 + 移动端）
- **优先级**：P0　**依赖**：T01、T02
- **文件**：`src/components/ScheduleTable/ShiftCell.tsx`、`DoctorRow.tsx`、`ScheduleTable.tsx`、`ShiftPicker.tsx`、`ShiftLegend.tsx`、`DayShiftSheet.tsx`、`MobileShiftSheet.tsx`、`CalendarView.tsx`、`DoctorScheduleView.tsx`、`src/components/layout/MainArea.tsx`
- **做什么**：
  1. `ShiftCell` 收 `customShifts` prop → `resolveShiftMeta` + `shiftCellStyle`（叶子仍只收 props）。
  2. `DoctorRow`/`ScheduleTable`/`MainArea` 透传 `state.customShifts`。
  3. `ShiftPicker`/`ShiftLegend`/`DayShiftSheet`/`MobileShiftSheet` 迭代 `allShiftMetas(customShifts)`，收 `customShifts` prop，`onSelect(ShiftId)`。
  4. `CalendarView`/`DoctorScheduleView` 直接用 `resolveShiftMeta` / `shiftCellStyle` / `isWorkShiftId`（容器已订阅 state）。

### T04 · 统计 / 校验 / 导出 custom-aware
- **优先级**：P1　**依赖**：T01、T02（复用解析器）
- **文件**：`src/core/stats/daily.ts`、`doctor.ts`、`index.ts`、`src/core/validator/rules.ts`、`src/lib/csvExport.ts`、`src/lib/pngExport/canvasTable.ts`
- **做什么**：
  1. `daily.ts`/`doctor.ts`/`index.ts` 透传 `customShifts`；`workTotal`/`restTotal`/`actualRest` 按 `isWorkShiftId`/`isRestShiftId`；`sanitizeSchedule` 放宽判定。
  2. `validator/rules.ts` 的 `isWorkShift`→`isWorkShiftId`（收 `customShifts`）。
  3. `csvExport` / `canvasTable` 用 `shiftShort` / `resolveShiftMeta` / `allShiftMetas`，参数加 `customShifts`。

### T05 · 班次管理入口与抽屉 UI
- **优先级**：P0　**依赖**：T01、T02
- **文件**：`src/components/ShiftManager/ShiftManagerDrawer.tsx`（新）、`ShiftDefinitionForm.tsx`（新）、`src/components/TopBar/MoreMenu.tsx`、`src/components/layout/TopBar.tsx`、`src/App.tsx`
- **做什么**：
  1. `ShiftManagerDrawer`：列出内置（只读）+ 自定义（编辑/删除）；扫描引用数；删除确认（`ConfirmDialog`）。
  2. `ShiftDefinitionForm`：名称/简写/颜色（调色板+原生color）/是否工作/可选起止时间/是否可自动分配。
  3. `MoreMenu` + 桌面顶栏加"班次管理"入口；`ActiveDrawer:'shiftManager'` 驱动；`App` 挂载抽屉。

---

## 4. 依赖与共享约定（跨文件必须遵守）

| 约定 | 说明 |
|------|------|
| **id 命名空间** | 内置 id = 11 个 `ShiftType` 字面量；自定义 id = `createPrefixedId('shift')`（`shift-<uuid>`）。判定自定义：`!isShiftType(id)`。**两者永不冲突**。 |
| **存储位置** | 自定义班次**只**存于 `customShifts: ShiftDefinition[]`（独立 storage key `warmshift:v1:shifts`）；**绝不在** `SHIFT_METAS` 里注册。内置班次永远来自 `SHIFT_METAS`。 |
| **`isBuiltin` 字段** | 内置班次不在 `customShifts` 中；`customShifts` 中条目 `isBuiltin` 恒为 `false`，不可删、不可编辑。 |
| **颜色字段格式** | 一律 `#RRGGBB`（6 位 hex）。内置色走 `tokens.css` 变量；自定义色存 `bg`/`fg` 字面色，渲染经 `shiftCellStyle`。调色板 `SHIFT_PALETTE` 提供 12 个候选；允许原生 color 输入自定义。 |
| **统一解析** | 任何"按 id 取展示信息"处**必须**走 `resolveShiftMeta`/`allShiftMetas`/`shiftShort`/`isWorkShiftId`/`isRestShiftId`，禁止再直接 `SHIFT_METAS[id]`（自定义会 undefined）。 |
| **自动分配** | 自定义班次 `autoAssignable` 默认 `false`；生成器（`core/generator/*`）维持只认 `isAutoAssignable(ShiftType)`，不碰自定义班次。 |
| **未知 id 降级** | `resolveShiftMeta` 对未知 id 返回 `rest` 元数据（UI 不崩），与现有 `getShiftMeta` 行为一致。 |
| **边界（待确认 #3/#5 默认值）** | 名称 1~8 字、简写 1~3 字；自定义班次数量上限 **30**；起止时间 `'HH:mm'`，`startTime<endTime` 才生效；颜色需与背景满足对比（建议 AA，不强校验）。 |
| **统计口径** | 自定义班次计入 `workTotal`/`restTotal`、可抵 `actualRest`（当 `isWork=false`）；**不**进入 11-key `counts`、不进 `DayStat`/`DoctorStat` 单列统计行、不进公平度 `burden`（v1 范围，见待确认 #1）。 |

---

## 5. 待确认问题（附推荐默认方案，工程师可先按推荐实现）

> 目标：先按推荐默认实现、本地预览，用户预览时再调整，不阻塞开发。

### Q1 · 自定义班次是否默认带起止时间？是否影响工时/统计？
- **现状**：v1 设计为**可选** `startTime`/`endTime`（默认空，不强制）。统计层 v1 **仅**把自定义班次计入 `workTotal`/`restTotal` 与 `actualRest`（按 `isWork`），**不**单独列统计行、不进公平度 `burden`、不进 `DayStat.counts`。
- **推荐默认**：起止时间**可选、默认不带**；统计影响限于 work/rest 合计（推荐上条口径）。理由：避免触碰稳定的 11-key 统计模型与公平度算法，降低回归风险。
- **备选**：若产品要求自定义班次也参与公平度，则需把 `counts` 改为 `Record<ShiftId, number>`，波及面大，建议作为后续迭代。

### Q2 · 删除"正在被排班使用"的自定义班次如何处理？
- **推荐默认**：**提示 + 级联置空**——`ShiftManagerDrawer` 先统计引用格数，弹 `ConfirmDialog` 展示数量；确认后 `shiftDef/remove{clearUsages:true}` 把引用该 id 的 `ScheduleEntry.shiftType` 置 `null`（清空为无班次）。理由：表格不会出现幽灵班次，且可整体撤销。
- **备选 A**：禁止删除（引用数>0 时按钮禁用 + 提示）。最安全但不够灵活。
- **备选 B**：级联转为 `rest`（保留格子但显示休息）。语义上"把某天变成休息"可能不是用户本意，故不推荐。

### Q3 · "休息 / 休"是否作为不可删的内置班次保留？
- **推荐默认**：**是**。`rest` 与 `postNightRest`（`isBuiltin:true`）不可删、不可编辑，常驻内置。用户可另建自定义休息班次（`isWork:false`）。理由：内置休息是规则/统计/生成器的锚点，删除会破坏既有逻辑。

### Q4 · 自定义班次是否可参与"自动生成"？
- **推荐默认**：**否**（`autoAssignable` 默认 `false`）。生成器维持只分配内置班次。理由：自定义班次语义由用户自定义，纳入算法分配易产生不可预期排班，且 `eligibility`/`workload` 计分未覆盖自定义班次。
- **备选**：允许在 `ShiftDefinitionForm` 勾选"允许算法自动分配"，但 v1 默认关，且勾选后也仅作为手动补充、不进入公平度计分。

### Q5 · 边界与上限（名称长度 / 数量 / 重名）
- **推荐默认**：名称 ≤8 字、简写 ≤3 字；自定义班次总数上限 **30**；**允许重名但 id 唯一**（id 由 `createPrefixedId` 保证）；颜色对比不强校验（仅给预览）。理由：轻量、不挡路。

### Q6 · 入口放在哪？
- **推荐默认**：`MoreMenu`（移动端动作枢纽）**与** 桌面顶栏（在"轮班""规则"旁）均加"班次管理"；用 `ActiveDrawer:'shiftManager'` + 复用 `Drawer`。移动端底部 Tab 栏**保持 3 个**（roster/schedule/insight），不新增 Tab 以免改变布局语义。
- **备选**：放入 `RulesDrawer` 内作为一个分区——但班次管理是独立心智模型，独立抽屉更清晰，故推荐独立抽屉。

---

## 6. 风险与回归点

| 风险 | 缓解 |
|------|------|
| `sanitizeSchedule` / `normalizeMonthSchedule` 的 `isShiftType` 拦大会**静默丢弃**自定义班次 | T01 必须放宽判定为 `typeof id==='string'`（已列入任务） |
| `ShiftCell` 等叶子误订阅 `customShifts` 触发 900+ 重渲染 | 仅以 prop 透传，引用稳定；不引入 Context |
| 自定义色与背景对比不足（无障碍） | v1 不强校验，仅预览；后续可加对比提示 |
| 删除自定义班后遗留脏引用 | 级联置空（Q2 默认），`resolveShiftMeta` 对未知 id 降级 rest 兜底 |
| PNG 导出图例/单元格颜色与屏幕不一致 | `canvasTable` 改用 `resolveShiftMeta`/`shiftShort`/`allShiftMetas`，不再手抄 `SHIFT_METAS` 取色 |
| 旧数据缺 `customShifts` 字段 | `MIGRATIONS[1]` 补 `[]` + `normalizeCustomShifts` 兜底，行为等同 v1 |

---

## 附录 A · 类图（Mermaid，见 `class-diagram.mermaid`）
## 附录 B · 关键时序（Mermaid，见 `sequence-diagram.mermaid`）
- B1 新增自定义班次并落盘
- B2 选择器选自定义班次写入单元格
- B3 删除被引用的自定义班次（级联置空）
- B4 旧数据水合与迁移（v1→v2）
