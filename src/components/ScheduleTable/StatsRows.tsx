/**
 * 底部统计行（`<tfoot>`，sticky 吸底）。
 *
 * 收起态只看门诊 / 白班 / 夜班三行，展开后铺满 11 种班次。
 * 展开与收起**不触发任何重算**：`computeDailyStats()` 一次就把 11 种都算好了，
 * 这里纯粹是显示切换。
 *
 * 白班 / 夜班配了人数区间，越界要当场标红/标黄——这是排班表最值钱的一列信息，
 * 用户扫一眼底部就知道今天缺不缺人。
 */

import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { ShiftType } from '../../types/domain';
import type { DailyStat, RangedStat } from '../../core/stats';
import { PRIMARY_STAT_SHIFTS, SHIFT_METAS, SHIFT_ORDER } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { Icon } from '../ui/Icons';

export interface StatsRowsProps {
  dates: readonly string[];
  weekendFlags: readonly boolean[];
  todayDate: string;
  statsByDate: Record<string, DailyStat>;
  expanded: boolean;
  onToggle: () => void;
  /** 派生数据还停在上个月（useDeferredValue 尚未跟上）时置灰，避免展示错值 */
  stale: boolean;
}

/** 取该班次在当天的越界状态，未配区间的班次恒为 none */
function rangeOf(stat: DailyStat | undefined, shift: ShiftType): RangedStat | null {
  if (stat === undefined) {
    return null;
  }
  if (shift === 'dayShift') {
    return stat.dayShift;
  }
  if (shift === 'nightShift') {
    return stat.nightShift;
  }
  return null;
}

function StatsRowsBase(props: StatsRowsProps): React.ReactElement {
  const { dates, weekendFlags, todayDate, statsByDate, expanded, onToggle, stale } = props;
  const shifts: readonly ShiftType[] = expanded ? SHIFT_ORDER : PRIMARY_STAT_SHIFTS;
  const footClasses = stale ? 'table__foot is-stale' : 'table__foot';

  const dayClass = (index: number, date: string, extra?: string): string => {
    const classes = ['table__stat'];
    if (weekendFlags[index]) {
      classes.push('is-weekend');
    }
    if (date === todayDate) {
      classes.push('is-today');
    }
    if (extra !== undefined) {
      classes.push(extra);
    }
    return classes.join(' ');
  };

  return (
    <tfoot className={footClasses}>
      <tr className="table__stat-row table__stat-row--total">
        <th scope="row" className="table__stat-label">
          <span className="table__stat-name">{TEXTS.statsRowLabel}</span>
          <button
            type="button"
            className="table__stat-toggle"
            onClick={onToggle}
            title={expanded ? TEXTS.statsCollapse : TEXTS.statsExpand}
            aria-label={expanded ? TEXTS.statsCollapse : TEXTS.statsExpand}
            aria-expanded={expanded}
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronUp'} size={13} />
          </button>
        </th>
        {dates.map((date, index) => (
          <td key={date} className={dayClass(index, date)} title={TEXTS.statsWorkTotal}>
            {stale ? '' : (statsByDate[date]?.workTotal ?? 0)}
          </td>
        ))}
        <td className="table__rest" />
        <td className="table__rest" />
      </tr>

      {shifts.map((shift) => {
        const meta = SHIFT_METAS[shift];
        const chipStyle = {
          '--cell-bg': `var(--shift-${shift}-bg)`,
          '--cell-fg': `var(--shift-${shift}-fg)`,
        } as CSSProperties;
        return (
          <tr key={shift} className="table__stat-row">
            <th scope="row" className="table__stat-label">
              <span className="table__stat-chip" style={chipStyle}>
                {meta.short}
              </span>
              <span className="table__stat-name">{meta.label}</span>
            </th>
            {dates.map((date, index) => {
              const stat = statsByDate[date];
              const ranged = rangeOf(stat, shift);
              const status = ranged === null ? 'none' : ranged.status;
              const extra = status === 'below' || status === 'above' ? `is-${status}` : undefined;
              const count = stat?.counts[shift] ?? 0;
              return (
                <td
                  key={date}
                  className={dayClass(index, date, extra)}
                  title={ranged === null ? undefined : `${meta.label} ${ranged.count}/${ranged.min}-${ranged.max} 人`}
                >
                  {stale ? '' : count || ''}
                </td>
              );
            })}
            <td className="table__rest" />
            <td className="table__rest" />
          </tr>
        );
      })}
    </tfoot>
  );
}

export const StatsRows = memo(StatsRowsBase);
StatsRows.displayName = 'StatsRows';
