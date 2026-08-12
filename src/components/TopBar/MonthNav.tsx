/**
 * 月份导航：上月 / 今天 / 下月 + 月份标签 + 「有数据月」快速跳转。
 *
 * 各月排班彼此独立，用户很容易忘了自己在哪个月、也想不起来哪几个月排过。
 * 所以月份标签本身是个下拉：点开就是**已有排班数据的月份**清单，
 * 每条前面一个圆点。当前月有数据时标签旁也点一个，一眼可辨。
 *
 * 纯 props 组件（不碰 Context），由 TopBar 传入数据与回调。
 */

import { memo, useRef, useState } from 'react';
import { Button, ButtonGroup, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { MenuItem, Popover, PopoverMenu } from '../ui/Popover';
import { TEXTS } from '../../constants/texts';
import { currentMonthKey, formatMonthLabel, shiftMonth } from '../../lib/date';

export interface MonthNavProps {
  /** 'YYYY-MM' */
  month: string;
  /** 已有排班数据的月份（升序） */
  monthsWithData: readonly string[];
  onChange: (month: string) => void;
}

export const MonthNav = memo(function MonthNav(props: MonthNavProps): React.ReactElement {
  const { month, monthsWithData, onChange } = props;
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const hasData = monthsWithData.includes(month);

  const jump = (target: string): void => {
    setOpen(false);
    onChange(target);
  };

  return (
    <div className="month-nav">
      <ButtonGroup ariaLabel="月份切换">
        <IconButton
          icon="chevronLeft"
          label={TEXTS.prevMonth}
          variant="secondary"
          onClick={() => onChange(shiftMonth(month, -1))}
        />
        <Button variant="secondary" onClick={() => onChange(currentMonthKey())}>
          {TEXTS.todayButton}
        </Button>
        <IconButton
          icon="chevronRight"
          label={TEXTS.nextMonth}
          variant="secondary"
          onClick={() => onChange(shiftMonth(month, 1))}
        />
      </ButtonGroup>

      <button
        ref={anchorRef}
        type="button"
        className="month-nav__label"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <strong>{formatMonthLabel(month)}</strong>
        {hasData && <span className="month-nav__dot" title={TEXTS.monthHasData} />}
        <Icon name="chevronDown" size={14} />
      </button>

      <Popover
        open={open}
        anchor={anchorRef.current}
        onClose={() => setOpen(false)}
        placement="bottom-start"
        role="menu"
      >
        <div className="popover-menu__title">{TEXTS.monthPickerTitle}</div>
        <PopoverMenu>
          {monthsWithData.length === 0 ? (
            <p className="popover-menu__empty">{TEXTS.monthPickerEmpty}</p>
          ) : (
            monthsWithData.map((item) => (
              <MenuItem
                key={item}
                onClick={() => jump(item)}
                icon={<span className="month-nav__dot" aria-hidden="true" />}
              >
                {formatMonthLabel(item)}
              </MenuItem>
            ))
          )}
        </PopoverMenu>
      </Popover>
    </div>
  );
});
