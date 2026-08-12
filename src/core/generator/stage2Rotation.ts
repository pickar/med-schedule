/**
 * 阶段 2：轮流门诊落位（专家门诊）。
 *
 * 三种模式的差异只在「候选池」和「是否打轮流标记」：
 *   - all       候选 = 全体，pickFairest 选人，isRotation: true
 *   - selected  候选 = 指定名单，pickFairest 选人，isRotation: true
 *   - random    候选 = 全体，确定性哈希取一人，**isRotation: false**
 *
 * `random` 不打标记是竞品的明确语义（原文：「随机分配一人（不显示轮流标记）」），
 * 不是遗漏，不要"顺手补上"。
 */

import type { RotationRule } from '../../types/domain';
import { assign } from './context';
import { eligibleCandidates } from './eligibility';
import type { DayInfo, GenContext } from './types';
import { pickDeterministicRandom, pickFairest } from './workload';

export const STAGE2_NAME = 'stage2Rotation';

/**
 * 按 rotationRules 逐条处理。
 * @returns 落位的专家门诊格数量
 */
export function runStage2Rotation(ctx: GenContext): number {
  const { rotationRules } = ctx.rules;
  if (rotationRules.length === 0) {
    return 0;
  }

  let placed = 0;
  for (const rule of rotationRules) {
    const days = ctx.days.filter((day) => day.weekday === rule.weekday);
    for (const day of days) {
      if (applyRotationOnDay(ctx, rule, day)) {
        placed += 1;
      }
    }
  }
  return placed;
}

/** 在单日执行一条轮流规则；返回是否成功落位 */
function applyRotationOnDay(ctx: GenContext, rule: RotationRule, day: DayInfo): boolean {
  const pool = resolvePool(ctx, rule);
  if (pool.length === 0) {
    recordNoCandidate(ctx, rule, day, '参与名单为空');
    return false;
  }

  const candidates = eligibleCandidates(ctx, day, 'expertClinic', pool);
  if (candidates.length === 0) {
    recordNoCandidate(ctx, rule, day, '当天无可用医生');
    return false;
  }

  // seed 里带 rule.id，保证同一天的多条规则不会选出同一人的哈希序
  const seed = `${day.date}|${rule.id}`;
  const isRandom = rule.mode === 'random';
  const chosen = isRandom
    ? pickDeterministicRandom(candidates, seed)
    : pickFairest(candidates, ctx.scores, 'clinic', seed);

  if (!chosen) {
    return false;
  }

  // random 模式不打轮流标记 —— 竞品原始语义，勿改
  return assign(ctx, day.date, chosen, 'expertClinic', { isRotation: !isRandom });
}

/** 解析候选池：selected 用指定名单（过滤掉已删除的医生），其余用全体 */
function resolvePool(ctx: GenContext, rule: RotationRule): string[] {
  if (rule.mode === 'selected') {
    return rule.doctorIds.filter((id) => ctx.doctorMap.has(id));
  }
  return ctx.doctors.map((d) => d.id);
}

const MODE_LABELS: Record<RotationRule['mode'], string> = {
  all: '全员轮流',
  selected: '指定轮流',
  random: '随机分配',
};

/** 轮流规则无人可排时记录诊断，让用户知道规则没生效以及为什么 */
function recordNoCandidate(ctx: GenContext, rule: RotationRule, day: DayInfo, why: string): void {
  ctx.diagnostics.push({
    level: 'medium',
    stage: STAGE2_NAME,
    message: `${day.date} 的轮流门诊规则（${MODE_LABELS[rule.mode]}）未能执行：${why}`,
    date: day.date,
    shiftType: 'expertClinic',
  });
}
