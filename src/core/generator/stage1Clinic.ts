/**
 * 阶段 1：固定门诊落位。
 *
 * 最先执行的原因：`fixedClinicDays` 是对医生的**明确承诺**，自由度为零，
 * 必须在任何弹性分配之前占住位置。
 *
 * 注意 `weekendOff` 医生在周末**允许**排门诊 —— 该例外由 `canAssign()` 统一处理，
 * 本文件不做任何内联约束判断。
 */

import { assign } from './context';
import { canAssign } from './eligibility';
import type { GenContext } from './types';

export const STAGE1_NAME = 'stage1Clinic';

/**
 * 遍历每天，为固定门诊日匹配的医生排 `clinic`。
 * @returns 落位的门诊格数量
 */
export function runStage1Clinic(ctx: GenContext): number {
  let placed = 0;

  for (const day of ctx.days) {
    for (const doctor of ctx.doctors) {
      if (!doctor.fixedClinicDays.includes(day.weekday)) {
        continue;
      }
      const verdict = canAssign(ctx, day, doctor.id, 'clinic');
      if (!verdict.ok) {
        recordSkip(ctx, day.date, doctor.name, verdict.reason);
        continue;
      }
      if (assign(ctx, day.date, doctor.id, 'clinic', { isRotation: false })) {
        placed += 1;
      }
    }
  }

  return placed;
}

/**
 * 固定门诊被跳过时记录诊断。
 *
 * 只对「请假」和「锁定」出诊断：这两种是用户能理解并处理的情况。
 * 「已占位」在本阶段不可能发生（阶段 1 是第一个写入者），
 * 其余原因（如禁白班）与门诊无关，出诊断只会制造噪音。
 */
function recordSkip(ctx: GenContext, date: string, doctorName: string, reason?: string): void {
  if (reason === 'onLeave') {
    ctx.diagnostics.push({
      level: 'medium',
      stage: STAGE1_NAME,
      message: `${doctorName} ${date} 为固定门诊日，但当天请假，已跳过门诊安排`,
      date,
      shiftType: 'clinic',
    });
    return;
  }
  if (reason === 'locked') {
    ctx.diagnostics.push({
      level: 'low',
      stage: STAGE1_NAME,
      message: `${doctorName} ${date} 为固定门诊日，但该格已锁定，保留锁定内容`,
      date,
      shiftType: 'clinic',
    });
  }
}
