/**
 * 医生维度统计：应休 / 实休 / 夜班数 / 门诊数 / 白班数。
 *
 * 两条口径，与校验器 `checkRestShortage()` 严格一致，改一处必须改两处：
 * 1. **实休只计 `rest`，不含 `postNightRest`**（竞品原文「不含夜下休」）。
 * 2. **请假日计入实休** —— 生成阶段请假格即为 `rest`，对医生而言请假就是休息。
 *    若不计入，长假医生会被误报「休息天数不足」，那是彻头彻尾的噪音。
 */

import type { Doctor, MonthSchedule, Rules, ShiftDefinition, ShiftType } from '../../types/domain';
import { isClinicShift, isRestShiftId } from '../../constants/shifts';
import { listMonthDates } from '../../lib/date';
import { buildLeaveMap } from '../validator/rules';
import { burden } from '../generator/workload';
import { createEmptyCounts } from './daily';

export interface DoctorStat {
  doctorId: string;
  name: string;
  color: string;
  /** 11 种班次的当月计数，恒为全量 key */
  counts: Record<ShiftType, number>;
  /** 门诊 + 专家门诊（含固定门诊），计入负担与表格展示 */
  clinicCount: number;
  /**
   * 其中由**轮流门诊规则**排出的部分（`isRotation`）。
   *
   * 单独拆出来是给公平度用的：固定门诊是医生自己的坐诊承诺，由配置决定，
   * 生成器阶段一只是照抄，重排多少次都不会变。把它算进「分配是否公平」，
   * 等于让评分去谴责一件工具无法改善的事。负担仍按 `clinicCount` 全量计。
   */
  rotationClinicCount: number;
  /** 白班 */
  dayShiftCount: number;
  /** 病房 */
  wardCount: number;
  /** 白班 + 病房，公平度「白班」维度用 */
  dayCount: number;
  /** 夜班 */
  nightCount: number;
  /** 急诊 / 连班 / 副班 / 总值班（仅手动排班可能出现） */
  otherWorkCount: number;
  /** 全部工作班次合计 */
  workCount: number;
  /** 应休天数（来自规则） */
  shouldRest: number;
  /** 实休天数：只计 `rest` */
  actualRest: number;
  /** 夜下休天数，tooltip 用，不计入实休 */
  postNightCount: number;
  /** 休息缺口，已达标时为 0 */
  restGap: number;
  /** 当月请假天数 */
  leaveDays: number;
  /** 当月未排班的空格数 */
  unassignedDays: number;
  /**
   * 是否被硬约束整体排除在夜班之外（`noNightShift`）。
   *
   * 公平度的夜班维度会把这类医生剔出**分母**：他一个夜班都排不了是配置使然，
   * 不是排班偏袒。留在分母里只会让「夜班公平度」永远背着一个改不掉的离群点。
   * 注意这**不影响**表格与负担统计，该医生依旧照常展示。
   */
  excludedFromNight: boolean;
  /** 综合负担分：夜班×3 + 门诊×1.5 + 白班×1 */
  burden: number;
}

export interface DoctorStatsParams {
  /** 'YYYY-MM' */
  month: string;
  schedule: MonthSchedule;
  doctors: Doctor[];
  rules: Rules;
  /** 自定义班次定义（custom-aware 统计用） */
  customShifts: ShiftDefinition[];
}

