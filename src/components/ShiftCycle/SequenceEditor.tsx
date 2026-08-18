/**
 * 班次序列编辑器（纯 props）。
 *
 * 由容器 `ShiftCycleModal` 管草稿，这里只负责「把 sequence 画出来 + 把操作回传」。
 * 序列可追加全部 11 种班次（含 autoAssignable=false 的 4 种，轮班本就是手动规划）。
 * 每个 chip 用班次自身配色（CSS 变量 --shift-${key}-bg/fg，与 ShiftPicker 同口径），
 * 不写死任何字面色值。上移/下移/删除走 ui/IconButton，不用拖拽库。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ShiftType } from '../../types/domain';
import { SHIFT_METAS, SHIFT_ORDER } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { Button, IconButton } from '../ui/Button';

export interface SequenceEditorProps {
  sequence: ShiftType[];
  onChange: (next: ShiftType[]) => void;
}

export function SequenceEditor(props: SequenceEditorProps): React.ReactElement {
  const { sequence, onChange } = props;
  const [appendKey, setAppendKey] = useState<ShiftType>('dayShift');

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= sequence.length) {
      return;
    }
    const next = [...sequence];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const removeAt = (index: number): void => {
    onChange(sequence.filter((_, i) => i !== index));
  };

  const append = (): void => {
    onChange([...sequence, appendKey]);
  };

  return (
    <div className="sequence-editor">
      {sequence.length === 0 ? (
        <p className="panel-empty panel-empty--tight">{TEXTS.shiftCycleEmptySequence}</p>
      ) : (
        <ul className="sequence-chips">
          {sequence.map((shift, index) => {
            const meta = SHIFT_METAS[shift];
            const style = {
              '--cell-bg': `var(--shift-${shift}-bg)`,
              '--cell-fg': `var(--shift-${shift}-fg)`,
            } as CSSProperties;
            return (
              <li key={`${shift}-${index}`} className="sequence-chip" style={style}>
                <span className="sequence-chip__index">{index + 1}</span>
                <span className="sequence-chip__short">{meta.short}</span>
                <span className="sequence-chip__label">{meta.label}</span>
                <span className="sequence-chip__actions">
                  <IconButton
                    icon="chevronUp"
                    label={TEXTS.shiftCycleMoveUp}
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <IconButton
                    icon="chevronDown"
                    label={TEXTS.shiftCycleMoveDown}
                    variant="ghost"
                    size="sm"
                    disabled={index === sequence.length - 1}
                    onClick={() => move(index, 1)}
                  />
                  <IconButton
                    icon="trash"
                    label={TEXTS.shiftCycleRemove}
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAt(index)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sequence-append">
        <select
          className="select-input"
          value={appendKey}
          aria-label={TEXTS.shiftCycleAddShift}
          onChange={(event) => setAppendKey(event.target.value as ShiftType)}
        >
          {SHIFT_ORDER.map((shift) => (
            <option key={shift} value={shift}>
              {SHIFT_METAS[shift].label}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" icon="plus" onClick={append}>
          {TEXTS.shiftCycleAddShift}
        </Button>
      </div>
    </div>
  );
}
