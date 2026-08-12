/**
 * 数字步进器：`− [输入框] +`，用于班次人数、休息天数等整数设置。
 *
 * 输入框用「草稿态」而不是受控回写，理由很实际：
 * 用户想把 12 改成 3，第一步一定是删掉两位数字，中间会经过空串。
 * 如果每次 onChange 都立刻 parse 并回写，空串会被当成 0 强行填回去，
 * 光标跳到末尾，用户越删越乱。所以草稿期间只存字符串，
 * 失焦 / 回车才 parse + 钳制 + 提交；按 Esc 丢弃草稿还原。
 */

import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { IconButton } from './Button';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** 无障碍名，如「周一 白班 最少人数」。必填，纯数字输入框没有名字等于没法用 */
  label: string;
  size?: 'sm' | 'md';
  /** 单位后缀，如「人」「天」 */
  suffix?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Stepper(props: StepperProps): React.ReactElement {
  const {
    value,
    onChange,
    min = 0,
    max = 99,
    step = 1,
    disabled = false,
    label,
    size = 'md',
    suffix,
  } = props;

  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const emit = (next: number): void => {
    const clamped = clamp(Math.round(next), min, max);
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  const commitDraft = (): void => {
    if (draft === null) {
      return;
    }
    const parsed = Number(draft.trim());
    // 空串或非数字：视为放弃编辑，还原原值而不是塞个 0 进去
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      emit(parsed);
    }
    setDraft(null);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(event.target.value.replace(/[^\d-]/g, ''));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setDraft(null);
      emit(value + step);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setDraft(null);
      emit(value - step);
    }
  };

  const display = draft ?? String(value);
  const iconSize = size === 'sm' ? 'sm' : 'md';

  return (
    <div className={`stepper stepper--${size}`} role="group" aria-label={label}>
      <IconButton
        icon="minus"
        label={`${label} 减少`}
        variant="ghost"
        size={iconSize}
        disabled={disabled || value <= min}
        onClick={() => emit(value - step)}
      />
      <input
        ref={inputRef}
        className="stepper__input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        value={display}
        disabled={disabled}
        onChange={onInputChange}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.target.select()}
      />
      {suffix && <span className="stepper__suffix">{suffix}</span>}
      <IconButton
        icon="plus"
        label={`${label} 增加`}
        variant="ghost"
        size={iconSize}
        disabled={disabled || value >= max}
        onClick={() => emit(value + step)}
      />
    </div>
  );
}

/**
 * 区间步进器：一行里放最小值与最大值两个 Stepper。
 * 竞品文案「左侧按钮调最小值，右侧按钮调最大值」描述的就是这个控件，
 * 所以 min 在左、max 在右的顺序不能改。
 */
export function RangeStepper({
  minValue,
  maxValue,
  onChangeMin,
  onChangeMax,
  label,
  bound,
  disabled = false,
}: {
  minValue: number;
  maxValue: number;
  onChangeMin: (value: number) => void;
  onChangeMax: (value: number) => void;
  label: string;
  bound: { min: number; max: number };
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="range-stepper" role="group" aria-label={label}>
      <Stepper
        value={minValue}
        onChange={onChangeMin}
        min={bound.min}
        max={bound.max}
        label={`${label} 最少人数`}
        size="sm"
        disabled={disabled}
      />
      <span className="range-stepper__dash" aria-hidden="true">
        —
      </span>
      <Stepper
        value={maxValue}
        onChange={onChangeMax}
        min={bound.min}
        max={bound.max}
        label={`${label} 最多人数`}
        size="sm"
        disabled={disabled}
      />
    </div>
  );
}
