/**
 * 领域模型类型定义。
 *
 * 字段名严格对齐 `_ref/competitor-analysis.md` 第三节，不得改动。
 * 新增字段（增强能力）一律采用可选形式，保证与竞品原结构兼容。
 *
 * 注意：本项目开启了 `erasableSyntaxOnly`，禁止使用 enum，
 * 一律使用「字符串联合类型 + as const 对象」表达枚举语义。
 */

// ============ 班次类型（11 种，key 严格对齐竞品）============

export type ShiftType =
  | 'clinic' // 门诊 · 门
  | 'expertClinic' // 专家门诊 · 专
  | 'emergency' // 急诊 · 急
  | 'dayShift' // 白班 · 白
  | 'nightShift' // 夜班 · 夜
  | 'continuousShift' // 连班 · 连
  | 'deputyShift' // 副班 · 副
  | 'chiefDuty' // 总值班 · 总
  | 'ward' // 病房 · 病
  | 'rest' // 休息 · 休
  | 'postNightRest'; // 夜下休 · 夜下

/** 单个班次的展示与行为元数据，集中定义在 `constants/shifts.ts` */
export interface ShiftMeta {
  /** 班次 key */
  key: ShiftType;
  /** 中文全称 */
  label: string;
  /** 表格简写 */
  short: string;
  /** 背景色（十六进制） */
  bg: string;
  /** 文字色（十六进制） */
  fg: string;
  /** 是否计为工作班次（rest / postNightRest 为 false） */
  isWork: boolean;
  /** 算法是否主动分配（急诊/连班/副班/总值班为 false，仅手动可选） */
  autoAssignable: boolean;
}

// ============ 医生 ============

export type DoctorTitle = '主任医师' | '副主任医师' | '主治医师' | '住院医师';

/** 医生个人硬约束 */
export interface DoctorConstraints {
  /** 不上白班（仅适合只上门诊/夜班的医生） */
  noDayShift: boolean;
  /** 不上夜班 */
  noNightShift: boolean;
  /** 周末不上班（若有固定门诊日则优先门诊） */
  weekendOff: boolean;
}

/** 请假 / 临时不可用区间（P1-4，增强字段） */
export interface LeaveRange {
  id: string;
  /** 'YYYY-MM-DD' */
  start: string;
  /** 'YYYY-MM-DD'，单日请假时 === start */
  end: string;
  note?: string;
}

export interface Doctor {
  id: string;
  name: string;
  title: DoctorTitle;
  /** 标识颜色（取自 12 色板之一） */
  color: string;
  /** 固定门诊日，0-6 对应周日到周六 */
  fixedClinicDays: number[];
  constraints: DoctorConstraints;
  /** 增强：请假登记，默认 [] */
  leaves?: LeaveRange[];
}

// ============ 规则 ============

/** 人数区间，满足 0 <= min <= max <= 20 */
export interface ShiftRange {
  min: number;
  max: number;
}

/** 单个 weekday 的人数区间配置（仅白班 / 夜班配区间） */
export interface WeekdayShiftConfig {
  dayShift: ShiftRange;
  nightShift: ShiftRange;
}

/** 轮流门诊模式：全员轮流 / 指定轮流 / 随机分配一人 */
export type RotationMode = 'all' | 'selected' | 'random';

export interface RotationRule {
  /** 增强字段：便于列表 key 与删除 */
  id: string;
  /** 0-6，0 = 周日 */
  weekday: number;
  /** mode === 'selected' 时有效 */
  doctorIds: string[];
  mode: RotationMode;
}

export interface Rules {
  departmentName: string;
  /** 按 weekday(0-6) 索引，0 = 周日 */
  shiftsByWeekday: Record<number, WeekdayShiftConfig>;
  /** 每人每月休息天数（不含夜下休和周末固定休息） */
  restDaysPerMonth: number;
  rules: {
    /** 禁止连续夜班 */
    noConsecutiveNightShift: boolean;
  };
  rotationRules: RotationRule[];
}

// ============ 排班 ============

export interface ScheduleEntry {
  doctorId: string;
  shiftType: ShiftType;
  /** 是否由轮流规则产生（random 模式不标记） */
  isRotation: boolean;
  /** 增强：P1-2 单元格锁定，重新生成时保留 */
  locked?: boolean;
  /** 增强：P0-7 手动修改标记（右下角小三角） */
  manual?: boolean;
}

/** 某一天的全部排班条目，key = doctorId */
export type DaySchedule = Record<string, ScheduleEntry>;

/** 某一月的排班，key = 'YYYY-MM-DD' */
export type MonthSchedule = Record<string, DaySchedule>;

/** 全部月份的排班，key = 'YYYY-MM' */
export type SchedulesByMonth = Record<string, MonthSchedule>;

// ============ 生成器诊断 ============

/** 生成过程中产生的诊断信息（非阻断，用于向用户解释「为什么这样排」） */
export interface Diagnostic {
  level: 'high' | 'medium' | 'low';
  /** 产生诊断的阶段名，如 'stage3Night' */
  stage: string;
  message: string;
  date?: string;
  doctorId?: string;
  shiftType?: ShiftType;
}
