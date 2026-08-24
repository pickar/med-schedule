/**
 * 工作量计分器 —— 公平性核心。
 *
 * 两个设计要点：
 * 1. **专项计数优先于综合负担**：排夜班就先比 nightCount，避免「某人门诊多导致
 *    burden 高，于是夜班永远轮不到他」——那会让夜班在少数人身上堆积。
 * 2. **确定性哈希 tie-break**：绝不使用 `Math.random()`。同一输入必须产出同一
 *    排班，否则用户无法理解「为什么重新生成后变了」，也无法做 A/B 对比。
 */

import type { ShiftId } from '../../types/domain';
import type { FairnessDimension, WorkloadScore } from './types';

/** 创建零分记录 */
export function createScore(doctorId: string): WorkloadScore {
  return {
    doctorId,
    nightCount: 0,
    clinicCount: 0,
    dayCount: 0,
    workCount: 0,
    restCount: 0,
    postNightCount: 0,
  };
}

/** `burden()` 所需的最小字段集，让 `core/stats` 也能复用同一套权重 */
export type BurdenInput = Pick<WorkloadScore, 'nightCount' | 'clinicCount' | 'dayCount'>;

/**
 * 综合负担分：夜班权重最高，用于跨班次公平比较。
 * 权重 3 / 1.5 / 1 来自 DESIGN 4.3，不要随意调整——
 * 改权重会整体改变排班形态，属于产品决策而非实现细节。
 *
 * 入参放宽为结构子集，是为了让统计层直接传 `DoctorStat`：
 * 「排的时候」和「看的时候」用同一个函数，口径永远不会漂移。
 */
export function burden(s: BurdenInput): number {
  return s.nightCount * 3 + s.clinicCount * 1.5 + s.dayCount * 1;
}

/**
 * 把一次班次落位累加进计分。
 * @param delta +1 表示落位，-1 表示撤销（阶段 5/6 会撤销已排班次）
 * @param isWork 仅当 `shiftType` 不在内置专项计数分支时（自定义班次）使用，
 *   决定计入 `workCount` 还是 `restCount`。内置班次走上面的专项分支，忽略此参数。
 */
export function applyShiftToScore(score: WorkloadScore, shiftType: ShiftId, delta: 1 | -1, isWork = false): void {
  switch (shiftType) {
    case 'nightShift':
      score.nightCount += delta;
      score.workCount += delta;
      return;
    case 'clinic':
    case 'expertClinic':
      score.clinicCount += delta;
      score.workCount += delta;
      return;
    case 'dayShift':
    case 'ward':
      score.dayCount += delta;
      score.workCount += delta;
      return;
    case 'emergency':
    case 'continuousShift':
    case 'deputyShift':
    case 'chiefDuty':
      // 手动班次不参与自动分配，但锁定格可能带入，仍计入总工作量
      score.workCount += delta;
      return;
    case 'rest':
      score.restCount += delta;
      return;
    case 'postNightRest':
      score.postNightCount += delta;
      return;
    default:
      // 自定义班次：按是否为工作班次计入总工作量（rest 专项仅在生成器硬编码分支处理）
      if (isWork) {
        score.workCount += delta;
      } else {
        score.restCount += delta;
      }
      return;
  }
}

/** 取某维度的专项计数 */
function dimensionCount(score: WorkloadScore, dimension: FairnessDimension): number {
  switch (dimension) {
    case 'night':
      return score.nightCount;
    case 'clinic':
      return score.clinicCount;
    case 'day':
      return score.dayCount;
    default:
      return 0;
  }
}

/**
 * FNV-1a 32 位哈希。选它的理由：实现只需 8 行、无依赖、雪崩性对短字符串足够，
 * 且纯整数运算保证跨平台跨引擎结果一致（这点比哈希质量更重要）。
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 乘以 16777619，用移位加法避免 32 位溢出精度问题
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 从候选集中挑选「当前最该被排」的医生。
 *
 * 排序键（升序，逐级 tie-break）：
 *   1. 该班次维度的专项计数 —— 保证单维度公平
 *   2. 综合负担 burden —— 避免跨维度的系统性倾斜
 *   3. 确定性哈希（seed + doctorId）—— 打破名册顺序偏袒，同时保持幂等
 *
 * @param candidates 已通过 `canAssign()` 的候选 doctorId 列表
 * @param seed 通常传当天日期，配合 doctorId 生成稳定随机序
 * @returns 选中的 doctorId；候选为空时返回 null
 */
export function pickFairest(
  candidates: readonly string[],
  scores: Map<string, WorkloadScore>,
  dimension: FairnessDimension,
  seed: string,
): string | null {
  if (candidates.length === 0) {
    return null;
  }

  let best: string | null = null;
  let bestDim = Number.POSITIVE_INFINITY;
  let bestBurden = Number.POSITIVE_INFINITY;
  let bestHash = Number.POSITIVE_INFINITY;

  for (const doctorId of candidates) {
    const score = scores.get(doctorId);
    if (!score) {
      continue;
    }
    const dim = dimensionCount(score, dimension);
    const bd = burden(score);
    const hash = fnv1a(`${seed}|${doctorId}`);

    const better =
      dim < bestDim ||
      (dim === bestDim && bd < bestBurden) ||
      (dim === bestDim && bd === bestBurden && hash < bestHash);

    if (better) {
      best = doctorId;
      bestDim = dim;
      bestBurden = bd;
      bestHash = hash;
    }
  }

  return best;
}

/**
 * 按公平顺序返回**全部**候选（升序），用于需要一次取多人的场景。
 * 与 `pickFairest` 排序键完全一致，保证两者行为不会漂移。
 */
export function sortByFairness(
  candidates: readonly string[],
  scores: Map<string, WorkloadScore>,
  dimension: FairnessDimension,
  seed: string,
): string[] {
  return [...candidates].sort((a, b) => {
    const sa = scores.get(a);
    const sb = scores.get(b);
    if (!sa || !sb) {
      return 0;
    }
    const dimDiff = dimensionCount(sa, dimension) - dimensionCount(sb, dimension);
    if (dimDiff !== 0) {
      return dimDiff;
    }
    const burdenDiff = burden(sa) - burden(sb);
    if (burdenDiff !== 0) {
      return burdenDiff;
    }
    return fnv1a(`${seed}|${a}`) - fnv1a(`${seed}|${b}`);
  });
}

/**
 * 确定性地从候选中取一人（用于 `random` 轮流模式）。
 * 不看工作量，纯哈希取模——竞品语义就是「随机分配一人」。
 */
export function pickDeterministicRandom(candidates: readonly string[], seed: string): string | null {
  if (candidates.length === 0) {
    return null;
  }
  const sorted = [...candidates].sort();
  return sorted[fnv1a(seed) % sorted.length];
}
