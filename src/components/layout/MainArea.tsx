/**
 * 中间主区：工具条 + 排班表。
 *
 * ## 这一层为什么是唯一的数据编排点
 *
 * 全表只有 `MainArea` 消费 Context，往下一律 props。
 * `ScheduleTable` / `DoctorRow` / `ShiftCell` 全是纯 props 组件——
 * 这不是风格偏好，是 T03 三层 Context 拆分能否兑现的唯一条件：
 * 叶子只要碰一次 `useAppState()`，Context 变更就会穿透 memo，
 * 改一个格子会连累整月 900+ 个单元格一起重渲染。
 *
 * ## 滚动容器的归属不许再动
 *
 * 只有 `.app-main__scroll` 滚动，工具条固定在上方。
 * 表格的 sticky 表头与冻结首列全部以这一层为参照物。
 */

import { useCallback, useMemo } from 'react';
import type { ShiftType } from '../../types/domain';
import type { ValidationResult } from '../../types/validation';
import { emptyValidationResult } from '../../types/validation';
import type { DailyStat, DoctorStat } from '../../core/stats';
import { useAppDispatch, useAppState, useDerived } from '../../state/contexts';
import { selectHasSchedule, selectMonthSchedule } from '../../state/selectors';
import { TEXTS, scheduleTitle } from '../../constants/texts';
import { formatMonthLabel, listMonthDates, todayDateKey } from '../../lib/date';
import { ScheduleTable } from '../ScheduleTable/ScheduleTable';
import { useDoctorRows, useWeekendFlags } from '../ScheduleTable/rowData';
import type { TabPanelA11y } from './BottomTabBar';

/*
 * 派生数据落后于当前月份时用的占位常量。
 * 必须是模块级单例：每次渲染新建对象会让 useMemo 依赖恒变，
 * 行数据缓存直接失效，等于白写。
 */
const EMPTY_VALIDATION: ValidationResult = emptyValidationResult();
const EMPTY_DAILY_STATS: Record<string, DailyStat> = {};
const EMPTY_DOCTOR_STATS: Record<string, DoctorStat> = {};

interface MainAreaProps {
  /**
   * 移动端 Tab 模式下由 App 注入的 `role="tabpanel"` 等属性；桌面端为空对象，
   * `<main>` 保留原生 main 地标语义。
   */
  a11y?: TabPanelA11y;
}

export function MainArea({ a11y }: MainAreaProps): React.ReactElement {
  const state = useAppState();
  const derived = useDerived();
  const dispatch = useAppDispatch();

  const month = state.ui.currentMonth;
  // derived 走 useDeferredValue，切月瞬间可能还停在上个月，这里如实标出而不是显示错值
  const stale = derived.month !== month;

  const dates = useMemo(() => listMonthDates(month), [month]);
  const weekendFlags = useWeekendFlags(dates);
  const todayDate = todayDateKey();

  const schedule = selectMonthSchedule(state, month);
  const hasSchedule = selectHasSchedule(state, month);
  const validation = stale ? EMPTY_VALIDATION : derived.validation;

  const rows = useDoctorRows({ dates, doctors: state.doctors, schedule, validation });

  const handleSetCell = useCallback(
    (date: string, doctorId: string, shiftType: ShiftType | null): void => {
      dispatch({ type: 'schedule/setCell', payload: { date, doctorId, shiftType, manual: true } });
    },
    [dispatch],
  );

  const handleToggleLock = useCallback(
    (date: string, doctorId: string): void => {
      dispatch({ type: 'schedule/toggleLock', payload: { date, doctorId } });
    },
    [dispatch],
  );

  const statsExpanded = state.ui.statsExpanded;
  const handleToggleStats = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { statsExpanded: !statsExpanded } });
  }, [dispatch, statsExpanded]);

  const legendExpanded = state.ui.legendExpanded;
  const handleToggleLegend = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { legendExpanded: !legendExpanded } });
  }, [dispatch, legendExpanded]);

  return (
    <main className="app-main" {...a11y}>
      {/* 打印专用标题：屏幕态隐藏（print.css），打印态显示在表格上方 */}
      <div className="print-schedule-title">{scheduleTitle(state.rules.departmentName, month)}</div>

      <div className="app-main__toolbar no-print">
        <h1 className="app-main__title">{formatMonthLabel(month)}排班表</h1>
        <span className="badge badge--muted" aria-live="polite">
          {stale
            ? TEXTS.statsStale
            : `${TEXTS.fairnessLabel} ${derived.fairness.score} · ${derived.fairness.label}`}
        </span>
      </div>

      <div className="app-main__scroll">
        <ScheduleTable
          dates={dates}
          weekendFlags={weekendFlags}
          todayDate={todayDate}
          doctors={state.doctors}
          rows={rows}
          doctorStatsById={stale ? EMPTY_DOCTOR_STATS : derived.doctorStatsById}
          dailyStatsByDate={stale ? EMPTY_DAILY_STATS : derived.dailyStatsByDate}
          hasSchedule={hasSchedule}
          statsExpanded={statsExpanded}
          legendExpanded={legendExpanded}
          highlightCell={state.ui.highlightCell}
          highlightDoctorId={state.ui.highlightDoctorId}
          stale={stale}
          onSetCell={handleSetCell}
          onToggleLock={handleToggleLock}
          onToggleStats={handleToggleStats}
          onToggleLegend={handleToggleLegend}
        />
      </div>
    </main>
  );
}
