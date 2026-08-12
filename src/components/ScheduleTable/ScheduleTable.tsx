/**
 * 排班表装配层：图例 + 冻结表头 + 医生行 + 底部统计 + 班次选择器。
 *
 * 这一层**只吃 props**，不碰 Context（Context 由 `layout/MainArea` 消费后下发）。
 * 它自己唯一持有的状态是「选择器开在哪一格」——那是纯展示状态，
 * 放进全局 store 只会让每次开关浮层都惊动整棵树。
 *
 * 注意 `onPick` 必须是**恒定引用**：它要一路传到 900+ 个 `ShiftCell`，
 * 一旦每次渲染都换新函数，`React.memo` 就全线失守。
 */

import { useCallback, useMemo, useState } from 'react';
import type { Doctor, ShiftType } from '../../types/domain';
import type { CellRef } from '../../types/state';
import type { DailyStat, DoctorStat } from '../../core/stats';
import { TEXTS } from '../../constants/texts';
import { TITLE_SHORT } from '../../constants/palette';
import { DoctorRow } from './DoctorRow';
import { EmptyState } from './EmptyState';
import { ShiftLegend } from './ShiftLegend';
import { ShiftPicker } from './ShiftPicker';
import { StatsRows } from './StatsRows';
import { TableHeader } from './TableHeader';
import type { DoctorRowData } from './rowData';

/** 选择器锚定的目标格 */
interface PickerTarget {
  date: string;
  doctorId: string;
  anchor: HTMLElement;
}

export interface ScheduleTableProps {
  dates: readonly string[];
  weekendFlags: readonly boolean[];
  todayDate: string;
  doctors: readonly Doctor[];
  /** 与 `doctors` 同序等长 */
  rows: readonly DoctorRowData[];
  doctorStatsById: Record<string, DoctorStat>;
  dailyStatsByDate: Record<string, DailyStat>;
  hasSchedule: boolean;
  statsExpanded: boolean;
  legendExpanded: boolean;
  highlightCell: CellRef | null;
  highlightDoctorId: string | null;
  /** 派生数据尚未跟上当前月份 */
  stale: boolean;
  onSetCell: (date: string, doctorId: string, shiftType: ShiftType | null) => void;
  onToggleLock: (date: string, doctorId: string) => void;
  onToggleStats: () => void;
  onToggleLegend: () => void;
}

export function ScheduleTable(props: ScheduleTableProps): React.ReactElement {
  const {
    dates,
    weekendFlags,
    todayDate,
    doctors,
    rows,
    doctorStatsById,
    dailyStatsByDate,
    hasSchedule,
    statsExpanded,
    legendExpanded,
    highlightCell,
    highlightDoctorId,
    stale,
    onSetCell,
    onToggleLock,
    onToggleStats,
    onToggleLegend,
  } = props;

  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const doctorIndex = useMemo(() => {
    const index: Record<string, number> = {};
    doctors.forEach((doctor, i) => {
      index[doctor.id] = i;
    });
    return index;
  }, [doctors]);

  const dateIndex = useMemo(() => {
    const index: Record<string, number> = {};
    dates.forEach((date, i) => {
      index[date] = i;
    });
    return index;
  }, [dates]);

  // 空依赖：这个引用要活过整个组件生命周期，下游 900+ 个 memo 单元格全指望它
  const handlePick = useCallback((date: string, doctorId: string, anchor: HTMLElement): void => {
    setPicker({ date, doctorId, anchor });
  }, []);

  const handleClose = useCallback((): void => {
    setPicker(null);
  }, []);

  const handleSelect = useCallback(
    (shiftType: ShiftType | null): void => {
      if (picker !== null) {
        onSetCell(picker.date, picker.doctorId, shiftType);
        setPicker(null);
      }
    },
    [picker, onSetCell],
  );

  // 锁定后不关浮层：用户往往是「锁了再看一眼」，关掉反而要重新点开确认
  const handleToggleLock = useCallback((): void => {
    if (picker !== null) {
      onToggleLock(picker.date, picker.doctorId);
    }
  }, [picker, onToggleLock]);

  if (doctors.length === 0 || !hasSchedule) {
    return (
      <div className="schedule">
        <EmptyState hasDoctor={doctors.length > 0} />
      </div>
    );
  }

  const target =
    picker === null ? null : (doctors[doctorIndex[picker.doctorId]] as Doctor | undefined);
  const targetRow = picker === null ? undefined : rows[doctorIndex[picker.doctorId]];
  const targetEntry =
    picker === null || targetRow === undefined
      ? undefined
      : targetRow.entries[dateIndex[picker.date]];

  return (
    <div className="schedule">
      <ShiftLegend expanded={legendExpanded} onToggle={onToggleLegend} />

      <div className="schedule__table-wrap">
        <table className="table" aria-label={TEXTS.statsRowLabel}>
          <TableHeader dates={dates} weekendFlags={weekendFlags} todayDate={todayDate} />

          <tbody className="table__body">
            {doctors.map((doctor, index) => {
              const stat = doctorStatsById[doctor.id];
              return (
                <DoctorRow
                  key={doctor.id}
                  doctor={doctor}
                  dates={dates}
                  weekendFlags={weekendFlags}
                  todayDate={todayDate}
                  row={rows[index]}
                  shouldRest={stat?.shouldRest ?? 0}
                  actualRest={stat?.actualRest ?? 0}
                  postNightCount={stat?.postNightCount ?? 0}
                  restGap={stat?.restGap ?? 0}
                  highlightDate={
                    highlightCell !== null && highlightCell.doctorId === doctor.id
                      ? highlightCell.date
                      : undefined
                  }
                  isHighlightedRow={highlightDoctorId === doctor.id}
                  onPick={handlePick}
                />
              );
            })}
          </tbody>

          <StatsRows
            dates={dates}
            weekendFlags={weekendFlags}
            todayDate={todayDate}
            statsByDate={dailyStatsByDate}
            expanded={statsExpanded}
            onToggle={onToggleStats}
            stale={stale}
          />
        </table>
      </div>

      {picker !== null && target !== undefined && target !== null ? (
        <ShiftPicker
          anchor={picker.anchor}
          date={picker.date}
          doctorName={target.name}
          doctorTitle={TITLE_SHORT[target.title]}
          entry={targetEntry}
          onSelect={handleSelect}
          onToggleLock={handleToggleLock}
          onClose={handleClose}
        />
      ) : null}
    </div>
  );
}
