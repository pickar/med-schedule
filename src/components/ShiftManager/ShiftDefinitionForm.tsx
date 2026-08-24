/**
 * 单个班次定义的增 / 编表单（纯组件，无状态副作用）。
 *
 * 设计口径（见 `docs/feat-shift-custom/system_design.md` §1.1 / Q5）：
 * - 名称 1~8 字、简写 1~3 字；颜色一律 `#RRGGBB`。
 * - 文字色 `fg` 由背景色 `bg` 的亮度自动推导（浅底深字 / 深底白字），
 *   保证表格里看得清，用户无需手动挑两色。
 * - 起止时间可选、仅作展示，不影响统计（Q1 默认）。
 * - `autoAssignable` 默认 false（Q4 默认）。
 *
 * 表单是受控草稿：仅在「保存」时落库，避免每一次按键都进撤销栈。
 */

import { useMemo, useState } from 'react';
import type { ShiftDefinition } from '../../types/domain';
import { createPrefixedId } from '../../lib/id';
import { SHIFT_PALETTE } from '../../constants/shifts';
import { TEXTS } from '../../constants/texts';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';

const NAME_MAX = 8;
const SHORT_MAX = 3;

export interface ShiftDefinitionFormProps {
  /** null 表示新增；否则为待编辑的已有定义 */
  initial: ShiftDefinition | null;
  /** 引用计数（仅展示，不可编辑） */
  usedCount: number;
  /** 已达自定义数量上限，禁用保存 */
  maxReached: boolean;
  onSubmit: (def: ShiftDefinition) => void;
  onCancel: () => void;
}

/** 由背景色推导可读文字色：亮度高用深色，否则白字（满足 WCAG AA 简版） */
function pickReadableTextColor(bg: string): string {
  const hex = bg.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const channel = (slice: number): number => parseInt(full.slice(slice, slice + 2), 16) / 255;
  const toLinear = (v: number): number =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const r = toLinear(channel(0));
  const g = toLinear(channel(2));
  const b = toLinear(channel(4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#3E2723' : '#FFFFFF';
}

function emptyDraft(): Pick<ShiftDefinition, 'bg' | 'isWork' | 'autoAssignable'> {
  return { bg: SHIFT_PALETTE[0], isWork: true, autoAssignable: false };
}

export function ShiftDefinitionForm(props: ShiftDefinitionFormProps): React.ReactElement {
  const { initial, usedCount, maxReached, onSubmit, onCancel } = props;

  const [label, setLabel] = useState<string>(initial?.label ?? '');
  const [short, setShort] = useState<string>(initial?.short ?? '');
  const [bg, setBg] = useState<string>(initial?.bg ?? emptyDraft().bg);
  const [isWork, setIsWork] = useState<boolean>(initial?.isWork ?? true);
  const [autoAssignable, setAutoAssignable] = useState<boolean>(
    initial?.autoAssignable ?? false,
  );
  const [startTime, setStartTime] = useState<string>(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState<string>(initial?.endTime ?? '');

  const fg = useMemo(() => pickReadableTextColor(bg), [bg]);

  const trimmedLabel = label.trim();
  const trimmedShort = short.trim();
  const nameError = trimmedLabel.length === 0 || trimmedLabel.length > NAME_MAX;
  const shortError = trimmedShort.length === 0 || trimmedShort.length > SHORT_MAX;
  const timeError = startTime !== '' && endTime !== '' && startTime >= endTime;
  const hasError = nameError || shortError || timeError || maxReached;

  const handleSubmit = (): void => {
    if (hasError) {
      return;
    }
    const def: ShiftDefinition = {
      id: initial?.id ?? createPrefixedId('shift'),
      label: trimmedLabel,
      short: trimmedShort,
      bg,
      fg,
      isWork,
      autoAssignable,
      // 编辑内置班次时保留其 isBuiltin 标记，不把它偷偷变成「自定义」
      isBuiltin: initial?.isBuiltin ?? false,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
    };
    onSubmit(def);
  };

  const previewStyle = { background: bg, color: fg } as const;

  return (
    <div className="shift-form">
      <div className="shift-form__preview" style={previewStyle}>
        <span className="shift-form__preview-short">{trimmedShort || '简'}</span>
        <span className="shift-form__preview-label">{trimmedLabel || '班次名称'}</span>
      </div>

      <label className="field">
        <span className="field__label">{TEXTS.shiftManagerFormName}</span>
        <input
          className="text-input"
          type="text"
          autoComplete="off"
          maxLength={NAME_MAX}
          value={label}
          placeholder={TEXTS.shiftManagerFormNameHint}
          onChange={(event) => setLabel(event.target.value)}
        />
        <span className="field__hint">
          {TEXTS.shiftManagerFormNameHint}
          {nameError && <span className="field__error"> · {TEXTS.shiftManagerFormNameInvalid}</span>}
        </span>
      </label>

      <label className="field">
        <span className="field__label">{TEXTS.shiftManagerFormShort}</span>
        <input
          className="text-input"
          type="text"
          autoComplete="off"
          maxLength={SHORT_MAX}
          value={short}
          placeholder={TEXTS.shiftManagerFormShortHint}
          onChange={(event) => setShort(event.target.value)}
        />
        <span className="field__hint">
          {TEXTS.shiftManagerFormShortHint}
          {shortError && (
            <span className="field__error"> · {TEXTS.shiftManagerFormShortInvalid}</span>
          )}
        </span>
      </label>

      <div className="field">
        <span className="field__label">{TEXTS.shiftManagerFormColor}</span>
        <div className="color-palette" role="radiogroup" aria-label={TEXTS.shiftManagerFormColor}>
          {SHIFT_PALETTE.map((color, index) => {
            const active = color.toLowerCase() === bg.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${TEXTS.shiftManagerFormColor} ${index + 1}`}
                className={active ? 'color-swatch is-active' : 'color-swatch'}
                style={{ background: color }}
                onClick={() => setBg(color)}
              />
            );
          })}
        </div>
        <label className="color-custom">
          <input
            type="color"
            value={bg}
            aria-label={TEXTS.shiftManagerFormColor}
            onChange={(event) => setBg(event.target.value)}
          />
          <span className="field__hint">{TEXTS.shiftManagerFormColorHint}</span>
        </label>
      </div>

      <Switch
        checked={isWork}
        label={TEXTS.shiftManagerFormIsWork}
        description={TEXTS.shiftManagerFormIsWorkHint}
        onChange={setIsWork}
      />

      <Switch
        checked={autoAssignable}
        label={TEXTS.shiftManagerFormAuto}
        description={TEXTS.shiftManagerFormAutoHint}
        onChange={setAutoAssignable}
      />

      <div className="field-row">
        <label className="field">
          <span className="field__label">{TEXTS.shiftManagerFormStartTime}</span>
          <input
            className="text-input"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{TEXTS.shiftManagerFormEndTime}</span>
          <input
            className="text-input"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </label>
      </div>
      {timeError && <p className="field__error">{TEXTS.shiftManagerFormTimeInvalid}</p>}
      <p className="field__hint">{TEXTS.shiftManagerFormTimeHint}</p>

      <div className="shift-form__actions">
        <Button variant="ghost" onClick={onCancel}>
          {TEXTS.cancel}
        </Button>
        <Button variant="primary" icon="check" disabled={hasError} onClick={handleSubmit}>
          {TEXTS.save}
        </Button>
      </div>

      {usedCount > 0 && (
        <p className="shift-form__usage">{TEXTS.shiftManagerUsedCount(usedCount)}</p>
      )}
    </div>
  );
}
