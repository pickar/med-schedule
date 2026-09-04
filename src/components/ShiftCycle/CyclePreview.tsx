/**
 * 轮班预览区（只吃 props，折叠态是组件内部的展示细节）。
 *
 * 顶部一排汇总徽标（总天数 / 实际写入 / 跳过），下方列出结果：
 * - 单医生：直接逐日列出（沿用 v1.3.0 的样子）
 * - 多医生：**按医生分组**，每人一行摘要，点开才渲染该医生的逐日明细
 *
 * 为什么多医生必须折叠：「所有医生 + 整年」= 人数 × 365 天，
 * 一口气铺开是几千个 DOM 节点，弹窗必卡。默认只渲染 N 行摘要，展开谁才渲染谁。
 */

import { useState } from 'react';
import type { Doctor, ShiftDefinition } from '../../types/domain';
import type { DayAction, DayOutcome, ShiftCyclePlan } from '../../core/shiftCycle';
import { resolveShiftMeta, shiftCellStyle } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { formatMD } from '../../lib/date';

const ACTION_LABEL: Record<DayAction, string> = {
  write: TEXTS.shiftCycleActionWrite,
  overwrite: TEXTS.shiftCycleActionOverwrite,
  skipLocked: TEXTS.shiftCycleActionSkipLocked,
  skipLeave: TEXTS.shiftCycleActionSkipLeave,
  skipOccupied: TEXTS.shiftCycleActionSkipOccupied,
};

export interface CyclePreviewProps {
  plan: ShiftCyclePlan;
  customShifts: readonly ShiftDefinition[];
  /** 名册，用于把 doctorId 翻成姓名 */
  doctors: readonly Doctor[];
}

/** 逐日明细列表，单医生视图与分组展开后共用 */
function DayList(props: {
  outcomes: readonly DayOutcome[];
  customShifts: readonly ShiftDefinition[];
}): React.ReactElement {
  const { outcomes, customShifts } = props;
  return (
    <ul className="cycle-preview__list">
      {outcomes.map((outcome) => {
        const meta = resolveShiftMeta(outcome.shiftType, customShifts);
        const style = shiftCellStyle(meta);
        const isSkip = outcome.action !== 'write' && outcome.action !== 'overwrite';
        return (
          <li
            key={outcome.date}
            className={isSkip ? 'cycle-preview__item is-skipped' : 'cycle-preview__item'}
          >
            <span className="cycle-preview__date">{formatMD(outcome.date)}</span>
            <span className="cycle-preview__chip" style={style}>
              {meta.short}
            </span>
            <span className="cycle-preview__shift">{meta.label}</span>
            <span className="cycle-preview__action">{ACTION_LABEL[outcome.action]}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function CyclePreview(props: CyclePreviewProps): React.ReactElement {
  const { plan, customShifts, doctors } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  if (plan.error !== null || plan.perDoctor.length === 0) {
    return (
      <div className="shift-cycle-preview">
        <p className="panel-empty panel-empty--tight">{TEXTS.shiftCyclePreviewEmpty}</p>
      </div>
    );
  }

  const { summary } = plan;
  const skipped = summary.skipLocked + summary.skipLeave + summary.skipOccupied;
  const isBatch = plan.doctorCount > 1;

  const toggle = (doctorId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(doctorId)) {
        next.delete(doctorId);
      } else {
        next.add(doctorId);
      }
      return next;
    });
  };

  return (
    <div className="shift-cycle-preview">
      <div className="shift-cycle-summary">
        <span className="badge badge--info">
          {isBatch
            ? TEXTS.shiftCycleSummaryCells(summary.total)
            : TEXTS.shiftCycleSummaryTotal(summary.total)}
        </span>
        <span className="badge badge--success">
          {isBatch
            ? TEXTS.shiftCycleSummaryEffectiveCells(summary.effective)
            : TEXTS.shiftCycleSummaryEffective(summary.effective)}
        </span>
        {skipped > 0 && (
          <span className="badge badge--muted">{TEXTS.shiftCycleSummarySkipped(skipped)}</span>
        )}
        {isBatch && (
          <span className="badge badge--info">
            {TEXTS.shiftCycleSummaryDoctors(plan.doctorCount)}
          </span>
        )}
      </div>

      {isBatch ? (
        <ul className="cycle-doctor__list">
          {plan.perDoctor.map((doctorPlan) => {
            const doctor = doctors.find((d) => d.id === doctorPlan.doctorId);
            const isOpen = expanded.has(doctorPlan.doctorId);
            // 第 0 天的 seqIndex 就是这位医生的起始位，直接取它的班次当「起始」标签
            const firstShift = doctorPlan.outcomes[0]?.shiftType;
            const startMeta =
              firstShift === undefined ? null : resolveShiftMeta(firstShift, customShifts);
            const doctorSkipped =
              doctorPlan.summary.skipLocked +
              doctorPlan.summary.skipLeave +
              doctorPlan.summary.skipOccupied;

            return (
              <li key={doctorPlan.doctorId} className="cycle-doctor">
                <button
                  type="button"
                  className="cycle-doctor__head"
                  aria-expanded={isOpen}
                  onClick={() => toggle(doctorPlan.doctorId)}
                >
                  <span className="cycle-doctor__caret" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span className="cycle-doctor__name">{doctor?.name ?? doctorPlan.doctorId}</span>
                  {startMeta !== null && (
                    <span className="cycle-doctor__start">
                      {TEXTS.shiftCycleStartAt(startMeta.short)}
                    </span>
                  )}
                  <span className="badge badge--success">
                    {TEXTS.shiftCycleSummaryEffective(doctorPlan.summary.effective)}
                  </span>
                  {doctorSkipped > 0 && (
                    <span className="badge badge--muted">
                      {TEXTS.shiftCycleSummarySkipped(doctorSkipped)}
                    </span>
                  )}
                  <span className="cycle-doctor__toggle">
                    {isOpen ? TEXTS.shiftCycleCollapse : TEXTS.shiftCycleExpand}
                  </span>
                </button>
                {isOpen && (
                  <div className="cycle-doctor__body">
                    <DayList outcomes={doctorPlan.outcomes} customShifts={customShifts} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <DayList outcomes={plan.perDoctor[0]?.outcomes ?? []} customShifts={customShifts} />
      )}
    </div>
  );
}
