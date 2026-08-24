/**
 * 班次图例（可折叠）。
 *
 * 表格里只放得下一个字，图例就是那本字典。默认展开，
 * 用户认熟了可以收起来把纵向空间还给表格——这是常驻界面，寸土必争。
 *
 * 「日=白班　夜=夜班」这句竞品速记必须留着：
 * 「白」和「夜」两个简写里都没有「日」，但排班行话里「上日班」「上夜班」是成对说的，
 * 没有这句对照，老医生第一眼会在图例里找「日」找不到。
 */

import { memo } from 'react';
import type { ShiftDefinition } from '../../types/domain';
import { allShiftMetas, shiftCellStyle } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { Icon } from '../ui/Icons';

export interface ShiftLegendProps {
  expanded: boolean;
  /** 自定义班次定义（图例候选项来源） */
  customShifts: readonly ShiftDefinition[];
  onToggle: () => void;
}

function ShiftLegendBase(props: ShiftLegendProps): React.ReactElement {
  const { expanded, customShifts, onToggle } = props;

  return (
    <section className={expanded ? 'legend is-expanded' : 'legend'} aria-label={TEXTS.legendTitle}>
      <button
        type="button"
        className="legend__toggle"
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? TEXTS.collapse : TEXTS.expand}
      >
        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
        <span className="legend__title">{TEXTS.legendTitle}</span>
        <span className="legend__note">{TEXTS.legendDayNightNote}</span>
      </button>

      {expanded ? (
        <ul className="legend__list">
          {allShiftMetas(customShifts).map((meta) => {
            const style = shiftCellStyle(meta);
            return (
              <li key={meta.key} className="legend__item">
                <span className="legend__chip" style={style}>
                  {meta.short}
                </span>
                <span className="legend__label">{meta.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export const ShiftLegend = memo(ShiftLegendBase);
ShiftLegend.displayName = 'ShiftLegend';
