/**
 * 医生行：冻结首列（姓名 + 职称）+ 当月每一天 + 右侧应休 / 实休。
 *
 * 与 `ShiftCell` 一样**禁止消费任何 Context**。
 *
 * 这里有个容易踩的坑：`DoctorStat` 每次 `computeDerived()` 都是新对象，
 * 整个传进来会让 15 行全部重渲染。所以只收 `shouldRest` / `actualRest` 等
 * **散开的数字**——数值没变，memo 就能挡住。
 */

import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { Doctor, ShiftDefinition } from '../../types/domain';
import { TITLE_SHORT } from '../../constants/palette';
import { TEXTS } from '../../constants/texts';
import type { CellPickHandler } from './ShiftCell';
import { ShiftCell } from './ShiftCell';
import type { DoctorRowData } from './rowData';

export interface DoctorRowProps {
  doctor: Doctor;
  dates: readonly string[];
  weekendFlags: readonly boolean[];
  /** 'YYYY-MM-DD'，与列日期相等即为今天 */
  todayDate: string;
  row: DoctorRowData;
  shouldRest: number;
  actualRest: number;
  postNightCount: number;
  restGap: number;
  /** 该行被「定位」高亮的日期；本行没有高亮格时为 undefined */
  highlightDate?: string;
  /** 整行高亮（洞察面板按医生定位） */
  isHighlightedRow: boolean;
  /** 自定义班次定义（透传给 ShiftCell） */
  customShifts: readonly ShiftDefinition[];
  onPick: CellPickHandler;
}

function DoctorRowBase(props: DoctorRowProps): React.ReactElement {
  const {
    doctor,
    dates,
    weekendFlags,
    todayDate,
    row,
    shouldRest,
    actualRest,
    postNightCount,
    restGap,
    highlightDate,
    isHighlightedRow,
    customShifts,
    onPick,
  } = props;

  const rowClasses = ['table__row'];
  if (isHighlightedRow) {
    rowClasses.push('is-highlighted');
  }
  const dotStyle = { '--doctor-color': doctor.color } as CSSProperties;

  return (
    <tr className={rowClasses.join(' ')}>
      <th scope="row" className="table__doctor">
        <span className="table__doctor-dot" style={dotStyle} aria-hidden="true" />
        <span className="table__doctor-name" title={doctor.name}>
          {doctor.name}
        </span>
        <span className="table__doctor-title">{TITLE_SHORT[doctor.title]}</span>
      </th>

      {dates.map((date, index) => (
        <ShiftCell
          key={date}
          date={date}
          doctorId={doctor.id}
          doctorName={doctor.name}
          entry={row.entries[index]}
          violation={row.violations[index]}
          severity={row.severities[index]}
          isWeekend={weekendFlags[index]}
          isToday={date === todayDate}
          isLeave={row.leaves[index]}
          isHighlighted={date === highlightDate}
          customShifts={customShifts}
          onPick={onPick}
        />
      ))}

      <td className="table__rest">{shouldRest}</td>
      <td
        className={restGap > 0 ? 'table__rest is-short' : 'table__rest'}
        title={TEXTS.actualRestTooltip(actualRest, postNightCount)}
      >
        {actualRest}
      </td>
    </tr>
  );
}

export const DoctorRow = memo(DoctorRowBase);
DoctorRow.displayName = 'DoctorRow';
