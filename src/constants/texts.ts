/**
 * 全部 UI 文案集中管理。
 *
 * ⚠️ 标注「竞品原文」的条目必须逐字照录，改动即视为缺陷。
 * 原文出处：`_ref/competitor-analysis.md` 第二、三、四节。
 */

export const BRAND = {
  name: '医键排班',
  fullTitle: '医键排班 · 医生排班表工作台',
  slogan: '让排班变简单，早点下班',
} as const;

export const TEXTS = {
  // ===== 规则页（竞品原文）=====
  shiftCountHint: '左侧按钮调最小值，右侧按钮调最大值。系统会尽量安排到上限，人数不足时取下限。',
  postNightRestHint: '值夜班后第二天自动安排夜下休',
  noConsecutiveNightHint: '值夜班后第二天不安排夜班（夜下休当天自然不会排）',
  randomModeLabel: '随机分配一人（不显示轮流标记）',
  restDaysHint: '不含夜下休和周末固定休息',

  // ===== 医生约束（竞品原文）=====
  noDayShiftLabel: '不上白班（仅适合只上门诊/夜班的医生）',
  noNightShiftLabel: '不上夜班',
  weekendOffLabel: '周末不上班（若有固定门诊日则优先门诊）',

  // ===== 空状态（竞品原文）=====
  emptyTitle: '还没有排班表',
  emptySubtitle: '点击「生成排班」按钮，一键生成本月排班',
  /** 名册为空时的另一处空状态文案（竞品原文），比 emptySubtitle 多一层前置条件 */
  emptyNeedSetup: '请先添加医生并设置规则，然后点击「生成排班」',
  /** 三步引导卡片：标题带序号、描述为动作说明，逐字照录竞品 */
  step1Title: '1. 添加医生',
  step1Desc: '设置医生姓名、固定门诊日',
  step2Title: '2. 配置规则',
  step2Desc: '设置班次人数、休息天数',
  step3Title: '3. 一键生成',
  step3Desc: '点击生成排班，自动分配',

  // ===== 生成（竞品原文）=====
  regenerateConfirm: '确定要重新生成排班吗？当前手动调整将丢失。',
  regenerateConfirmLocked: (n: number): string => `已锁定 ${n} 格将被保留，其余将重新生成。`,
  noDoctorWarning: '请先添加至少 1 位医生',

  // ===== 校验（竞品原文）=====
  restShortageTitle: '以下医生休息天数不足',
  restAllOk: '全员休息天数达标 ✅',

  // ===== 导出（竞品原文）=====
  pngFailed: '导出图片失败，请重试',
  storageFailed: '数据未能保存到本地，请勿关闭页面',

  // ===== 改班（竞品原文）=====
  pickerTitle: (m: number, d: number): string => `选择班次 - ${m}月${d}日`,

  // ===== 以下为本产品新增文案（非竞品原文，可润色）=====

  // 顶栏
  generateButton: '生成排班',
  generating: '正在生成…',
  exportButton: '导出',
  exportCsv: '导出 CSV',
  exportPng: '导出图片',
  printSchedule: '打印排班表',
  rulesButton: '排班规则',
  undoButton: '撤销',
  redoButton: '重做',
  todayButton: '今天',
  prevMonth: '上个月',
  nextMonth: '下个月',

  // 保存状态
  saveIdle: '未保存',
  saveSaving: '保存中…',
  saveSaved: '已保存',
  saveError: '保存失败',
  saveRetry: '重试',
  /** 写入失败按 StorageError.code 分流的补充说明，主文案统一用 storageFailed */
  storageFailedPrivate: '浏览器处于隐私模式，本地存储不可用。请切换到普通窗口后重试。',
  storageFailedQuota: '本地存储空间已满。请清理浏览器数据或删除不再需要的月份后重试。',
  storageFailedUnknown: '写入本地存储时发生未知错误，请重试。',

  // 左栏 · 医生
  doctorPanelTitle: '医生名册',
  doctorSearchPlaceholder: '搜索医生姓名',
  doctorAdd: '新增医生',
  doctorEdit: '编辑医生',
  doctorEmpty: '还没有医生，先添加一位吧',
  doctorLoadSamples: '载入示例医生',
  doctorNameLabel: '姓名',
  doctorNamePlaceholder: '请输入医生姓名',
  doctorTitleLabel: '职称',
  doctorColorLabel: '标识颜色',
  fixedClinicDaysLabel: '固定门诊日',
  constraintsLabel: '个人约束',
  doctorDelete: '删除医生',
  doctorDeleteConfirm: (name: string): string =>
    `确定删除「${name}」吗？该医生在所有月份的排班将一并清除，此操作可撤销。`,
  doctorNameRequired: '请填写医生姓名',
  doctorNameDuplicated: '已存在同名医生，请确认是否重复添加',

  // 请假（P1-4）
  leaveDrawerTitle: '请假登记',
  leaveAdd: '添加请假',
  leaveEmpty: '暂无请假记录',
  leaveStartLabel: '开始日期',
  leaveEndLabel: '结束日期',
  leaveNoteLabel: '备注',
  leaveNotePlaceholder: '如：年假 / 学术会议 / 病假',
  leaveInvalidRange: '结束日期不能早于开始日期',
  leaveCountedAsRest: '请假日计入「实休」统计',

  // 规则抽屉
  rulesDrawerTitle: '排班规则',
  departmentNameLabel: '科室名称',
  departmentNamePlaceholder: '如：内分泌科',
  weekdayShiftTitle: '每日班次人数',
  restDaysLabel: '每人每月休息天数',
  autoRulesTitle: '自动规则',
  rotationTitle: '轮流门诊规则',
  rotationAdd: '添加轮流规则',
  rotationEmpty: '暂无轮流规则',
  rotationModeAll: '全员轮流（公平轮值）',
  rotationModeSelected: '指定医生轮流',
  rotationModeRandom: '随机分配一人',
  rotationWeekdayLabel: '星期',
  rotationDoctorsLabel: '参与医生',
  rulesSave: '保存规则',

  // 表格
  columnDoctor: '医生',
  columnShouldRest: '应休',
  columnActualRest: '实休',
  statsRowLabel: '每日统计',
  statsExpand: '展开全部班次',
  statsCollapse: '收起',
  /** 「每日统计」那一行的数值口径：工作班次人数合计（不含休息 / 夜下休） */
  statsWorkTotal: '在岗合计',
  statsStale: '统计中…',
  legendTitle: '班次图例',
  /** 竞品图例里的这句速记必须保留，用户就是靠它认表格里的单字 */
  legendDayNightNote: '日=白班　夜=夜班',
  cellLock: '锁定此格',
  cellUnlock: '解除锁定',
  cellLocked: '已锁定',
  cellClear: '清空',
  cellManualMark: '手动修改',
  cellRotationMark: '轮流',
  cellEmptyMark: '未排班',
  cellLeaveMark: '请假中',
  postNightRestSuggest: '次日建议设为夜下休',
  postNightRestApply: '一键应用',
  actualRestTooltip: (rest: number, postNight: number): string =>
    `实休 ${rest} 天，另有夜下休 ${postNight} 天（夜下休不计入实休）`,

  // 洞察面板
  insightTitle: '排班洞察',
  violationTitle: '待处理冲突',
  violationEmpty: '当前排班没有冲突 ✅',
  violationLocate: '定位',
  workloadTitle: '工作量均衡',
  workloadDimensionNight: '夜班',
  /**
   * 门诊维度只统计轮流门诊，标签必须把这层口径写在脸上。
   * 光写「门诊」会让用户拿它跟表格里的门诊总数对不上（T03 第 1 问确认）。
   */
  workloadDimensionClinic: '门诊（轮流）',
  workloadDimensionDay: '白班',
  workloadDimensionTotal: '总工作',
  /** 门诊维度 tooltip：把固定与轮流拆开，用户才知道差额去哪了 */
  workloadClinicTooltip: (fixed: number, rotation: number): string =>
    `固定门诊 ${fixed} 次 · 轮流门诊 ${rotation} 次`,
  /** 禁夜医生在工作量看板上打灰标，空条会被读成「排班漏了他」（T03 第 2 问确认） */
  nightExemptBadge: '夜班豁免',
  nightExemptHint: '该医生设置了「不上夜班」，不参与夜班公平度计算',
  fairnessLabel: '公平度',
  fairnessHint: '基于各班次分布的标准差计算，100 分表示完全均衡',
  /**
   * 诊断与冲突分层（T03 第 4 问确认）：
   * 「待处理」只列 violation；high 级 diagnostic 进这个只读区，解释「为什么这样排」。
   */
  generationNotesTitle: '生成说明',
  generationNotesEmpty: '本次生成没有需要说明的取舍',

  // 生成结果
  generateSuccess: (month: number, doctorCount: number): string =>
    `已生成 ${month} 月排班，${doctorCount} 位医生`,
  generateSuccessWithIssues: (month: number, doctorCount: number, issues: number): string =>
    `已生成 ${month} 月排班，${doctorCount} 位医生，${issues} 处需关注`,
  generateNoIssue: '已生成，无冲突',
  clearMonthConfirm: (month: number): string => `确定清空 ${month} 月的全部排班吗？此操作可撤销。`,

  // ===== T05 · 月份导航与导出 =====
  monthPickerTitle: '有排班数据的月份',
  monthPickerEmpty: '暂无已保存的月份',
  monthHasData: '本月已有排班数据',
  exportEmptyHint: '当前月份还没有排班表，请先生成排班',
  exportSuccess: (fileName: string): string => `已导出 ${fileName}`,
  exportPngWorking: '正在生成图片…',

  // ===== T05 · 医生卡片 =====
  doctorBadgeNoDay: '免白班',
  doctorBadgeNoNight: '免夜班',
  doctorBadgeWeekendOff: '周末休',
  doctorBadgeLeave: '有请假',
  doctorFixedClinicSummary: (days: string): string => `固定门诊 ${days}`,
  doctorNoFixedClinic: '无固定门诊',
  doctorFilterEmpty: '没有匹配的医生',
  doctorCountLabel: (n: number): string => `共 ${n} 位医生`,

  // ===== T05 · 请假 =====
  leaveDoctorLabel: '医生',
  leaveRemove: '删除请假',
  leaveDayCount: (n: number): string => `共 ${n} 天`,
  leaveNoDoctor: '请先添加医生，再登记请假',

  // ===== T05 · 规则抽屉 =====
  rulesAutoSavedHint: '规则改动即时生效并自动保存，可用顶栏「撤销」回退',
  rulesWeekdayColumn: '星期',
  rotationRemove: '删除规则',
  rotationNoDoctor: '请先添加医生，再配置轮流门诊',
  rotationSelectedEmpty: '尚未选择医生，该规则不会生效',

  // ===== T05 · 左栏底部入口 =====
  backupButton: '数据备份',
  backupExport: '导出备份文件',
  backupImport: '从备份恢复',
  backupRestoreConfirm: '确定用备份文件覆盖当前数据吗？',
  backupRestoreDetail: (doctorCount: number, monthCount: number): string =>
    `备份包含 ${doctorCount} 位医生、${monthCount} 个月排班。恢复后当前数据将被替换，此操作可撤销。`,
  backupRestoreSuccess: '已从备份恢复数据',
  backupRestoreFailed: '备份文件读取失败',
  clearAllButton: '清空数据',
  clearAllConfirm: '确定清空全部数据吗？',
  clearAllDetail: '医生名册、排班规则与所有月份的排班都会被删除，此操作可撤销。',

  // ===== T05 · 洞察面板 =====
  violationMore: (n: number): string => `另有 ${n} 条同类问题`,
  restGapLabel: (gap: number): string => `还差 ${gap} 天`,
  restProgressLabel: (actual: number, should: number): string => `${actual} / ${should} 天`,
  workloadHeaviest: '负担最重',
  workloadLightest: '负担最轻',
  workloadSpread: (spread: number): string => `极差 ${spread}`,
  workloadEmpty: '还没有医生，暂无工作量数据',

  // ===== T05a · 名册与规则抽屉补充文案 =====
  /** 搜索框右侧的清空按钮，纯图标必须有无障碍名 */
  searchClear: '清空搜索',
  /** 医生卡片整体是一个按钮，读屏需要念出「编辑 张伟」而不是光念姓名 */
  doctorEditAction: (name: string): string => `编辑 ${name}`,
  /** 12 色板每一格的无障碍名 */
  doctorColorOption: (index: number): string => `标识色 ${index}`,
  /**
   * 请假在抽屉里走草稿：不点保存就不落库。
   * 与姓名/约束的语义保持一致，避免出现「点了取消，请假却留下了」。
   */
  doctorLeaveDraftHint: '请假改动会在点击「保存」后与其他修改一起生效',
  /**
   * 「夜班后自动夜下休」是生成器的原子写入约束（夜班与次日夜下休同步落盘），
   * 没有开关位，UI 上如实呈现为锁定态而不是假装可配置。
   */
  autoPostNightRestLabel: '夜班后自动夜下休',
  autoPostNightRestLocked: '内置规则，始终生效',
  noConsecutiveNightLabel: '禁止连续夜班',
  /** 人数区间只对白班 / 夜班开放（PRD Q3），其余班次靠手动指派，得在界面上说清楚 */
  weekdayShiftScopeHint: '仅白班与夜班按人数区间自动排班，其余班次请在表格中手动指派',
  rotationModeLabel: '轮流方式',

  // ===== T05b · 生成与导出的失败分支 =====
  /** 生成器理论上不抛异常，但真抛了必须有话可说，不能让按钮卡在 loading 上 */
  generateFailed: '生成排班失败，请重试',
  /** 与 pngFailed（竞品原文）对齐的 CSV 版本，两条分开才知道是哪一路挂了 */
  csvFailed: '导出 CSV 失败，请重试',
  /** 统计还没跟上月份切换时禁止导出：导出一份对不上的表比不导出更糟 */
  exportStaleHint: '统计尚未更新完成，请稍候再导出',

  // 通用
  confirm: '确定',
  cancel: '取消',
  close: '关闭',
  save: '保存',
  delete: '删除',
  edit: '编辑',
  expand: '展开',
  collapse: '收起',
  loadFailed: '数据读取失败，已保留原始备份',

  // ===== 移动端底部 Tab =====
  mobileTabBarLabel: '主区域切换',
  mobileTabRoster: '名册',
  mobileTabSchedule: '排班',
  mobileTabInsight: '洞察',
  moreActions: '更多操作',

  // ===== 轮班（P2-1，按医生循环班次序列）=====
  shiftCycleButton: '轮班',
  shiftCycleTitle: '轮班设置',
  shiftCycleDoctorLabel: '医生',
  shiftCycleNoDoctorHint: '请先在名册中添加医生',
  shiftCycleSequenceLabel: '班次序列',
  shiftCycleSequenceHint: '点击添加班次，序列将按日历日循环排布',
  shiftCycleAddShift: '添加班次',
  shiftCycleStartDateLabel: '开始日期',
  shiftCycleEndDateLabel: '结束日期',
  shiftCycleOverwriteLabel: '覆盖已有班次',
  shiftCycleOverwriteHint: '关闭时跳过已有（非锁定）班次，开启则覆盖写入',
  shiftCycleEmptySequence: '请先添加至少一个班次',
  shiftCycleErrorNoDoctor: '请先选择医生',
  shiftCycleErrorEmptySequence: '班次序列为空',
  shiftCycleErrorInvalidDate: '日期格式不正确',
  shiftCycleErrorEndBeforeStart: '结束日期不能早于开始日期',
  shiftCycleErrorRangeTooLong: '日期范围过长，最多 366 天',
  shiftCyclePreviewEmpty: '选择医生、序列与日期后将显示预览',
  shiftCycleApplied: (name: string, start: string, end: string): string =>
    `已为 ${name} 设置轮班（${start}–${end}）`,
  shiftCycleSummaryTotal: (n: number): string => `共 ${n} 天`,
  shiftCycleSummaryEffective: (n: number): string => `写入 ${n} 天`,
  shiftCycleSummarySkipped: (n: number): string => `跳过 ${n} 天`,
  shiftCycleActionWrite: '写入',
  shiftCycleActionOverwrite: '覆盖',
  shiftCycleActionSkipLocked: '锁定',
  shiftCycleActionSkipLeave: '请假',
  shiftCycleActionSkipOccupied: '占用',
  shiftCycleMoveUp: '上移',
  shiftCycleMoveDown: '下移',
  shiftCycleRemove: '移除',
} as const;

/** 星期文案，索引 0-6 对应周日到周六（与 Date.getDay() 及 fixedClinicDays 一致） */
export const WEEKDAY_LABELS: readonly string[] = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
];

/** 取星期文案，越界时返回空串而不是 undefined */
export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? '';
}

// ============ 导出文件名规则 ============
//
// ⚠️ CSV 月份补零、PNG 月份不补零 —— 这是竞品的原始差异，照做，不要「修正」。

/** CSV 文件名：`内分泌科202608排班表.csv` */
export function csvFileName(departmentName: string, month: string): string {
  const [year, mm] = month.split('-');
  return `${departmentName}${year}${mm}排班表.csv`;
}

/** PNG 文件名：`2026年8月排班表.png`（月份不补零） */
export function pngFileName(month: string): string {
  const [year, mm] = month.split('-');
  return `${year}年${Number(mm)}月排班表.png`;
}

/** PNG / 打印的标题行：`内分泌科 · 2026年8月排班表` */
export function scheduleTitle(departmentName: string, month: string): string {
  const [year, mm] = month.split('-');
  return `${departmentName} · ${year}年${Number(mm)}月排班表`;
}
