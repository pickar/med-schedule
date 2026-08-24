/**
 * 轮班预览区（纯 props）。
 *
 * 顶部一排汇总徽标（总天数 / 实际写入 / 跳过），下方逐日列出结果。
 * 每条用班次自身配色（CSS 变量），动作标签区分 写入 / 覆盖 / 锁定 / 请假 / 占用。
 * 列表限高滚动（见 components.css / overlays.css），便于长区间也不撑破弹窗。
 */

import type { ShiftDefinition } from '../../types/domain';
import type { DayAction, ShiftCyclePlan } from '../../core/shiftCycle';
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
}

export function CyclePreview(props: CyclePreviewProps): React.ReactElement {
  const { plan, customShifts } = props;

  if (plan.error !== null) {
    return (
      <div className="shift-cycle-preview">
        <p className="panel-empty panel-empty--tight">{TEXTS.shiftCyclePreviewEmpty}</p>
      </div>
    );
  }

  const { summary, outcomes } = plan;
  const skipped = summary.skipLocked + summary.skipLeave + summary.skipOccupied;

  return (
    <div className="shift-cycle-preview">
      <div className="shift-cycle-summary">
        <span className="badge badge--info">{TEXTS.shiftCycleSummaryTotal(summary.total)}</span>
        <span className="badge badge--success">
          {TEXTS.shiftCycleSummaryEffective(summary.effective)}
        </span>
        {skipped > 0 && (
          <span className="badge badge--muted">{TEXTS.shiftCycleSummarySkipped(skipped)}</span>
        )}
      </div>

      {outcomes.length === 0 ? (
        <p className="panel-empty panel-empty--tight">{TEXTS.shiftCyclePreviewEmpty}</p>
      ) : (
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
      )}
    </div>
  );
}
