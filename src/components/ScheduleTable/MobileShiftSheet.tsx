/**
 * 移动端底部面板（bottom sheet）：点某天弹起，列出 11 种班次 + 锁定 + 清空。
 *
 * 复用 ShiftPicker 的班次渲染样式（.shift-option / --cell-bg·--cell-fg）。
 * 写班走 schedule/setCell（进撤销栈），锁定走 schedule/toggleLock，与桌面端同一条链路。
 */

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ScheduleEntry, ShiftType } from '../../types/domain';
import { SHIFT_METAS, SHIFT_ORDER } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { parseDateKey } from '../../lib/date';
import { Icon } from '../ui/Icons';

export interface MobileShiftSheetProps {
  open: boolean;
  /** 'YYYY-MM-DD' */
  date: string;
  doctorName: string;
  doctorTitle: string;
  entry?: ScheduleEntry;
  /** 选中某班次 */
  onSelect: (shiftType: ShiftType) => void;
  /** 清空该格 */
  onClear: () => void;
  onToggleLock: () => void;
  onClose: () => void;
}

export function MobileShiftSheet(props: MobileShiftSheetProps): React.ReactElement | null {
  const { open, date, doctorName, doctorTitle, entry, onSelect, onClear, onToggleLock, onClose } = props;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const { month, day } = parseDateKey(date);
  const current = entry?.shiftType;
  const locked = entry?.locked === true;

  return createPortal(
    <div className="shift-sheet" role="dialog" aria-modal="true" aria-label={TEXTS.pickerTitle(month, day)}>
      <div className="shift-sheet__overlay" onClick={onClose} />
      <div className="shift-sheet__panel">
        <div className="shift-sheet__grab" aria-hidden="true" />
        <div className="shift-sheet__head">
          <span className="shift-sheet__title">{TEXTS.pickerTitle(month, day)}</span>
          <span className="shift-sheet__doctor">
            {doctorName}
            {doctorTitle ? <span className="shift-sheet__doctor-title">{doctorTitle}</span> : null}
          </span>
          <button type="button" className="shift-sheet__close" aria-label={TEXTS.close} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="shift-sheet__grid">
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

        <div className="shift-sheet__foot">
          <button
            type="button"
            className={locked ? 'shift-sheet__action is-active' : 'shift-sheet__action'}
            onClick={onToggleLock}
            disabled={entry === undefined}
          >
            <Icon name={locked ? 'unlock' : 'lock'} size={14} />
            <span>{locked ? TEXTS.cellUnlock : TEXTS.cellLock}</span>
          </button>
          <button
            type="button"
            className="shift-sheet__action is-danger"
            onClick={onClear}
            disabled={entry === undefined}
          >
            <Icon name="trash" size={14} />
            <span>{TEXTS.cellClear}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
