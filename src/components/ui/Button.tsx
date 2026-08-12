/**
 * 按钮：五种视觉变体 × 三档尺寸，支持前后置图标与 loading。
 *
 * 两个容易被忽略但必须内建的行为：
 * 1. `type` 默认 `"button"`。React 里忘了写 type 的按钮放进 `<form>` 会触发提交，
 *    表现为「点了取消，页面刷新了」，属于事后极难定位的一类 bug。
 * 2. `loading` 时同时置 `disabled` 与 `aria-busy`，并**保留原文案宽度**
 *    （图标替换而非追加），避免按钮在加载态突然变宽把旁边的按钮挤走。
 */

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import type { IconName } from './Icons';
import { Icon } from './Icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 前置图标 */
  icon?: IconName;
  /** 后置图标，通常是 chevronDown 之类的下拉指示 */
  trailingIcon?: IconName;
  loading?: boolean;
  /** 撑满父容器宽度 */
  block?: boolean;
  /** 按下 / 激活态，用于 toggle 型按钮，会同步写 aria-pressed */
  active?: boolean;
  children?: ReactNode;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export const Button = forwardRef(function Button(
  props: ButtonProps,
  ref: Ref<HTMLButtonElement>,
): React.ReactElement {
  const {
    variant = 'secondary',
    size = 'md',
    icon,
    trailingIcon,
    loading = false,
    block = false,
    active,
    children,
    className,
    disabled,
    type,
    ...rest
  } = props;

  const iconSize = ICON_SIZE[size];
  const classes = ['btn', `btn--${variant}`, `btn--${size}`];
  if (block) {
    classes.push('btn--block');
  }
  if (children === undefined) {
    classes.push('btn--icon-only');
  }
  if (active) {
    classes.push('is-active');
  }
  if (loading) {
    classes.push('is-loading');
  }
  if (className) {
    classes.push(className);
  }

  return (
    <button
      ref={ref}
      {...rest}
      type={type ?? 'button'}
      className={classes.join(' ')}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      aria-pressed={active}
    >
      {loading ? (
        <Icon name="loader" size={iconSize} spin />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {children !== undefined && <span className="btn__label">{children}</span>}
      {trailingIcon && !loading && <Icon name={trailingIcon} size={iconSize} />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'trailingIcon'> {
  icon: IconName;
  /** 纯图标按钮**必须**有无障碍名，这里设为必填而不是可选 */
  label: string;
}

/**
 * 纯图标按钮。把 `aria-label` 提升为必填参数，
 * 靠类型系统堵住「图标按钮读屏时只念得出 button」这个最常见的无障碍缺陷。
 */
export function IconButton(props: IconButtonProps): React.ReactElement {
  const { label, title, ...rest } = props;
  return <Button {...rest} aria-label={label} title={title ?? label} />;
}

/** 按钮组：多个按钮首尾相接成一条，用于「上月 / 今天 / 下月」这类联排控件 */
export function ButtonGroup({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}): React.ReactElement {
  return (
    <div
      className={className ? `btn-group ${className}` : 'btn-group'}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
