/**
 * 轮班弹窗容器：连 Context、管草稿、实时算 plan、发 action、toast。
 *
 * 草稿（draft）用 useState 托管，打开瞬间按 ui.shiftCycleDoctorId 重置预选医生。
 * plan 用 useMemo 实时重算：弹窗里看到的预览，与 reducer 实际写入（同口径 planShiftCycle）
 * 完全一致——reducer 从 state 自取 leaves/schedules，这里也从同一份 state 取。
 *
 * v1.4.0 批量能力：
 * - 医生下拉多一个「所有医生」，选中即对名册全体生效，配「多医生起始位」决定错开还是同步。
 * - 「应用到所有日期」开关：勾选后日期区间自动取当月 1 号起算的整年 365 天，
 *   两个日期控件转为只读。真正参与规划的日期统一收敛到 `effectiveDates`，
 *   避免「勾了开关但日期还是旧的」这类两套状态打架。
 *
 * 「应用」禁用条件：plan.error !== null 或 effective === 0。
 * 点「应用」一次 dispatch 完成整段写入，由 reducer 的 applyData 出口统一压成单条历史。
 */

import { useMemo, useState } from 'react';
import { useAppDispatch, useAppState, useToast } from '../../state/contexts';
import { selectShiftCycleDoctor } from '../../state/selectors';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { TEXTS } from '../../constants/texts';
import { addDays, formatMD } from '../../lib/date';
import { planShiftCycle } from '../../core/shiftCycle';
import { ALL_DATES_SPAN, ALL_DOCTORS } from '../../core/shiftCycle';
import type {
  CycleStartMode,
  ShiftCycleDraft,
  ShiftCycleError,
  ShiftCyclePlan,
} from '../../core/shiftCycle';
import type { LeaveRange } from '../../types/domain';
import { SequenceEditor } from './SequenceEditor';
import { CyclePreview } from './CyclePreview';

const TITLE_ID = 'shift-cycle-title';

function createShiftCycleDraft(doctorId: string | null): ShiftCycleDraft {
  return {
    doctorId,
    sequence: [],
    startDate: '',
    endDate: '',
    overwrite: false,
    startMode: 'stagger',
    allDates: false,
  };
}

function errorLabel(error: ShiftCycleError): string {
  switch (error) {
    case 'noDoctor':
      return TEXTS.shiftCycleErrorNoDoctor;
    case 'emptySequence':
      return TEXTS.shiftCycleErrorEmptySequence;
    case 'invalidDate':
      return TEXTS.shiftCycleErrorInvalidDate;
    case 'endBeforeStart':
      return TEXTS.shiftCycleErrorEndBeforeStart;
    case 'rangeTooLong':
      return TEXTS.shiftCycleErrorRangeTooLong;
  }
}

