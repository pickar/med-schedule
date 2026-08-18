/**
 * 轮班弹窗容器：连 Context、管草稿、实时算 plan、发 action、toast。
 *
 * 草稿（draft）用 useState 托管，打开瞬间按 ui.shiftCycleDoctorId 重置预选医生。
 * plan 用 useMemo 实时重算：弹窗里看到的预览，与 reducer 实际写入（同口径 planShiftCycle）
 * 完全一致——reducer 从 state 自取 leaves/schedules，这里也从同一份 state 取。
 *
 * 「应用」禁用条件：plan.error !== null 或 effective === 0。
 * 点「应用」一次 dispatch 完成整段写入，由 reducer 的 applyData 出口统一压成单条历史。
 */

import { useMemo, useState } from 'react';
import { useAppDispatch, useAppState, useToast } from '../../state/contexts';
import { selectShiftCycleDoctor, selectShiftCycleTargets } from '../../state/selectors';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { TEXTS } from '../../constants/texts';
import { formatMD } from '../../lib/date';
import { planShiftCycle } from '../../core/shiftCycle';
import type { ShiftCycleDraft, ShiftCycleError, ShiftCyclePlan } from '../../core/shiftCycle';
import { SequenceEditor } from './SequenceEditor';
import { CyclePreview } from './CyclePreview';

const TITLE_ID = 'shift-cycle-title';

function createShiftCycleDraft(doctorId: string | null): ShiftCycleDraft {
  return { doctorId, sequence: [], startDate: '', endDate: '', overwrite: false };
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

  // 选择器：预选医生（UI）供副标题展示，全量排班供规划
  const presetDoctor = selectShiftCycleDoctor(state);
  const targets = selectShiftCycleTargets(state);
  // 规划所用的医生以 draft 当前选择为准（用户可在下拉里改）
  const planningDoctor = state.doctors.find((d) => d.id === draft.doctorId) ?? null;

  const plan = useMemo<ShiftCyclePlan>(
    () =>
      planShiftCycle({
        doctorId: draft.doctorId ?? '',
        sequence: draft.sequence,
        startDate: draft.startDate,
        endDate: draft.endDate,
        overwrite: draft.overwrite,
        leaves: planningDoctor?.leaves ?? [],
        schedules: targets.schedules,
      }),
    [
      draft.doctorId,
      draft.sequence,
      draft.startDate,
      draft.endDate,
      draft.overwrite,
      planningDoctor,
      targets.schedules,
    ],
  );

  const close = (): void => {
    dispatch({ type: 'ui/patch', payload: { shiftCycleOpen: false, shiftCycleDoctorId: null } });
  };

  const patch = (next: Partial<ShiftCycleDraft>): void => {
    setDraft((prev) => ({ ...prev, ...next }));
  };

  const apply = (): void => {
    if (draft.doctorId === null || !planningDoctor) {
      return;
    }
    if (plan.error !== null || plan.summary.effective === 0) {
      return;
    }
    dispatch({
      type: 'schedule/applyShiftCycle',
      payload: {
        doctorId: draft.doctorId,
        sequence: draft.sequence,
        startDate: draft.startDate,
        endDate: draft.endDate,
        overwrite: draft.overwrite,
      },
    });
    toast.show({
      tone: 'success',
      message: TEXTS.shiftCycleApplied(
        planningDoctor.name,
        formatMD(draft.startDate),
        formatMD(draft.endDate),
      ),
    });
    close();
  };

  const canApply = draft.doctorId !== null && plan.error === null && plan.summary.effective > 0;
  const errorText = plan.error !== null ? errorLabel(plan.error) : null;

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
            {state.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field__label">{TEXTS.shiftCycleSequenceLabel}</span>
          <SequenceEditor sequence={draft.sequence} onChange={(sequence) => patch({ sequence })} />
        </div>

        <div className="shift-cycle__dates">
          <label className="field field--inline">
            <span className="field__label">{TEXTS.shiftCycleStartDateLabel}</span>
            <input
              className="text-input"
              type="date"
              value={draft.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
            />
          </label>
          <label className="field field--inline">
            <span className="field__label">{TEXTS.shiftCycleEndDateLabel}</span>
            <input
              className="text-input"
              type="date"
              value={draft.endDate}
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

        <CyclePreview plan={plan} />
      </div>
    </Modal>
  );
}
