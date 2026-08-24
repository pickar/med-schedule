/**
 * 移动端「医生视角」排班视图（仅 ≤768px 由 MainArea 挂载；桌面端维持 doctor×date 表格）。
 *
 * 交互模型：选医生 → 整月纵向日列表 → 点某天 → 底部面板写班次。
 * 一举消灭桌面端横滚表格在小屏上的横向滚动与过小的点击靶。
 *
 * 本组件是移动端专属容器，允许直接订阅 Context（类比 MainArea）：
 * 它不在 900+ 单元格的热路径上，订阅整份 state 不会触发叶子重渲染。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import type { ScheduleEntry, ShiftId } from '../../types/domain';
import { useAppDispatch, useAppState } from '../../state/contexts';
import { isWorkShiftId, resolveShiftMeta, shiftCellStyle } from '../../constants/shifts';
import { TEXTS, WEEKDAY_LABELS } from '../../constants/texts';
import { formatMD, getWeekday, isToday, listMonthDates } from '../../lib/date';
import { isOnLeave } from '../DoctorPanel/DoctorPanel';
import { EmptyState } from './EmptyState';
import { Icon } from '../ui/Icons';
import { MobileShiftSheet } from './MobileShiftSheet';

/** 左右滑动切换医生的水平阈值（px） */
const SWIPE_THRESHOLD = 40;

