/**
 * 移动端「日历主视图」点某天弹起的底部面板：先选医生，再在该医生行上写班次。
 *
 * 与 MobileShiftSheet 的区别：MobileShiftSheet 是「单医生」面板（由医生视角传入已选医生），
 * 本面板内自带医生 chip 选择，适配「一天多医生值班」的日历场景。
 * 写班 / 锁定链路与桌面端完全一致（schedule/setCell、schedule/toggleLock）。
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Doctor, ScheduleEntry, ShiftDefinition, ShiftId } from '../../types/domain';
import { allShiftMetas, resolveShiftMeta, shiftCellStyle } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { parseDateKey } from '../../lib/date';
import { Icon } from '../ui/Icons';

export interface DayShiftSheetProps {
  open: boolean;
  /** 'YYYY-MM-DD' */
  date: string;
  doctors: Doctor[];
  monthSchedule: Record<string, Record<string, ScheduleEntry>>;
  isOnLeave: (doctor: Doctor, date: string) => boolean;
  /** 自定义班次定义（候选项来源） */
  customShifts: readonly ShiftDefinition[];
  /** 选中某医生 + 某班次 */
  onSelect: (doctorId: string, shiftType: ShiftId) => void;
  /** 清空该医生当天格子 */
  onClear: (doctorId: string) => void;
  onToggleLock: (doctorId: string) => void;
  onClose: () => void;
}

export function DayShiftSheet(props: DayShiftSheetProps): React.ReactElement | null {
  const { open, date, doctors, monthSchedule, isOnLeave, customShifts, onSelect, onClear, onToggleLock, onClose } =
    props;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 打开时默认选「当天已有排班」的第一位，否则第一位医生
  useEffect(() => {
    if (!open) {
      return;
    }
    const dayMap = monthSchedule[date] ?? {};
    const firstAssigned = doctors.find((doctor) => dayMap[doctor.id]?.shiftType);
    setSelectedId(firstAssigned?.id ?? doctors[0]?.id ?? null);
  }, [open, date, doctors, monthSchedule]);

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
  const dayMap = monthSchedule[date] ?? {};
  const entry = selectedId ? dayMap[selectedId] : undefined;
  const current = entry?.shiftType;
  const locked = entry?.locked === true;

  return createPortal(
    <div className="shift-sheet" role="dialog" aria-modal="true" aria-label={TEXTS.calSheetTitle(month, day)}>
      <div className="shift-sheet__overlay" onClick={onClose} />
      <div className="shift-sheet__panel shift-sheet--doctor">
        <div className="shift-sheet__grab" aria-hidden="true" />
        <div className="shift-sheet__head">
          <span className="shift-sheet__title">{TEXTS.calSheetTitle(month, day)}</span>
          <button type="button" className="shift-sheet__close" aria-label={TEXTS.close} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* 医生选择 chip：标记请假 / 当前班次 */}
        <div className="daysheet__doctors" role="tablist" aria-label={TEXTS.doctorPanelTitle}>
          {doctors.map((doctor) => {
            const e = dayMap[doctor.id];
            const meta = e?.shiftType ? resolveShiftMeta(e.shiftType, customShifts) : null;
            const onLeave = isOnLeave(doctor, date);
            const active = doctor.id === selectedId;
            const style: CSSProperties | undefined = meta ? shiftCellStyle(meta) : undefined;
            return (
              <button
                key={doctor.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'daysheet__chip is-active' : 'daysheet__chip'}
                style={style}
                onClick={() => setSelectedId(doctor.id)}
              >
                <span className="daysheet__chip-name">{doctor.name}</span>
                <span className="daysheet__chip-shift">
                  {meta ? meta.label : onLeave ? TEXTS.cellLeaveMark : TEXTS.cellEmptyMark}
                </span>
              </button>
            );
          })}
        </div>

        {/* 班次网格（复用 .shift-option 视觉） */}
        <div className="shift-sheet__grid">
          {allShiftMetas(customShifts).map((meta) => {
            const selectedShift = current === meta.key;
            const style = shiftCellStyle(meta);
            return (
              <button
                key={meta.key}
                type="button"
                role="option"
                aria-selected={selectedShift}
                className={selectedShift ? 'shift-option is-selected' : 'shift-option'}
                style={style}
                onClick={() => selectedId && onSelect(selectedId, meta.key)}
              >
                <span className="shift-option__short">{meta.short}</span>
                <span className="shift-option__label">{meta.label}</span>
                {selectedShift ? <Icon name="check" size={12} className="shift-option__check" /> : null}
              </button>
            );
          })}
        </div>

        <div className="shift-sheet__foot">
          <button
            type="button"
            className={locked ? 'shift-sheet__action is-active' : 'shift-sheet__action'}
            onClick={() => selectedId && onToggleLock(selectedId)}
            disabled={selectedId === null}
          >
            <Icon name={locked ? 'unlock' : 'lock'} size={14} />
            <span>{locked ? TEXTS.cellUnlock : TEXTS.cellLock}</span>
          </button>
          <button
            type="button"
            className="shift-sheet__action is-danger"
            onClick={() => selectedId && onClear(selectedId)}
            disabled={selectedId === null}
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
