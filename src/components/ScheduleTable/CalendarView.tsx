/**
 * 移动端「日历主视图」尝试（仅 ≤768px 由 MobileScheduleView 挂载；桌面端维持 doctor×date 表格）。
 *
 * 交互模型：整月月历网格 → 每格显示当天值班医生色点 → 点某天 → 底部面板（DayShiftSheet）选医生+写班次。
 * 和「医生视角」并列的另一条移动端路线：一屏看整月排布，而不是锁定单个医生往下滚。
 *
 * 本组件是移动端专属容器，允许直接订阅 Context（类比 DoctorScheduleView）：
 * 它不在 900+ 单元格的热路径上，订阅整份 state 不会触发叶子重渲染。
 */

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ScheduleEntry, ShiftType } from '../../types/domain';
import { useAppDispatch, useAppState } from '../../state/contexts';
import { SHIFT_METAS } from '../../constants/shifts';
import { TEXTS, WEEKDAY_LABELS } from '../../constants/texts';
import {
  currentMonthKey,
  formatMonthLabel,
  getWeekday,
  isToday,
  isWeekend,
  listMonthDates,
  shiftMonth,
} from '../../lib/date';
import { isOnLeave } from '../DoctorPanel/DoctorPanel';
import { EmptyState } from './EmptyState';
import { Icon } from '../ui/Icons';
import { DayShiftSheet } from './DayShiftSheet';

/** 每格最多直接展示几位医生，超出显示 +N */
const MAX_DOTS = 3;

export function CalendarView(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const month = state.ui.currentMonth;
  const doctors = state.doctors;
  const monthSchedule = (state.schedules[month] ?? {}) as Record<string, Record<string, ScheduleEntry>>;

  const dates = useMemo(() => listMonthDates(month), [month]);

  // 周日开头（与 WEEKDAY_LABELS 一致）：1 号前导空白数 = 1 号星期
  const leadingBlanks = dates.length > 0 ? getWeekday(dates[0]) : 0;
  const cells = useMemo(() => {
    const arr: (string | null)[] = [];
    for (let i = 0; i < leadingBlanks; i += 1) {
      arr.push(null);
    }
    for (const d of dates) {
      arr.push(d);
    }
    // 固定补满 6 行（42 格），避免跨月高度抖动
    while (arr.length < 42) {
      arr.push(null);
    }
    return arr;
  }, [dates, leadingBlanks]);

  const [activeDate, setActiveDate] = useState<string | null>(null);
  const closeSheet = useCallback(() => setActiveDate(null), []);

  const handleSelect = useCallback(
    (doctorId: string, shiftType: ShiftType) => {
      if (!activeDate) {
        return;
      }
      dispatch({
        type: 'schedule/setCell',
        payload: { date: activeDate, doctorId, shiftType, manual: true },
      });
      closeSheet();
    },
    [activeDate, dispatch, closeSheet],
  );

  const handleClear = useCallback(
    (doctorId: string) => {
      if (!activeDate) {
        return;
      }
      dispatch({
        type: 'schedule/setCell',
        payload: { date: activeDate, doctorId, shiftType: null, manual: true },
      });
      closeSheet();
    },
    [activeDate, dispatch, closeSheet],
  );

  const handleToggleLock = useCallback(
    (doctorId: string) => {
      if (!activeDate) {
        return;
      }
      dispatch({ type: 'schedule/toggleLock', payload: { date: activeDate, doctorId } });
    },
    [activeDate, dispatch],
  );

  const goMonth = useCallback(
    (delta: number) => {
      dispatch({ type: 'ui/setMonth', payload: { month: shiftMonth(month, delta) } });
    },
    [dispatch, month],
  );

  const goToday = useCallback(() => {
    dispatch({ type: 'ui/setMonth', payload: { month: currentMonthKey() } });
  }, [dispatch]);

  if (doctors.length === 0) {
    return <EmptyState hasDoctor={false} />;
  }

  return (
    <div className="calv">
      {/* 月份导航 */}
      <div className="calv__nav no-print">
        <button
          type="button"
          className="calv__nav-btn"
          aria-label={TEXTS.prevMonth}
          onClick={() => goMonth(-1)}
        >
          <Icon name="chevronLeft" size={20} />
        </button>
        <span className="calv__month">{formatMonthLabel(month)}</span>
        <button
          type="button"
          className="calv__nav-btn"
          aria-label={TEXTS.nextMonth}
          onClick={() => goMonth(1)}
        >
          <Icon name="chevronRight" size={20} />
        </button>
        <button type="button" className="calv__today" onClick={goToday}>
          {TEXTS.todayButton}
        </button>
      </div>

      {/* 星期表头 */}
      <div className="calv__weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label, idx) => (
          <span key={label} className={idx === 0 || idx === 6 ? 'is-weekend' : undefined}>
            {label}
          </span>
        ))}
      </div>

      {/* 月历网格 */}
      <div className="calv__grid">
        {cells.map((date, idx) => {
          if (!date) {
            return <div key={`blank-${idx}`} className="calv__cell is-blank" aria-hidden="true" />;
          }
          const weekend = isWeekend(date);
          const today = isToday(date);
          const dayMap = monthSchedule[date] ?? {};
          const assigned = doctors.filter((doctor) => {
            const entry = dayMap[doctor.id];
            return entry && entry.shiftType;
          });

          const cellClasses = ['calv__cell'];
          if (weekend) {
            cellClasses.push('is-weekend');
          }
          if (today) {
            cellClasses.push('is-today');
          }
          if (assigned.length > 0) {
            cellClasses.push('has-shift');
          }

          return (
            <button
              key={date}
              type="button"
              className={cellClasses.join(' ')}
              onClick={() => setActiveDate(date)}
            >
              <span className="calv__date">{String(Number(date.slice(8, 10)))}</span>
              <span className="calv__shifts">
                {assigned.length === 0 ? (
                  <span className="calv__empty">—</span>
                ) : (
                  <>
                    {assigned.slice(0, MAX_DOTS).map((doctor) => {
                      const shiftType = dayMap[doctor.id].shiftType as ShiftType;
                      const meta = SHIFT_METAS[shiftType];
                      const style = {
                        '--cell-bg': `var(--shift-${meta.key}-bg)`,
                        '--cell-fg': `var(--shift-${meta.key}-fg)`,
                      } as CSSProperties;
                      return (
                        <span
                          key={doctor.id}
                          className="calv__dot"
                          style={style}
                          title={`${doctor.name} ${meta.label}`}
                        >
                          <span className="calv__dot-name">{doctor.name.slice(0, 1)}</span>
                          <span className="calv__dot-short">{meta.short}</span>
                        </span>
                      );
                    })}
                    {assigned.length > MAX_DOTS ? (
                      <span className="calv__more">{TEXTS.calDayMore(assigned.length - MAX_DOTS)}</span>
                    ) : null}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <DayShiftSheet
        open={activeDate !== null}
        date={activeDate ?? ''}
        doctors={doctors}
        monthSchedule={monthSchedule}
        isOnLeave={isOnLeave}
        onSelect={handleSelect}
        onClear={handleClear}
        onToggleLock={handleToggleLock}
        onClose={closeSheet}
      />
    </div>
  );
}
