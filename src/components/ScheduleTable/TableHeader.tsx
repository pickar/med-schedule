/**
 * 冻结表头：左上角「医生」+ 当月每一天（日 + 星期）+ 右上角「应休 / 实休」。
 *
 * 三处 sticky 的层级关系必须记牢（值见 tokens.css）：
 * - 日期列头   `--z-table-sticky-head: 3`
 * - 左上角 / 右上角交叉格 `--z-table-corner: 4`
 * 交叉格若不高于列头，横向滚动时冻结列会盖住表头文字；
 * 反之纵向滚动时表头会被首列压掉——两个方向都得靠这个梯度撑住。
 */

import { memo } from 'react';
import { WEEKDAY_NAMES } from '../../constants/palette';
import { TEXTS } from '../../constants/texts';
import { getWeekday, parseDateKey } from '../../lib/date';

export interface TableHeaderProps {
  dates: readonly string[];
  weekendFlags: readonly boolean[];
  todayDate: string;
}

function TableHeaderBase(props: TableHeaderProps): React.ReactElement {
  const { dates, weekendFlags, todayDate } = props;

  return (
    <thead className="table__head">
      <tr>
        <th scope="col" className="table__corner">
          {TEXTS.columnDoctor}
        </th>

        {dates.map((date, index) => {
          const classes = ['table__day'];
          if (weekendFlags[index]) {
            classes.push('is-weekend');
          }
          if (date === todayDate) {
            classes.push('is-today');
          }
          return (
            <th key={date} scope="col" className={classes.join(' ')}>
              <span className="table__day-num">{parseDateKey(date).day}</span>
              <span className="table__day-week">{WEEKDAY_NAMES[getWeekday(date)]}</span>
            </th>
          );
        })}

        <th scope="col" className="table__rest-head">
          {TEXTS.columnShouldRest}
        </th>
        <th scope="col" className="table__rest-head">
          {TEXTS.columnActualRest}
        </th>
      </tr>
    </thead>
  );
}

export const TableHeader = memo(TableHeaderBase);
TableHeader.displayName = 'TableHeader';
