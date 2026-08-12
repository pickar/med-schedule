/**
 * 工作量均衡看板：四维度公平度条 + 极值 + 夜班豁免标注。
 *
 * 纯展示组件，数据由 InsightPanel 灌入。维度条的分数直接映射成颜色，
 * 颜色一律走 tokens.css 变量（以 inline style 引用变量名，不写死色值）。
 *
 * 门诊维度的 tooltip 把「固定门诊」与「轮流门诊」拆开显示，用户才知道
 * 表格里门诊总数与这里「门诊（轮流）」对不上的差额去哪了。固定额等于
 * 各医生 clinicCount − rotationClinicCount 之和，轮流额等于 rotationClinicCount 之和。
 */

import { memo } from 'react';
import type { DoctorStat } from '../../core/stats/doctor';
import type { FairnessLevel, FairnessResult } from '../../core/stats/fairness';
import { TEXTS } from '../../constants/texts';

export interface WorkloadBoardProps {
  fairness: FairnessResult;
  doctorStats: readonly DoctorStat[];
  /** 被「不上夜班」约束整体排除在夜班外的医生，用于豁免标注 */
  exemptDoctors: readonly DoctorStat[];
}

/** 公平度评级 → 语义色（token 变量名），与 workload 条填色共用一套映射 */
const LEVEL_COLOR: Record<FairnessLevel, string> = {
  excellent: 'var(--color-success)',
  good: 'var(--color-info)',
  fair: 'var(--color-warning)',
  poor: 'var(--color-danger)',
};

/** 单维度分数 → 条填色，与评级共用阈值 */
function scoreColor(score: number): string {
  if (score >= 90) {
    return 'var(--color-success)';
  }
  if (score >= 75) {
    return 'var(--color-info)';
  }
  if (score >= 60) {
    return 'var(--color-warning)';
  }
  return 'var(--color-danger)';
}

export const WorkloadBoard = memo(function WorkloadBoard(
  props: WorkloadBoardProps,
): React.ReactElement {
  const { fairness, doctorStats, exemptDoctors } = props;

  const fixedTotal = doctorStats.reduce(
    (sum, stat) => sum + Math.max(0, stat.clinicCount - stat.rotationClinicCount),
    0,
  );
  const rotationTotal = doctorStats.reduce((sum, stat) => sum + stat.rotationClinicCount, 0);

  const { heaviest, lightest } = fairness;

  return (
    <section className="insight-section" aria-labelledby="insight-workload-title">
      <h3 className="insight-section__title" id="insight-workload-title">
        <span>{TEXTS.workloadTitle}</span>
        <span className="workload-score" style={{ color: LEVEL_COLOR[fairness.level] }}>
          {fairness.score} · {fairness.label}
        </span>
      </h3>

      <div className="workload-bars">
        {fairness.dimensions.map((dim) => {
          const tooltip =
            dim.key === 'clinic'
              ? TEXTS.workloadClinicTooltip(fixedTotal, rotationTotal)
              : TEXTS.workloadSpread(dim.spread);
          return (
            <div className="wl-bar" key={dim.key} title={tooltip}>
              <div className="wl-bar__head">
                <span className="wl-bar__label">{dim.label}</span>
                <span className="wl-bar__value">{dim.score}</span>
              </div>
              <div className="wl-bar__track">
                <div
                  className="wl-bar__fill"
                  style={{ width: `${dim.score}%`, background: scoreColor(dim.score) }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {exemptDoctors.length > 0 && (
        <div className="workload-exempt" title={TEXTS.nightExemptHint}>
          <span className="workload-exempt__badge">{TEXTS.nightExemptBadge}</span>
          <span className="workload-exempt__names">
            {exemptDoctors.map((doctor) => doctor.name).join('、')}
          </span>
        </div>
      )}

      <div className="workload-extremes">
        <div className="workload-extreme">
          <span className="workload-extreme__tag">{TEXTS.workloadHeaviest}</span>
          <span className="workload-extreme__name">{heaviest ? heaviest.name : '—'}</span>
          <span className="workload-extreme__val">{heaviest ? heaviest.burden : ''}</span>
        </div>
        <div className="workload-extreme">
          <span className="workload-extreme__tag">{TEXTS.workloadLightest}</span>
          <span className="workload-extreme__name">{lightest ? lightest.name : '—'}</span>
          <span className="workload-extreme__val">{lightest ? lightest.burden : ''}</span>
        </div>
      </div>
    </section>
  );
});