/** 按名册顺序输出每位医生的当月统计 */
export function computeDoctorStats(params: DoctorStatsParams): DoctorStat[] {
  const { month, schedule, doctors, rules, customShifts } = params;
  const dates = listMonthDates(month);
  const totalDays = dates.length;
  const leaveMap = buildLeaveMap(doctors, month);

  // 一次遍历排班，把计数落到每位医生名下，避免「医生 × 天数」二次嵌套
  const countsByDoctor = new Map<string, Record<ShiftType, number>>();
  const rotationByDoctor = new Map<string, number>();
  // 自定义「休息类」班次（isWork=false）的计数：用于补进 actualRest，可抵休息天数
  const customRestByDoctor = new Map<string, number>();
  for (const doctor of doctors) {
    countsByDoctor.set(doctor.id, createEmptyCounts());
    rotationByDoctor.set(doctor.id, 0);
    customRestByDoctor.set(doctor.id, 0);
  }
  for (const date of dates) {
    const day = schedule?.[date];
    if (!day) {
      continue;
    }
    for (const entry of Object.values(day)) {
      // BUG-01 防御：畸形数据里的 null / 非对象条目直接跳过，绝不让单格脏数据掀翻整张表
      if (!entry || typeof entry.shiftType !== 'string') {
        continue;
      }
      const counts = countsByDoctor.get(entry.doctorId);
      // 已删除医生的残留排班：跳过而不是补建，统计口径以名册为准
      if (!counts) {
        continue;
      }
      if (entry.shiftType in counts) {
        counts[entry.shiftType as ShiftType] += 1;
        if (entry.isRotation && isClinicShift(entry.shiftType)) {
          rotationByDoctor.set(entry.doctorId, (rotationByDoctor.get(entry.doctorId) ?? 0) + 1);
        }
      } else if (isRestShiftId(entry.shiftType, customShifts)) {
        // 自定义休息班次：不设单列统计行，只计入 actualRest
        customRestByDoctor.set(
          entry.doctorId,
          (customRestByDoctor.get(entry.doctorId) ?? 0) + 1,
        );
      }
    }
  }

  return doctors.map((doctor) => {
    const counts = countsByDoctor.get(doctor.id) ?? createEmptyCounts();
    return buildDoctorStat(
      doctor,
      counts,
      rotationByDoctor.get(doctor.id) ?? 0,
      rules,
      totalDays,
      countLeaveDays(leaveMap, doctor.id),
      customRestByDoctor.get(doctor.id) ?? 0,
    );
  });
}

/** 组装单个医生的统计结构 */
function buildDoctorStat(
  doctor: Doctor,
  counts: Record<ShiftType, number>,
  rotationClinicCount: number,
  rules: Rules,
  totalDays: number,
  leaveDays: number,
  customRestCount: number,
): DoctorStat {
  const clinicCount = counts.clinic + counts.expertClinic;
  const dayShiftCount = counts.dayShift;
  const wardCount = counts.ward;
  const dayCount = dayShiftCount + wardCount;
  const nightCount = counts.nightShift;
  const otherWorkCount =
    counts.emergency + counts.continuousShift + counts.deputyShift + counts.chiefDuty;
  const workCount = clinicCount + dayCount + nightCount + otherWorkCount;
  // actualRest 含内置 `rest` 与自定义休息班次（可抵休息天数）；不含 night下休
  const actualRest = counts.rest + customRestCount;
  const postNightCount = counts.postNightRest;
  const shouldRest = rules?.restDaysPerMonth ?? 0;

  return {
    doctorId: doctor.id,
    name: doctor.name,
    color: doctor.color,
    counts,
    clinicCount,
    rotationClinicCount,
    dayShiftCount,
    wardCount,
    dayCount,
    nightCount,
    otherWorkCount,
    workCount,
    shouldRest,
    actualRest,
    postNightCount,
    restGap: Math.max(0, shouldRest - actualRest),
    leaveDays,
    unassignedDays: Math.max(0, totalDays - workCount - actualRest - postNightCount),
    // BUG-01 防御：缺 constraints 的畸形医生按「无约束」处理，而不是抛 TypeError
    excludedFromNight: doctor.constraints?.noNightShift === true,
    // burden 与生成器计分器共用同一实现，保证「排的时候」和「看的时候」口径一致
    burden: burden({ nightCount, clinicCount, dayCount }),
  };
}

/** 从请假索引里数出某医生的当月请假天数 */
function countLeaveDays(leaveMap: Map<string, string>, doctorId: string): number {
  let days = 0;
  const suffix = `|${doctorId}`;
  for (const key of leaveMap.keys()) {
    if (key.endsWith(suffix)) {
      days += 1;
    }
  }
  return days;
}

/** 建 doctorId -> DoctorStat 索引，供表格行与洞察面板 O(1) 取用 */
export function indexDoctorStats(stats: readonly DoctorStat[]): Record<string, DoctorStat> {
  const index: Record<string, DoctorStat> = {};
  for (const stat of stats) {
    index[stat.doctorId] = stat;
  }
  return index;
}

/** 筛出休息未达标的医生，按缺口降序 —— 洞察面板「休息天数不足」列表直接用 */
export function findRestShortages(stats: readonly DoctorStat[]): DoctorStat[] {
  return stats.filter((stat) => stat.restGap > 0).sort((a, b) => b.restGap - a.restGap);
}
