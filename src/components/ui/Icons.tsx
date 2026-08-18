/**
 * 图标集：单一 `<Icon>` 组件 + 路径查找表。
 *
 * 为什么不引图标库：本项目零新增依赖，且只用得上二十几个图标，
 * 一张 `d` 属性表比一整个包更省、也更好控制线宽与视觉重量。
 *
 * 约定：
 * - 统一 24×24 viewBox、纯描边（`fill="none"` + `stroke="currentColor"`），
 *   颜色由父级 `color` 决定，不在图标里写死任何色值。
 * - 每个图标压成**一条** path（圆用弧线命令拼），渲染开销最小。
 * - `aria-hidden` 恒为 true：图标一律是装饰件，语义由外层按钮的
 *   `aria-label` / 文本承担。需要独立语义时请在外层补 `<span class="visually-hidden">`。
 */

import type { CSSProperties } from 'react';

const ICON_PATHS = {
  chevronLeft: 'M15 4.5 7.5 12 15 19.5',
  chevronRight: 'M9 4.5 16.5 12 9 19.5',
  chevronDown: 'M4.5 9 12 16.5 19.5 9',
  chevronUp: 'M4.5 15 12 7.5 19.5 15',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5 10 17.5 19 6.5',
  checkCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12.5 10.5 15 16 9.5',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v5.2M12 7.6v.4',
  alert: 'M12 3.6 2.4 20.4h19.2zM12 10v4.4M12 17.4v.4',
  lock: 'M5.5 11h13v9.2h-13zM8.4 11V7.6a3.6 3.6 0 0 1 7.2 0V11',
  unlock: 'M5.5 11h13v9.2h-13zM8.4 11V7.6a3.6 3.6 0 0 1 6.9-1.3',
  undo: 'M4 9h9.5a5 5 0 0 1 0 10H8M4 9l4.2-4.2M4 9l4.2 4.2',
  redo: 'M20 9h-9.5a5 5 0 0 0 0 10H16M20 9l-4.2-4.2M20 9l-4.2 4.2',
  /* 轮班：双箭头循环（左进右出），表「班次序列循环」语义 */
  repeat: 'M7 7h7a3.5 3.5 0 0 1 0 7H8a3.5 3.5 0 0 0 0 7h7M16 4l3 3-3 3M8 20l-3-3 3-3',
  refresh: 'M20.2 12a8 8 0 1 1-2.6-5.9M20.5 3.8v4.4h-4.4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16.2 16.2 21 21',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.8v4.4M9 14.8v4.4',
  download: 'M12 4v11.2M7.8 11l4.2 4.2 4.2-4.2M4 19.6h16',
  print: 'M7 8.4V4h10v4.4M7 16.6H5a1 1 0 0 1-1-1v-5.2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1h-2M7 13.8h10V20H7z',
  sparkles:
    'M10 3.2 11.6 8 16.4 9.6 11.6 11.2 10 16 8.4 11.2 3.6 9.6 8.4 8zM18 14.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z',
  trash: 'M4 7h16M9 7V4.4h6V7M6.4 7l1 13h9.2l1-13M10.4 10.6v6.2M13.6 10.6v6.2',
  edit: 'M4 20h4.2L19.2 9a2.2 2.2 0 0 0-3.1-3.1L5 16.8zM14.8 6.2 18 9.4',
  calendar: 'M4 6.4h16V20H4zM4 10.6h16M8.2 3.4v4M15.8 3.4v4',
  /*
   * 品牌图标：日历 + 医疗十字。前四段与 calendar 完全一致（外框 / 表头线 / 两个挂环），
   * 后两段在表格区画一个居中十字，把「排班」与「医疗」两层语义叠在同一个 24×24 里。
   */
  medcross: 'M4 6.4h16V20H4zM4 10.6h16M8.2 3.4v4M15.8 3.4v4M12 13.2v4.4M9.8 15.4h4.4',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4.4 20a7.6 7.6 0 0 1 15.2 0',
  userPlus: 'M10 4a3.8 3.8 0 1 0 0 7.6A3.8 3.8 0 0 0 10 4M3 20a7 7 0 0 1 14 0M19 7.6v5.2M16.4 10.2h5.2',
  panelLeft: 'M4 5h16v14H4zM10 5v14',
  panelRight: 'M4 5h16v14H4zM14 5v14',
  locate:
    'M19.6 12a7.6 7.6 0 1 1-15.2 0 7.6 7.6 0 0 1 15.2 0M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M12 2.4v2M12 19.6v2M2.4 12h2M19.6 12h2',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6.8V12l3.4 2',
  save: 'M5 4h11l3 3v13H5zM8.4 4v5.6h6.4V4M8.4 14h7.2v6H8.4z',
  loader:
    'M12 3v4M12 17v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M3 12h4M17 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9',
  more: 'M6.2 12h.2M12 12h.2M17.8 12h.2',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export interface IconProps {
  name: IconName;
  /** 边长（px），默认 16 —— 与 --fs-md 行高协调 */
  size?: number;
  /** 描边宽度，小尺寸下可调细避免糊成一团 */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** 持续旋转，用于 loader */
  spin?: boolean;
}

export function Icon(props: IconProps): React.ReactElement {
  const { name, size = 16, strokeWidth = 1.8, className, style, spin = false } = props;
  const classes = ['icon'];
  if (spin) {
    classes.push('icon--spin');
  }
  if (className) {
    classes.push(className);
  }

  return (
    <svg
      className={classes.join(' ')}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** 加载指示器：loader 图标 + 旋转，单独封一层省得到处写 `spin` */
export function Spinner({ size = 16 }: { size?: number }): React.ReactElement {
  return <Icon name="loader" size={size} spin />;
}
