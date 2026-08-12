/**
 * 开关：规则页与医生约束里的所有布尔项都用它。
 *
 * 实现选型说明：用 `<button role="switch" aria-checked>` 而不是
 * `<input type="checkbox">` + 伪元素。后者要靠 `appearance: none` 和一堆
 * 兄弟选择器画外观，还得单独补 label 关联；前者天生可聚焦、可回车触发，
 * 无障碍名直接由按钮内的文本承担，少一层出错空间。
 *
 * 整行（轨道 + 文字）都在按钮内部，所以点文字也能切换——
 * 开关的可点区域只有 36px 宽的轨道，是最常见的手感投诉来源。
 */

import type { ReactNode } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 主文案 */
  label: ReactNode;
  /** 次级说明，灰色小字 */
  description?: ReactNode;
  disabled?: boolean;
  /** 轨道放右侧（默认）还是左侧 */
  align?: 'start' | 'end';
  className?: string;
}

export function Switch(props: SwitchProps): React.ReactElement {
  const {
    checked,
    onChange,
    label,
    description,
    disabled = false,
    align = 'end',
    className,
  } = props;

  const classes = ['switch', `switch--${align}`];
  if (checked) {
    classes.push('is-checked');
  }
  if (disabled) {
    classes.push('is-disabled');
  }
  if (className) {
    classes.push(className);
  }

  const track = (
    <span className="switch__track" aria-hidden="true">
      <span className="switch__thumb" />
    </span>
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={classes.join(' ')}
      onClick={() => onChange(!checked)}
    >
      {align === 'start' && track}
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {description && <span className="switch__description">{description}</span>}
      </span>
      {align === 'end' && track}
    </button>
  );
}

/**
 * 复选标签组：固定门诊日（周一~周日）这类多选场景。
 * 与 Switch 同源的视觉语言，避免规则页出现两套勾选风格。
 */
export function ToggleChip({
  checked,
  onChange,
  children,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      className={checked ? 'toggle-chip is-checked' : 'toggle-chip'}
      onClick={() => onChange(!checked)}
    >
      {children}
    </button>
  );
}
