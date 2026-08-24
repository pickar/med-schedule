/**
 * 单元格 —— 全表最热的组件，一屏 900+ 个实例。
 *
 * ## 三条红线
 *
 * 1. **禁止消费任何 Context**。这里一旦出现 `useAppState()` / `useDerived()`，
 *    三层 Context 拆分立即作废：Context 变更会强制穿透 memo 边界，
 *    改一个格子会把整月 900+ 个格子全部重渲染。数据一律走 props。
 * 2. **props 只收原始类型与稳定引用**。`entry` 靠 reducer 的结构共享保持引用，
 *    `violation` 已由 `rowData.ts` 压成字符串，`onPick` 由父级 `useCallback` 固定。
 * 3. **不做任何派生计算**。班次色走 CSS 变量 `--shift-${key}-bg`，
 *    在样式层解析，组件只负责把 key 拼进变量名。
 */

import { memo, useCallback, useRef } from 'react';
import type { ScheduleEntry, ShiftDefinition } from '../../types/domain';
import type { Severity } from '../../types/validation';
import { resolveShiftMeta, shiftCellStyle } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { formatMD } from '../../lib/date';
import { Icon } from '../ui/Icons';

/** 点击单元格时上报「哪一格 + 锚点元素」，由上层决定弹在哪里 */
export type CellPickHandler = (date: string, doctorId: string, anchor: HTMLElement) => void;

export interface ShiftCellProps {
  date: string;
  doctorId: string;
  /** 仅用于 aria-label，姓名变了本来就该重渲染 */
  doctorName: string;
  entry?: ScheduleEntry;
  /** 违规提示全文（含 detail），已在 rowData 层拼好 */
  violation?: string;
  severity?: Severity;
  isWeekend: boolean;
  isToday: boolean;
  isLeave: boolean;
  /** 洞察面板「定位」过来的目标格 */
  isHighlighted: boolean;
  /** 自定义班次定义（解析显示信息用），引用稳定 */
  customShifts: readonly ShiftDefinition[];
  onPick: CellPickHandler;
}

function ShiftCellBase(props: ShiftCellProps): React.ReactElement {
  const {
    date,
    doctorId,
    doctorName,
    entry,
    violation,
    severity,
    isWeekend,
    isToday,
    isLeave,
    isHighlighted,
    customShifts,
    onPick,
  } = props;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const handleClick = useCallback((): void => {
    if (buttonRef.current !== null) {
      onPick(date, doctorId, buttonRef.current);
    }
  }, [onPick, date, doctorId]);

  const shiftType = entry?.shiftType;
  const meta = shiftType ? resolveShiftMeta(shiftType, customShifts) : null;

  const classes = ['cell'];
  if (meta === null) {
    classes.push('is-empty');
  }
  if (isWeekend) {
    classes.push('is-weekend');
  }
  if (isToday) {
    classes.push('is-today');
  }
  if (violation !== undefined) {
    classes.push('is-violation');
  }
  if (isHighlighted) {
    classes.push('is-highlighted');
  }
  if (isLeave) {
    classes.push('is-leave');
  }

  // 班次配色通过局部自定义属性下发，样式表只认 --cell-bg / --cell-fg 两个入口。
  // 内置走 CSS 变量（--shift-${key}-bg），自定义走字面色，由 shiftCellStyle 统一决定。
  const style = shiftType && meta ? shiftCellStyle(meta) : undefined;

  const notes: string[] = [meta ? meta.label : TEXTS.cellEmptyMark];
  if (entry?.isRotation) {
    notes.push(TEXTS.cellRotationMark);
  }
  if (entry?.manual) {
    notes.push(TEXTS.cellManualMark);
  }
  if (entry?.locked) {
    notes.push(TEXTS.cellLocked);
  }
  if (isLeave) {
    notes.push(TEXTS.cellLeaveMark);
  }
  const summary = notes.join(' · ');
  const title = violation === undefined ? summary : `${summary}\n${violation}`;

  return (
    <td className={classes.join(' ')} data-severity={severity} style={style}>
      <button
        ref={buttonRef}
        type="button"
        className="cell__hit"
        onClick={handleClick}
        title={title}
        aria-label={`${doctorName} ${formatMD(date)} ${summary}`}
      >
        <span className="cell__text">{meta ? meta.short : ''}</span>
        {entry?.isRotation ? <span className="cell__rotation" aria-hidden="true" /> : null}
        {entry?.manual ? <span className="cell__manual" aria-hidden="true" /> : null}
        {entry?.locked ? <Icon name="lock" size={9} strokeWidth={2.4} className="cell__lock" /> : null}
        {violation === undefined ? null : <span className="cell__flag" aria-hidden="true" />}
      </button>
    </td>
  );
}

/**
 * `React.memo` 的默认浅比较对本组件是足够的：
 * 全部 props 要么是原始类型，要么是被结构共享 / rowData 固定住的引用。
 */
export const ShiftCell = memo(ShiftCellBase);
ShiftCell.displayName = 'ShiftCell';
