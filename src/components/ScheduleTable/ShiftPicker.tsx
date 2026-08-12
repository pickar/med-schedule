/**
 * 班次选择器：点单元格弹出的**锚定浮层**，不是居中弹窗。
 *
 * 为什么必须锚定：改班是高频连续动作，一晚上可能点几十格。
 * 居中 Modal 会让视线在「格子 → 屏幕中央 → 格子」之间来回跳，
 * 而且遮住了周围的排班上下文——恰恰是用户判断「改成什么」的依据。
 * 浮层贴着格子弹，上下文一直在余光里。
 *
 * 定位、越界翻转、点外部关闭、Esc 关闭全部由 `ui/Popover` 承担，
 * 这里只管内容。
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { ScheduleEntry, ShiftType } from '../../types/domain';
import { SHIFT_METAS, SHIFT_ORDER } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { parseDateKey } from '../../lib/date';
import { Popover } from '../ui/Popover';
import { Icon } from '../ui/Icons';

export interface ShiftPickerProps {
  anchor: HTMLElement | null;
  /** 'YYYY-MM-DD' */
  date: string;
  doctorName: string;
  doctorTitle: string;
  entry?: ScheduleEntry;
  /** 传 null 表示清空该格 */
  onSelect: (shiftType: ShiftType | null) => void;
  onToggleLock: () => void;
  onClose: () => void;
}

export function ShiftPicker(props: ShiftPickerProps): React.ReactElement {
  const { anchor, date, doctorName, doctorTitle, entry, onSelect, onToggleLock, onClose } = props;
  const titleId = useId();
  const { month, day } = parseDateKey(date);
  const current = entry?.shiftType;
  const locked = entry?.locked === true;

  return (
    <Popover open anchor={anchor} onClose={onClose} className="shift-picker" labelledBy={titleId}>
      <div className="shift-picker__head">
        <span id={titleId} className="shift-picker__title">
          {TEXTS.pickerTitle(month, day)}
        </span>
        <span className="shift-picker__doctor">
          {doctorName}
          <span className="shift-picker__doctor-title">{doctorTitle}</span>
        </span>
      </div>

      <div className="shift-picker__grid" role="listbox" aria-labelledby={titleId}>
        {SHIFT_ORDER.map((shift) => {
          const meta = SHIFT_METAS[shift];
          const selected = current === shift;
          const style = {
            '--cell-bg': `var(--shift-${shift}-bg)`,
            '--cell-fg': `var(--shift-${shift}-fg)`,
          } as CSSProperties;
          return (
            <button
              key={shift}
              type="button"
              role="option"
              aria-selected={selected}
              className={selected ? 'shift-option is-selected' : 'shift-option'}
              style={style}
              onClick={() => onSelect(shift)}
            >
              <span className="shift-option__short">{meta.short}</span>
              <span className="shift-option__label">{meta.label}</span>
              {selected ? <Icon name="check" size={12} className="shift-option__check" /> : null}
            </button>
          );
        })}
      </div>

      <div className="shift-picker__foot">
        <button
          type="button"
          className={locked ? 'shift-picker__action is-active' : 'shift-picker__action'}
          onClick={onToggleLock}
          disabled={entry === undefined}
        >
          <Icon name={locked ? 'unlock' : 'lock'} size={14} />
          <span>{locked ? TEXTS.cellUnlock : TEXTS.cellLock}</span>
        </button>
        <button
          type="button"
          className="shift-picker__action is-danger"
          onClick={() => onSelect(null)}
          disabled={entry === undefined}
        >
          <Icon name="trash" size={14} />
          <span>{TEXTS.cellClear}</span>
        </button>
      </div>
    </Popover>
  );
}
