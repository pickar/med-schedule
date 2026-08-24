/**
 * 生成器编排入口。
 *
 * 六个阶段的顺序**由自由度从低到高排列**，这是分阶段贪心不塌方的唯一前提：
 *   1 固定门诊（自由度 0，是对医生的承诺）
 *   2 轮流门诊（候选池受限）
 *   3 夜班 + 夜下休（一次落位锁死两天，回溯代价最高）
 *   4 白班 / 病房（自由度最高，用剩余人力填）
 *   5 休息补齐（只做降级，不新增工作）
 *   6 局部修复（用校验器复查，最多 3 轮）
 *
 * 调换任意两阶段的顺序都会破坏这个结构，改动前请先想清楚回溯代价。
 */

import type { Diagnostic } from '../../types/domain';
import { buildContext, toMonthSchedule } from './context';
import { runStage1Clinic } from './stage1Clinic';
import { runStage2Rotation } from './stage2Rotation';
import { runStage3Night } from './stage3Night';
import { runStage4Day } from './stage4Day';
import { runStage5Rest } from './stage5Rest';
import { runStage6Repair } from './stage6Repair';
import type { GenContext, GenerateParams, GenerateResult } from './types';

export const GENERATOR_NAME = 'generator';

/** 各阶段的落位统计，供烟测与调试使用（不进入 UI） */
export interface StageStats {
  clinicPlaced: number;
  rotationPlaced: number;
  nightPlaced: number;
  dayMinPlaced: number;
  dayMaxPlaced: number;
  wardPlaced: number;
  restFilled: number;
  restDowngraded: number;
  restShortageDoctors: number;
  repairRounds: number;
  postRestFixed: number;
  belowMinFixed: number;
}

/** 带阶段明细的生成结果，仅烟测/调试使用 */
export interface DetailedGenerateResult extends GenerateResult {
  stages: StageStats;
}

/**
 * 生成某月排班。
 *
 * **纯函数**：不读写 localStorage、不依赖 `Math.random()`、不改动入参。
 * 同一组 `(month, doctors, rules, existingSchedule)` 必然产出完全相同的结果，
 * 这是「重新生成」这个动作可被用户理解的前提。
 */
export function generateSchedule(params: GenerateParams): GenerateResult {
  const { schedule, diagnostics, elapsedMs } = generateScheduleDetailed(params);
  return { schedule, diagnostics, elapsedMs };
}

/** 与 `generateSchedule()` 完全相同，额外返回阶段落位统计 */
export function generateScheduleDetailed(params: GenerateParams): DetailedGenerateResult {
  const startedAt = nowMs();

  const ctx = buildContext({
    month: params.month,
    doctors: params.doctors,
    rules: params.rules,
    shifts: params.shifts,
    existingSchedule: params.existingSchedule,
  });

  const guard = precheck(ctx);
  if (guard) {
    return {
      schedule: {},
      diagnostics: [guard],
      elapsedMs: round2(nowMs() - startedAt),
      stages: emptyStageStats(),
    };
  }

  const stages = runPipeline(ctx);

  return {
    schedule: toMonthSchedule(ctx),
    diagnostics: ctx.diagnostics,
    elapsedMs: round2(nowMs() - startedAt),
    stages,
  };
}

/**
 * 依次执行六个阶段。
 * 独立导出是为了让烟测能在同一个 ctx 上做前后对比，而不必重跑整条链路。
 */
export function runPipeline(ctx: GenContext): StageStats {
  const clinicPlaced = runStage1Clinic(ctx);
  const rotationPlaced = runStage2Rotation(ctx);
  const nightPlaced = runStage3Night(ctx);
  const day = runStage4Day(ctx);
  const rest = runStage5Rest(ctx);
  const repair = runStage6Repair(ctx);

  return {
    clinicPlaced,
    rotationPlaced,
    nightPlaced,
    dayMinPlaced: day.minRoundPlaced,
    dayMaxPlaced: day.maxRoundPlaced,
    wardPlaced: day.wardPlaced,
    restFilled: rest.emptyFilled,
    restDowngraded: rest.downgraded,
    restShortageDoctors: rest.shortageCount,
    repairRounds: repair.rounds,
    postRestFixed: repair.postRestFixed,
    belowMinFixed: repair.belowMinFixed,
  };
}

/**
 * 前置校验：没有医生或月份非法时直接短路。
 *
 * 返回诊断而不是抛异常 —— 生成器是 UI 的同步依赖，
 * 抛异常会把整个面板打白屏，而这两种情况都是用户可自行修复的正常状态。
 */
function precheck(ctx: GenContext): Diagnostic | null {
  if (ctx.days.length === 0) {
    return {
      level: 'high',
      stage: GENERATOR_NAME,
      message: `月份「${ctx.month}」不合法，未生成任何排班`,
    };
  }
  if (ctx.doctors.length === 0) {
    return {
      level: 'high',
      stage: GENERATOR_NAME,
      message: '医生名册为空，无法生成排班，请先添加至少 1 位医生',
    };
  }
  return null;
}

function emptyStageStats(): StageStats {
  return {
    clinicPlaced: 0,
    rotationPlaced: 0,
    nightPlaced: 0,
    dayMinPlaced: 0,
    dayMaxPlaced: 0,
    wardPlaced: 0,
    restFilled: 0,
    restDowngraded: 0,
    restShortageDoctors: 0,
    repairRounds: 0,
    postRestFixed: 0,
    belowMinFixed: 0,
  };
}

/** 优先用高精度计时器；Node 烟测环境同样具备 `performance` */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type { GenContext, GenerateParams, GenerateResult } from './types';
