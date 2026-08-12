/**
 * 公平度评分（基于各班次分布的标准差，0-100）。
 *
 * 用**变异系数**（标准差 / 均值）而不是标准差绝对值，理由：
 * 「夜班均值 3、标准差 1」和「白班均值 15、标准差 1」的不公平程度差着量级，
 * 直接比标准差会让高频班次天然显得更公平。除以均值后才可跨维度加权。
 *
 * 均值为 0 时（全月没人排该班次）记满分：无人承担就无所谓分配不均。
 */

import { TEXTS } from '../../constants/texts';
import type { DoctorStat } from './doctor';

export type FairnessLevel = 'excellent' | 'good' | 'fair' | 'poor';

export type FairnessKey = 'night' | 'clinic' | 'day' | 'work';

export interface FairnessDimensionScore {
  key: FairnessKey;
  label: string;
  /** 人均班次数，保留 1 位小数 */
  mean: number;
  /** 总体标准差，保留 2 位小数 */
  stdDev: number;
  min: number;
  max: number;
  /** 极差 max - min，比标准差更好懂，用于 tooltip */
  spread: number;
  /** 该维度得分 0-100 */
  score: number;
  /** 该维度在总分中的权重 */
  weight: number;
}

export interface FairnessExtreme {
  doctorId: string;
  name: string;
  burden: number;
}

export interface FairnessResult {
  /** 加权总分 0-100，整数 */
  score: number;
  level: FairnessLevel;
  /** 中文评级文案 */
  label: string;
  dimensions: FairnessDimensionScore[];
  /** 负担最重者，无数据时为 null */
  heaviest: FairnessExtreme | null;
  /** 负担最轻者，无数据时为 null */
  lightest: FairnessExtreme | null;
}

/**
 * 维度权重：夜班最重。
 * 夜班是医生最在意、也最容易积怨的一类，权重必须显著高于其它维度。
 * 四项之和恒为 1。
 */
const DIMENSIONS: readonly { key: FairnessKey; label: string; weight: number }[] = [
  { key: 'night', label: TEXTS.workloadDimensionNight, weight: 0.35 },
  { key: 'clinic', label: TEXTS.workloadDimensionClinic, weight: 0.2 },
  { key: 'day', label: TEXTS.workloadDimensionDay, weight: 0.2 },
  { key: 'work', label: TEXTS.workloadDimensionTotal, weight: 0.25 },
];

/** 四档评级文案（T03 第 3 问确认口径：阈值不动，只调文案） */
const LEVEL_LABELS: Record<FairnessLevel, string> = {
  excellent: '非常均衡',
  good: '比较均衡',
  fair: '略有偏差',
  poor: '明显偏差',
};

/**
 * 取某维度在单个医生身上的数值。
 *
 * 门诊维度只取**轮流门诊**（`rotationClinicCount`）而非全量门诊，这是刻意的：
 * 固定门诊由医生配置决定，生成器无权调整，把它算作「分配不公」会让评分
 * 恒定扣分且重排无效——默认名册下门诊维度会被压到 0 分，总分天花板锁死在 80，
 * 用户永远看不到「非常均衡」。工作总量维度（`workCount`）仍含固定门诊，
 * 所以「谁扛得多」这件事不会被漏掉。
 */
function valueOf(stat: DoctorStat, key: FairnessKey): number {
  switch (key) {
    case 'night':
      return stat.nightCount;
    case 'clinic':
      return stat.rotationClinicCount;
    case 'day':
      return stat.dayCount;
    case 'work':
      return stat.workCount;
    default:
      return 0;
  }
}

/** 计算公平度。入参为空时返回满分空结果，避免 UI 需要额外判空 */
export function computeFairness(stats: readonly DoctorStat[]): FairnessResult {
  if (stats.length === 0) {
    return {
      score: 100,
      level: 'excellent',
      label: LEVEL_LABELS.excellent,
      dimensions: DIMENSIONS.map((d) => ({
        key: d.key,
        label: d.label,
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        spread: 0,
        score: 100,
        weight: d.weight,
      })),
      heaviest: null,
      lightest: null,
    };
  }

  const dimensions = DIMENSIONS.map((d) =>
    scoreDimension(populationFor(stats, d.key), d.key, d.label, d.weight),
  );
  const weighted = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
  const score = clamp(Math.round(weighted), 0, 100);

  return {
    score,
    level: levelOf(score),
    label: LEVEL_LABELS[levelOf(score)],
    dimensions,
    heaviest: pickExtreme(stats, 'max'),
    lightest: pickExtreme(stats, 'min'),
  };
}

/**
 * 该维度参与评分的人群。
 *
 * 夜班维度剔除 `noNightShift` 的医生：他们不在分配池里，留在分母只会把
 * 一个改不掉的 0 当成不公平。其余维度全员参与——`noDayShift` 只挡白班、
 * 不挡病房，这些医生仍在「白班」维度里正常承担，不应剔除。
 */
function populationFor(stats: readonly DoctorStat[], key: FairnessKey): readonly DoctorStat[] {
  if (key !== 'night') {
    return stats;
  }
  const eligible = stats.filter((stat) => !stat.excludedFromNight);
  // 全员禁夜：没有可比人群，交给下游按「均值 0 记满分」处理
  return eligible.length > 0 ? eligible : [];
}

/** 单维度评分：score = 100 × (1 − 变异系数)，裁剪到 [0, 100] */
function scoreDimension(
  stats: readonly DoctorStat[],
  key: FairnessKey,
  label: string,
  weight: number,
): FairnessDimensionScore {
  // 该维度无可比人群（如全员禁夜）：不存在分配不均，记满分
  if (stats.length === 0) {
    return { key, label, mean: 0, stdDev: 0, min: 0, max: 0, spread: 0, score: 100, weight };
  }

  const values = stats.map((stat) => valueOf(stat, key));
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // 均值为 0：该班次全月无人承担，不存在分配不均
  const score = mean <= 0 ? 100 : clamp(Math.round(100 * (1 - stdDev / mean)), 0, 100);

  return {
    key,
    label,
    mean: round1(mean),
    stdDev: round2(stdDev),
    min: Math.min(...values),
    max: Math.max(...values),
    spread: Math.max(...values) - Math.min(...values),
    score,
    weight,
  };
}

/**
 * 取负担最重 / 最轻的医生。
 * 同分时按 doctorId 升序取第一个，保证同输入同输出（洞察面板不会左右横跳）。
 */
function pickExtreme(stats: readonly DoctorStat[], mode: 'max' | 'min'): FairnessExtreme {
  let best = stats[0];
  for (const stat of stats) {
    const better = mode === 'max' ? stat.burden > best.burden : stat.burden < best.burden;
    const tie = stat.burden === best.burden && stat.doctorId < best.doctorId;
    if (better || tie) {
      best = stat;
    }
  }
  return { doctorId: best.doctorId, name: best.name, burden: round2(best.burden) };
}

function levelOf(score: number): FairnessLevel {
  if (score >= 90) {
    return 'excellent';
  }
  if (score >= 75) {
    return 'good';
  }
  if (score >= 60) {
    return 'fair';
  }
  return 'poor';
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
