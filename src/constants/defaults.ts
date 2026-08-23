/**
 * 默认规则、示例医生、存储 key、各类数值常量。
 *
 * 注意：`DEFAULT_RULES` / `SAMPLE_DOCTORS` 均为**模板**，
 * 写入 state 前必须经 `createDefaultRules()` / `createSampleDoctors()` 深拷贝，
 * 否则会出现「改一处、全局串改」的引用共享 bug。
 */

import type { Doctor, DoctorTitle, Rules, WeekdayShiftConfig } from '../types/domain';
import { DOCTOR_COLORS } from './palette';

/** 数据结构版本号，任何破坏性字段变更都必须 +1 并补 MIGRATIONS */
export const SCHEMA_VERSION = 2;

/** localStorage key 命名空间 */
export const STORAGE_NAMESPACE = 'warmshift:v1';

export const STORAGE_KEYS = {
  doctors: `${STORAGE_NAMESPACE}:doctors`,
  rules: `${STORAGE_NAMESPACE}:rules`,
  /** 排班按 'YYYY-MM' 分月存，实际 key 为 `${schedules}:${month}` */
  schedules: `${STORAGE_NAMESPACE}:schedules`,
  /** 自定义班次定义，独立存储（与 doctors/rules 同构） */
  shifts: `${STORAGE_NAMESPACE}:shifts`,
  meta: `${STORAGE_NAMESPACE}:meta`,
  /** 解析失败时的原始数据备份，绝不覆盖用户数据 */
  backup: `${STORAGE_NAMESPACE}:backup`,
} as const;

/** 拼出某月的排班存储 key */
export function scheduleStorageKey(month: string): string {
  return `${STORAGE_KEYS.schedules}:${month}`;
}

// ============ 数值边界 ============

export const MIN_SHIFT_COUNT = 0;
export const MAX_SHIFT_COUNT = 20;
export const MIN_REST_DAYS = 0;
export const MAX_REST_DAYS = 31;
/** 撤销/重做栈深度 */
export const MAX_HISTORY = 30;
/** 自动保存防抖 */
export const SAVE_DEBOUNCE_MS = 500;
/** 校验重算防抖 */
export const VALIDATE_DEBOUNCE_MS = 200;
/** 生成按钮 loading 保底时长（感知设计，不是性能问题） */
export const GENERATE_MIN_LOADING_MS = 300;
/** 表格行淡入 stagger 间隔 */
export const ROW_STAGGER_MS = 30;
/** 生成器局部修复最大迭代轮数 */
export const MAX_REPAIR_ROUNDS = 3;

export const DEFAULT_DEPARTMENT_NAME = '内分泌科';

// ============ 默认规则 ============

function defaultWeekdayConfig(): WeekdayShiftConfig {
  return {
    dayShift: { min: 2, max: 3 },
    nightShift: { min: 1, max: 1 },
  };
}

/** 生成一份全新的默认规则（周一~周日：白班 2-3 人、夜班 1-1 人） */
export function createDefaultRules(): Rules {
  const shiftsByWeekday: Record<number, WeekdayShiftConfig> = {};
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    shiftsByWeekday[weekday] = defaultWeekdayConfig();
  }
  return {
    departmentName: DEFAULT_DEPARTMENT_NAME,
    shiftsByWeekday,
    restDaysPerMonth: 8,
    rules: {
      noConsecutiveNightShift: true,
    },
    rotationRules: [],
  };
}

/** 只读模板，仅用于对比与展示，不要直接放进 state */
export const DEFAULT_RULES: Rules = createDefaultRules();

// ============ 示例医生 ============

interface SampleDoctorTemplate {
  name: string;
  title: DoctorTitle;
  fixedClinicDays: number[];
  noDayShift: boolean;
  noNightShift: boolean;
  weekendOff: boolean;
}

/** 10 位示例医生（示例数据，可自由修改） */
const SAMPLE_DOCTOR_TEMPLATES: readonly SampleDoctorTemplate[] = [
  { name: '林涛', title: '主任医师', fixedClinicDays: [1, 4], noDayShift: false, noNightShift: true, weekendOff: true },
  { name: '苏晴', title: '副主任医师', fixedClinicDays: [2], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '郑昊', title: '副主任医师', fixedClinicDays: [3, 5], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '何静', title: '主治医师', fixedClinicDays: [], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '马俊', title: '主治医师', fixedClinicDays: [5], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '高翔', title: '主治医师', fixedClinicDays: [], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '罗薇', title: '住院医师', fixedClinicDays: [], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '宋宇', title: '住院医师', fixedClinicDays: [], noDayShift: true, noNightShift: false, weekendOff: false },
  { name: '韩雪', title: '住院医师', fixedClinicDays: [], noDayShift: false, noNightShift: false, weekendOff: false },
  { name: '邓超', title: '住院医师', fixedClinicDays: [], noDayShift: false, noNightShift: false, weekendOff: false },
];

/**
 * 生成 10 位示例医生。
 * @param idFactory ID 生成函数，默认使用稳定 id（`sample-1`…），
 *                  调用方需要真实唯一 id 时传入 `lib/id.ts` 的 `createId`。
 */
export function createSampleDoctors(idFactory?: () => string): Doctor[] {
  return SAMPLE_DOCTOR_TEMPLATES.map((tpl, index) => ({
    id: idFactory ? idFactory() : `sample-${index + 1}`,
    name: tpl.name,
    title: tpl.title,
    color: DOCTOR_COLORS[index % DOCTOR_COLORS.length],
    fixedClinicDays: [...tpl.fixedClinicDays],
    constraints: {
      noDayShift: tpl.noDayShift,
      noNightShift: tpl.noNightShift,
      weekendOff: tpl.weekendOff,
    },
    leaves: [],
  }));
}

/** 只读模板，仅用于展示与测试对比 */
export const SAMPLE_DOCTORS: readonly Doctor[] = createSampleDoctors();

/** 新增医生时的空白初值（不含 id / color，由 handler 补齐） */
export function createBlankDoctorDraft(): Omit<Doctor, 'id' | 'color'> {
  return {
    name: '',
    title: '主治医师',
    fixedClinicDays: [],
    constraints: { noDayShift: false, noNightShift: false, weekendOff: false },
    leaves: [],
  };
}