export function DoctorScheduleView(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const month = state.ui.currentMonth;
  const doctors = state.doctors;
  const dates = useMemo(() => listMonthDates(month), [month]);

  // 选中医生：ui.mobileDoctorId 失效（未设 / 已删）时退回第一位
  const selectedId = useMemo(() => {
    if (state.ui.mobileDoctorId && doctors.some((d) => d.id === state.ui.mobileDoctorId)) {
      return state.ui.mobileDoctorId;
    }
    return doctors[0]?.id ?? null;
  }, [state.ui.mobileDoctorId, doctors]);

  const selectedDoctor = doctors.find((d) => d.id === selectedId) ?? null;
  const monthSchedule = state.schedules[month] ?? {};

  const setDoctor = useCallback(
    (id: string) => dispatch({ type: 'ui/patch', payload: { mobileDoctorId: id } }),
    [dispatch],
  );

  // 按名册顺序左右切换医生（P1-1 的方向键 / 箭头等价物）
  const switchDoctor = useCallback(
    (dir: -1 | 1) => {
      if (doctors.length === 0 || selectedId === null) {
        return;
      }
      const idx = doctors.findIndex((d) => d.id === selectedId);
      const nextIdx = (idx + dir + doctors.length) % doctors.length;
      const next = doctors[nextIdx];
      if (next) {
        setDoctor(next.id);
      }
    },
    [doctors, selectedId, setDoctor],
  );

  // 选中医生本月统计：出勤 / 休息天数
  const stats = useMemo(() => {
    let work = 0;
    let rest = 0;
    if (selectedId) {
      for (const date of dates) {
        const entry = monthSchedule[date]?.[selectedId];
        if (!entry) {
          continue;
        }
        if (isWorkShiftId(entry.shiftType, state.customShifts)) {
          work += 1;
        } else {
          rest += 1;
        }
      }
    }
    return { work, rest };
  }, [dates, monthSchedule, selectedId, state.customShifts]);

  // 底部面板状态
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const activeEntry: ScheduleEntry | undefined = activeDate
    ? monthSchedule[activeDate]?.[selectedId ?? '']
    : undefined;

  const closeSheet = useCallback(() => setActiveDate(null), []);

  const handleSelect = useCallback(
    (shiftType: ShiftId) => {
      if (!activeDate || !selectedId) {
        return;
      }
      dispatch({
        type: 'schedule/setCell',
        payload: { date: activeDate, doctorId: selectedId, shiftType, manual: true },
      });
      closeSheet();
    },
    [activeDate, selectedId, dispatch, closeSheet],
  );

  const handleClear = useCallback(() => {
    if (!activeDate || !selectedId) {
      return;
    }
    dispatch({
      type: 'schedule/setCell',
      payload: { date: activeDate, doctorId: selectedId, shiftType: null, manual: true },
    });
    closeSheet();
  }, [activeDate, selectedId, dispatch, closeSheet]);

  const handleToggleLock = useCallback(() => {
    if (!activeDate || !selectedId) {
      return;
    }
    dispatch({ type: 'schedule/toggleLock', payload: { date: activeDate, doctorId: selectedId } });
  }, [activeDate, selectedId, dispatch]);

  // 滑动切换医生（P1-1）
  const touchX = useRef<number | null>(null);
  const onTouchStart = (event: ReactTouchEvent): void => {
    touchX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: ReactTouchEvent): void => {
    if (touchX.current === null) {
      return;
    }
    const dx = (event.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    if (dx <= -SWIPE_THRESHOLD) {
      switchDoctor(1);
    } else if (dx >= SWIPE_THRESHOLD) {
      switchDoctor(-1);
    }
    touchX.current = null;
  };

  if (doctors.length === 0) {
    return <EmptyState hasDoctor={false} />;
  }

  return (
    <div className="mdsv" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* 医生选择器：左右箭头 + 横向滚动 chip */}
      <div className="mdsv__doctor-bar no-print">
        <button
          type="button"
          className="mdsv__nav"
          aria-label={TEXTS.mdsvPrevDoctor}
          onClick={() => switchDoctor(-1)}
          disabled={doctors.length <= 1}
        >
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="mdsv__chips" role="tablist" aria-label={TEXTS.doctorPanelTitle}>
          {doctors.map((doctor) => {
            const selected = doctor.id === selectedId;
            return (
              <button
                key={doctor.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? 'mdsv__chip is-active' : 'mdsv__chip'}
                onClick={() => setDoctor(doctor.id)}
              >
                <span className="mdsv__chip-name">{doctor.name}</span>
                <span className="mdsv__chip-title">{doctor.title}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mdsv__nav"
          aria-label={TEXTS.mdsvNextDoctor}
          onClick={() => switchDoctor(1)}
          disabled={doctors.length <= 1}
        >
          <Icon name="chevronRight" size={20} />
        </button>
      </div>

      {/* 本月统计 */}
      <div className="mdsv__stats no-print">
        <span className="mdsv__stat">{TEXTS.mdsvWorkCount(stats.work)}</span>
        <span className="mdsv__stat">{TEXTS.mdsvRestCount(stats.rest)}</span>
      </div>

      {/* 整月纵向日列表 */}
      <ul className="mdsv__days">
        {dates.map((date) => {
          const weekday = getWeekday(date);
          const entry = selectedDoctor ? monthSchedule[date]?.[selectedDoctor.id] : undefined;
          const meta = entry ? resolveShiftMeta(entry.shiftType, state.customShifts) : null;
          const weekend = weekday === 0 || weekday === 6;
          const today = isToday(date);
          const onLeave = selectedDoctor ? isOnLeave(selectedDoctor, date) : false;

          const rowClasses = ['mdsv__day'];
          if (weekend) {
            rowClasses.push('is-weekend');
          }
          if (today) {
            rowClasses.push('is-today');
          }
          if (meta) {
            rowClasses.push('has-shift');
          }

          return (
            <li key={date}>
              <button type="button" className={rowClasses.join(' ')} onClick={() => setActiveDate(date)}>
                <span className="mdsv__day-date">
                  <span className="mdsv__day-md">{formatMD(date)}</span>
                  <span className="mdsv__day-weekday">{WEEKDAY_LABELS[weekday]}</span>
                </span>
                <span className="mdsv__day-shift">
                  {meta ? (
                    <span className="mdsv__shift-block" style={shiftCellStyle(meta)}>
                      <span className="mdsv__shift-short">{meta.short}</span>
                      <span className="mdsv__shift-label">{meta.label}</span>
                    </span>
                  ) : (
                    <span className="mdsv__shift-empty">
                      {onLeave ? TEXTS.cellLeaveMark : TEXTS.cellEmptyMark}
                    </span>
                  )}
                </span>
                <span className="mdsv__day-badges">
                  {entry?.isRotation ? (
                    <Icon name="repeat" size={14} className="mdsv__badge" aria-label={TEXTS.cellRotationMark} />
                  ) : null}
                  {entry?.locked ? (
                    <Icon name="lock" size={14} className="mdsv__badge" aria-label={TEXTS.cellLocked} />
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <MobileShiftSheet
        open={activeDate !== null}
        date={activeDate ?? ''}
        doctorName={selectedDoctor?.name ?? ''}
        doctorTitle={selectedDoctor?.title ?? ''}
        entry={activeEntry}
        customShifts={state.customShifts}
        onSelect={handleSelect}
        onClear={handleClear}
        onToggleLock={handleToggleLock}
        onClose={closeSheet}
      />
    </div>
  );
}
