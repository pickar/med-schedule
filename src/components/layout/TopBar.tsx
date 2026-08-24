/**
 * 顶栏：品牌 + 月份导航 + 撤销重做 + 保存状态 + 导出 + 规则 + 生成。
 *
 * 顶栏是**容器组件**，直接消费 AppState / Derived。这不违反分层纪律：
 * 纪律约束的是「表格里 900+ 个叶子节点」，顶栏全局只有一个实例，
 * 让它订阅整个 state 的成本可以忽略，换来的是不用从 App 往下透传十来个 prop。
 *
 * 三个子件（MonthNav / SaveIndicator / ExportMenu）全是纯 props 组件且已 memo，
 * 所以这里的每个回调都必须 `useCallback` 固定引用，否则 memo 全数落空。
 * 回调里读 `stateRef` 而不是闭包变量，是让依赖数组收敛到稳定引用的代价最低的写法。
 *
 * 导出的取数口径：统计一律从 `useDerived()` 拿现成的，**不重算 `computeDerived`**。
 * 派生数据经 `useDeferredValue` 降级，可能比主状态晚一帧；`derived.month` 与
 * 当前月不一致时直接拒绝导出——导出一份日数对不上的表，比不导出糟得多。
 *
 * ## 移动端为什么走 JS 分支而不是纯 CSS 隐藏
 *
 * 顶栏在手机上只留「品牌图标 + 月份导航 + 生成 + 更多」，其余六七个控件收进溢出菜单。
 * 若用 CSS 把桌面版那一组藏起来、再另写一份手机版，同一个「撤销」按钮就会同时存在
 * 两份 DOM——重复的 `aria-label` 会被读屏念两遍，焦点顺序也会凭空多出一串隐藏项。
 * 所以这里按 `useIsMobile()` 二选一渲染。底部 Tab 栏的情况不同（它关系到布局高度，
 * 一帧不一致就会露出空条），那边坚持用 CSS 断点，两处取舍不同是有意为之。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppState, useDerived, useSaveRetry, useToast } from '../../state/contexts';
import {
  selectCanRedo,
  selectCanUndo,
  selectHasSchedule,
  selectMonthSchedule,
  selectMonthsWithData,
  selectRedoTooltip,
  selectUndoTooltip,
} from '../../state/selectors';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { MonthNav } from '../TopBar/MonthNav';
import { SaveIndicator } from '../TopBar/SaveIndicator';
import { ExportMenu } from '../TopBar/ExportMenu';
import { MoreMenu } from '../TopBar/MoreMenu';
import { GenerateFlow } from '../GenerateFlow/GenerateFlow';
import { exportScheduleCsv } from '../../lib/csvExport';
import { exportSchedulePng } from '../../lib/pngExport';
import { BRAND, TEXTS } from '../../constants/texts';
import { useIsMobile } from './useIsMobile';

export function TopBar(): React.ReactElement {
  const state = useAppState();
  const derived = useDerived();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const retrySave = useSaveRetry();
  const isMobile = useIsMobile();
  const [pngBusy, setPngBusy] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const derivedRef = useRef(derived);
  derivedRef.current = derived;

  const { currentMonth, saveStatus, lastSavedAt, storageError } = state.ui;
  const monthsWithData = useMemo(() => selectMonthsWithData(state.schedules), [state.schedules]);
  const hasSchedule = selectHasSchedule(state, currentMonth);

  // ---------- 月份 / 抽屉 / 历史 ----------

  const handleMonthChange = useCallback(
    (month: string): void => {
      dispatch({ type: 'ui/setMonth', payload: { month } });
    },
    [dispatch],
  );

  const handleOpenRules = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { activeDrawer: 'rules' } });
  }, [dispatch]);

  const handleOpenShiftCycle = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { shiftCycleOpen: true, shiftCycleDoctorId: null } });
  }, [dispatch]);

  const handleOpenShiftManager = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { activeDrawer: 'shiftManager' } });
  }, [dispatch]);

  const handleUndo = useCallback((): void => {
    dispatch({ type: 'history/undo' });
  }, [dispatch]);

  const handleRedo = useCallback((): void => {
    dispatch({ type: 'history/redo' });
  }, [dispatch]);

  // ---------- 导出 ----------

  /**
   * 取导出所需的一整套入参；派生数据没跟上当前月时返回 null。
   * 集中在一处判断，CSV 与 PNG 才不会各写一份口径不同的兜底。
   */
  const collectExportInput = useCallback(() => {
    const snapshot = stateRef.current;
    const data = derivedRef.current;
    const month = snapshot.ui.currentMonth;
    if (data.month !== month) {
      toast.show({ tone: 'info', message: TEXTS.exportStaleHint });
      return null;
    }
    return {
      month,
      rules: snapshot.rules,
      doctors: snapshot.doctors,
      schedule: selectMonthSchedule(snapshot, month),
      dailyStats: data.dailyStats,
      doctorStatsById: data.doctorStatsById,
      customShifts: snapshot.customShifts,
    };
  }, [toast]);

  const handleExportCsv = useCallback((): void => {
    const input = collectExportInput();
    if (!input) {
      return;
    }
    try {
      const fileName = exportScheduleCsv(input);
      toast.show({ tone: 'success', message: TEXTS.exportSuccess(fileName) });
    } catch (reason) {
      toast.show({
        tone: 'danger',
        message: TEXTS.csvFailed,
        detail: reason instanceof Error ? reason.message : undefined,
      });
    }
  }, [collectExportInput, toast]);

  const handleExportPng = useCallback((): void => {
    const input = collectExportInput();
    if (!input) {
      return;
    }
    setPngBusy(true);
    exportSchedulePng({
      month: input.month,
      departmentName: input.rules.departmentName,
      doctors: input.doctors,
      schedule: input.schedule,
      dailyStats: input.dailyStats,
      doctorStatsById: input.doctorStatsById,
      customShifts: input.customShifts,
    })
      .then((fileName) => {
        toast.show({ tone: 'success', message: TEXTS.exportSuccess(fileName) });
      })
      .catch((reason: unknown) => {
        toast.show({
          tone: 'danger',
          message: TEXTS.pngFailed,
          detail: reason instanceof Error ? reason.message : undefined,
        });
      })
      .finally(() => {
        setPngBusy(false);
      });
  }, [collectExportInput, toast]);

  // 打印交给浏览器，样式由 print.css 接管（隐藏 .no-print、表格铺满 A4 横版）
  const handlePrint = useCallback((): void => {
    window.print();
  }, []);

  const canUndo = selectCanUndo(state);
  const canRedo = selectCanRedo(state);

  return (
    <header className="app-topbar no-print">
      <div className="app-topbar__brand">
        <Icon name="medcross" size={22} strokeWidth={1.6} />
        <div className="app-topbar__brand-text">
          <div className="app-topbar__name">{BRAND.name}</div>
          <div className="app-topbar__slogan">{BRAND.slogan}</div>
        </div>
      </div>

      <MonthNav month={currentMonth} monthsWithData={monthsWithData} onChange={handleMonthChange} />

      <div className="app-topbar__spacer" />

      {isMobile ? (
        <div className="app-topbar__group">
          <GenerateFlow />
          <MoreMenu
            canUndo={canUndo}
            canRedo={canRedo}
            hasSchedule={hasSchedule}
            pngBusy={pngBusy}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            storageError={storageError}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onOpenRules={handleOpenRules}
            onExportCsv={handleExportCsv}
            onExportPng={handleExportPng}
            onPrint={handlePrint}
            onOpenShiftCycle={handleOpenShiftCycle}
            onOpenShiftManager={handleOpenShiftManager}
            onRetrySave={retrySave}
          />
        </div>
      ) : (
        <div className="app-topbar__group">
          <IconButton
            icon="undo"
            label={TEXTS.undoButton}
            title={selectUndoTooltip(state, TEXTS.undoButton)}
            variant="ghost"
            disabled={!canUndo}
            onClick={handleUndo}
          />
          <IconButton
            icon="redo"
            label={TEXTS.redoButton}
            title={selectRedoTooltip(state, TEXTS.redoButton)}
            variant="ghost"
            disabled={!canRedo}
            onClick={handleRedo}
          />

          <SaveIndicator
            status={saveStatus}
            lastSavedAt={lastSavedAt}
            storageError={storageError}
            onRetry={retrySave}
          />

          <ExportMenu
            hasSchedule={hasSchedule}
            busy={pngBusy}
            onExportCsv={handleExportCsv}
            onExportPng={handleExportPng}
            onPrint={handlePrint}
          />

          <Button
            variant="secondary"
            icon="repeat"
            active={state.ui.shiftCycleOpen}
            onClick={handleOpenShiftCycle}
          >
            {TEXTS.shiftCycleButton}
          </Button>

          <Button
            variant="secondary"
            icon="sliders"
            active={state.ui.activeDrawer === 'rules'}
            onClick={handleOpenRules}
          >
            {TEXTS.rulesButton}
          </Button>

          <Button
            variant="secondary"
            icon="layers"
            active={state.ui.activeDrawer === 'shiftManager'}
            onClick={handleOpenShiftManager}
          >
            {TEXTS.shiftManagerButton}
          </Button>

          <GenerateFlow />
        </div>
      )}
    </header>
  );
}
