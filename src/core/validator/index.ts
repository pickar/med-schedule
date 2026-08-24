/**
 * 校验主入口 `validateMonth()`。
 *
 * 三个实现要点（DESIGN 5.2）：
 * 1. **三套索引同步构建**：byCell / byStatCell / byDoctor，让 UI 查询恒为 O(1)。
 *    930 个单元格若每格遍历违规数组，会退化成 O(cells × violations)。
 * 2. **排序稳定**：severity 降序 → date 升序 → doctorId，保证洞察面板列表不跳动。
 * 3. **空排班短路**：无排班时直接返回空结果，避免为「还没生成」的月份跑全量检测。
 */

import type { Doctor, MonthSchedule, Rules, ShiftDefinition } from '../../types/domain';
import type { ValidationResult, Violation } from '../../types/validation';
import { SEVERITY_WEIGHT, cellKey, emptyValidationResult, statCellKey } from '../../types/validation';
import { listMonthDates } from '../../lib/date';
import type { CheckInput } from './rules';
import {
  buildLeaveMap,
  checkDailyCounts,
  checkDoctorConstraints,
  checkNightRules,
  checkRestShortage,
} from './rules';

export interface ValidateParams {
  /** 'YYYY-MM' */
  month: string;
  schedule: MonthSchedule;
  doctors: Doctor[];
  rules: Rules;
  /** 自定义班次定义（custom-aware 校验用） */
  customShifts: readonly ShiftDefinition[];
}

/** 全量校验某月排班，产出违规清单 + 三套索引 */
export function validateMonth(params: ValidateParams): ValidationResult {
  const { month, schedule, doctors, rules, customShifts } = params;

  // 无医生或无排班：没有可校验对象，直接返回空结果
  // （`Array.isArray` / `schedule` 判空是 BUG-01 的防御：畸形入参一律按「没得校验」处理）
  if (!Array.isArray(doctors) || doctors.length === 0 || !schedule || Object.keys(schedule).length === 0) {
    return emptyValidationResult();
  }

  const doctorMap = new Map<string, Doctor>();
  for (const doctor of doctors) {
    if (!doctor || typeof doctor.id !== 'string') {
      continue;
    }
    doctorMap.set(doctor.id, doctor);
  }

  const input: CheckInput = {
    month,
    dates: listMonthDates(month),
    schedule,
    doctors,
    doctorMap,
    rules,
    leaveMap: buildLeaveMap(doctors, month),
    customShifts,
  };

  const violations = [
    ...checkDailyCounts(input),
    ...checkNightRules(input),
    ...checkDoctorConstraints(input),
    ...checkRestShortage(input),
  ];

  violations.sort(compareViolations);
  return buildResult(violations);
}

/** severity 降序 → date 升序 → doctorId 升序 → type 升序（最终 tie-break 保证全序） */
function compareViolations(a: Violation, b: Violation): number {
  const severityDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  if (severityDiff !== 0) {
    return severityDiff;
  }
  const dateA = a.date ?? '';
  const dateB = b.date ?? '';
  if (dateA !== dateB) {
    return dateA < dateB ? -1 : 1;
  }
  const docA = a.doctorId ?? '';
  const docB = b.doctorId ?? '';
  if (docA !== docB) {
    return docA < docB ? -1 : 1;
  }
  if (a.type !== b.type) {
    return a.type < b.type ? -1 : 1;
  }
  return 0;
}

/** 构建三套索引 */
function buildResult(violations: Violation[]): ValidationResult {
  const byCell: Record<string, Violation[]> = {};
  const byStatCell: Record<string, Violation[]> = {};
  const byDoctor: Record<string, Violation[]> = {};

  for (const violation of violations) {
    const { date, doctorId, shiftType } = violation;

    if (date && doctorId) {
      pushInto(byCell, cellKey(date, doctorId), violation);
    }
    if (date && shiftType && !doctorId) {
      pushInto(byStatCell, statCellKey(date, shiftType), violation);
    }
    if (doctorId) {
      pushInto(byDoctor, doctorId, violation);
    }
  }

  return { violations, byCell, byStatCell, byDoctor, total: violations.length };
}

function pushInto(bucket: Record<string, Violation[]>, key: string, violation: Violation): void {
  const list = bucket[key];
  if (list) {
    list.push(violation);
  } else {
    bucket[key] = [violation];
  }
}

/** 便捷查询：某单元格是否有违规 */
export function hasCellViolation(result: ValidationResult, date: string, doctorId: string): boolean {
  return (result.byCell[cellKey(date, doctorId)]?.length ?? 0) > 0;
}

/** 便捷查询：按类型统计违规数量，供烟测与洞察面板汇总使用 */
export function countByType(result: ValidationResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of result.violations) {
    counts[violation.type] = (counts[violation.type] ?? 0) + 1;
  }
  return counts;
}