export function ShiftCycleModal(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const open = state.ui.shiftCycleOpen;
  const presetDoctorId = state.ui.shiftCycleDoctorId;

  // 渲染期比对 sessionKey：开关态或预选医生一变就重置草稿（见 DoctorDrawer 同源写法）
  const sessionKey = `${open ? 'open' : 'closed'}:${presetDoctorId ?? 'none'}`;
  const [session, setSession] = useState(sessionKey);
  const [draft, setDraft] = useState<ShiftCycleDraft>(() => createShiftCycleDraft(presetDoctorId));
  if (session !== sessionKey) {
    setSession(sessionKey);
    setDraft(createShiftCycleDraft(presetDoctorId));
  }

  // 副标题用预选医生（来自医生抽屉「设轮班」），不受下拉框改动影响
  const presetDoctor = selectShiftCycleDoctor(state);

  /** 是否选中「所有医生」 */
  const isAllDoctors = draft.doctorId === ALL_DOCTORS;

  /** 展开后的目标医生 id 列表；未选 / 选了已删除的医生时为空数组 */
  const targetDoctorIds = useMemo<string[]>(() => {
    if (draft.doctorId === null) {
      return [];
    }
    if (draft.doctorId === ALL_DOCTORS) {
      return state.doctors.map((doctor) => doctor.id);
    }
    return state.doctors.some((doctor) => doctor.id === draft.doctorId)
      ? [draft.doctorId]
      : [];
  }, [draft.doctorId, state.doctors]);

  /** 参与规划的医生对象（toast 名字用），仅单选时有值 */
  const planningDoctor =
    draft.doctorId !== null && !isAllDoctors
      ? (state.doctors.find((d) => d.id === draft.doctorId) ?? null)
      : null;

  /**
   * 实际参与规划的日期区间。
   * 「应用到所有日期」开启时，从当前查看月份的 1 号起算整年，日期控件退化为只读展示。
   */
  const effectiveDates = useMemo<{ start: string; end: string }>(() => {
    if (draft.allDates) {
      const start = `${state.ui.currentMonth}-01`;
      return { start, end: addDays(start, ALL_DATES_SPAN - 1) };
    }
    return { start: draft.startDate, end: draft.endDate };
  }, [draft.allDates, draft.startDate, draft.endDate, state.ui.currentMonth]);

  /** 请假按人取：批量套用时每位医生各判各的 */
  const leavesByDoctor = useMemo<Record<string, readonly LeaveRange[]>>(() => {
    const map: Record<string, readonly LeaveRange[]> = {};
    for (const doctor of state.doctors) {
      map[doctor.id] = doctor.leaves ?? [];
    }
    return map;
  }, [state.doctors]);

  const plan = useMemo<ShiftCyclePlan>(
    () =>
      planShiftCycle({
        doctorIds: targetDoctorIds,
        sequence: draft.sequence,
        startDate: effectiveDates.start,
        endDate: effectiveDates.end,
        overwrite: draft.overwrite,
        startMode: draft.startMode,
        leavesByDoctor,
        schedules: state.schedules,
      }),
    [
      targetDoctorIds,
      draft.sequence,
      draft.overwrite,
      draft.startMode,
      effectiveDates.start,
      effectiveDates.end,
      leavesByDoctor,
      state.schedules,
    ],
  );

  const close = (): void => {
    dispatch({ type: 'ui/patch', payload: { shiftCycleOpen: false, shiftCycleDoctorId: null } });
  };

  const patch = (next: Partial<ShiftCycleDraft>): void => {
    setDraft((prev) => ({ ...prev, ...next }));
  };

  const apply = (): void => {
    if (targetDoctorIds.length === 0) {
      return;
    }
    if (plan.error !== null || plan.summary.effective === 0) {
      return;
    }

    const start = formatMD(effectiveDates.start);
    const end = formatMD(effectiveDates.end);

    dispatch({
      type: 'schedule/applyShiftCycle',
      payload: {
        doctorIds: targetDoctorIds,
        sequence: draft.sequence,
        startDate: effectiveDates.start,
        endDate: effectiveDates.end,
        overwrite: draft.overwrite,
        startMode: draft.startMode,
      },
    });
    toast.show({
      tone: 'success',
      message:
        targetDoctorIds.length > 1
          ? TEXTS.shiftCycleAppliedAll(targetDoctorIds.length, start, end)
          : TEXTS.shiftCycleApplied(planningDoctor?.name ?? '', start, end),
    });
    close();
  };

  const canApply = targetDoctorIds.length > 0 && plan.error === null && plan.summary.effective > 0;
  const errorText = plan.error !== null ? errorLabel(plan.error) : null;
  const showStartMode = isAllDoctors && state.doctors.length > 1;

  return (
    <Modal
      open={open}
      onClose={close}
      title={TEXTS.shiftCycleTitle}
      size="lg"
      titleId={TITLE_ID}
      subtitle={presetDoctor ? presetDoctor.name : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {TEXTS.cancel}
          </Button>
          <Button variant="primary" icon="check" disabled={!canApply} onClick={apply}>
            {TEXTS.shiftCycleButton}
          </Button>
        </>
      }
    >
      <div className="shift-cycle">
        <label className="field">
          <span className="field__label">{TEXTS.shiftCycleDoctorLabel}</span>
          <select
            className="select-input"
            value={draft.doctorId ?? ''}
            onChange={(event) =>
              patch({ doctorId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">{TEXTS.shiftCycleNoDoctorHint}</option>
            {state.doctors.length > 0 && (
              <option value={ALL_DOCTORS}>
                {TEXTS.shiftCycleAllDoctors(state.doctors.length)}
              </option>
            )}
            {state.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </label>

        {showStartMode && (
          <div
            className="field shift-cycle__radios"
            role="radiogroup"
            aria-label={TEXTS.shiftCycleStartModeLabel}
          >
            <span className="field__label">{TEXTS.shiftCycleStartModeLabel}</span>
            <div className="shift-cycle__radio-row">
              {(['stagger', 'align'] as CycleStartMode[]).map((mode) => (
                <label key={mode} className="radio-inline">
                  <input
                    type="radio"
                    name="shift-cycle-start-mode"
                    value={mode}
                    checked={draft.startMode === mode}
                    onChange={() => patch({ startMode: mode })}
                  />
                  <span>
                    {mode === 'stagger'
                      ? TEXTS.shiftCycleStartModeStagger
                      : TEXTS.shiftCycleStartModeAlign}
                  </span>
                </label>
              ))}
            </div>
            <p className="field__hint">{TEXTS.shiftCycleStartModeHint}</p>
          </div>
        )}

        <div className="field">
          <span className="field__label">{TEXTS.shiftCycleSequenceLabel}</span>
          <SequenceEditor
            sequence={draft.sequence}
            customShifts={state.customShifts}
            onChange={(sequence) => patch({ sequence })}
          />
        </div>

        <Switch
          checked={draft.allDates}
          label={TEXTS.shiftCycleAllDatesLabel}
          description={
            draft.allDates
              ? TEXTS.shiftCycleAllDatesHint(
                  formatMD(effectiveDates.start),
                  formatMD(effectiveDates.end),
                )
              : TEXTS.shiftCycleAllDatesManualHint
          }
          onChange={(checked) => patch({ allDates: checked })}
        />

        <div className="shift-cycle__dates">
          <label className="field field--inline">
            <span className="field__label">{TEXTS.shiftCycleStartDateLabel}</span>
            <input
              className="text-input"
              type="date"
              value={effectiveDates.start}
              disabled={draft.allDates}
              onChange={(event) => patch({ startDate: event.target.value })}
            />
          </label>
          <label className="field field--inline">
            <span className="field__label">{TEXTS.shiftCycleEndDateLabel}</span>
            <input
              className="text-input"
              type="date"
              value={effectiveDates.end}
              disabled={draft.allDates}
              onChange={(event) => patch({ endDate: event.target.value })}
            />
          </label>
        </div>

        <Switch
          checked={draft.overwrite}
          label={TEXTS.shiftCycleOverwriteLabel}
          description={TEXTS.shiftCycleOverwriteHint}
          onChange={(checked) => patch({ overwrite: checked })}
        />

        {errorText !== null && <p className="field__error">{errorText}</p>}

        <CyclePreview plan={plan} customShifts={state.customShifts} doctors={state.doctors} />
      </div>
    </Modal>
  );
}
