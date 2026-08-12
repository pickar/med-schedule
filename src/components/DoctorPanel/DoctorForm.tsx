/**
 * 医生编辑抽屉的**表单主体**，以及草稿模型与校验规则。
 * 表单与容器分家，是因为 `Drawer` 走 `createPortal`，服务端渲染会抛错；
 * 拆出纯展示层后 `renderToStaticMarkup` 烟测才能覆盖这些 DOM。
 * 请假也走草稿而非即时 dispatch：姓名/约束都是「点保存才生效」，
 * 唯独请假点一下落库会造出「点了取消请假却还在」的困惑。
 */

import { useState } from 'react';
import type { Doctor, DoctorConstraints, DoctorTitle, LeaveRange } from '../../types/domain';
import { DOCTOR_COLORS, DOCTOR_TITLES, WEEKDAY_DISPLAY_ORDER, WEEKDAY_NAMES, WEEKDAY_FULL_NAMES } from '../../constants/palette';
import { DrawerSection } from '../ui/Drawer';
import { Switch, ToggleChip } from '../ui/Switch';
import { Button, IconButton } from '../ui/Button';
import { TEXTS } from '../../constants/texts';
import { expandDateRange } from '../../lib/date';
import { createId } from '../../lib/id';

/** 抽屉内的可编辑快照。与 `Doctor` 的差别只是没有 id——新增时还没有 */
export interface DoctorDraft {
  name: string;
  title: DoctorTitle;
  color: string;
  fixedClinicDays: number[];
  constraints: DoctorConstraints;
  leaves: LeaveRange[];
}

/** 由医生对象（或 null = 新增）造一份草稿；数组一律深拷贝，防止改草稿串改 state */
export function createDoctorDraft(doctor: Doctor | null, fallbackColor: string): DoctorDraft {
  if (!doctor) {
    return {
      name: '',
      title: '主治医师',
      color: fallbackColor,
      fixedClinicDays: [],
      constraints: { noDayShift: false, noNightShift: false, weekendOff: false },
      leaves: [],
    };
  }
  return {
    name: doctor.name,
    title: doctor.title,
    color: doctor.color,
    fixedClinicDays: [...doctor.fixedClinicDays],
    constraints: { ...doctor.constraints },
    leaves: (doctor.leaves ?? []).map((leave) => ({ ...leave })),
  };
}

export interface NameCheck {
  /** 阻断保存 */
  error: string | null;
  /** 只提醒、不阻断：同科室真的可能有两个「张伟」 */
  warning: string | null;
}

export function checkDoctorName(
  name: string,
  doctors: readonly Doctor[],
  editingId: string | null,
): NameCheck {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { error: TEXTS.doctorNameRequired, warning: null };
  }
  const duplicated = doctors.some((d) => d.id !== editingId && d.name.trim() === trimmed);
  return { error: null, warning: duplicated ? TEXTS.doctorNameDuplicated : null };
}

export interface DoctorFormProps {
  draft: DoctorDraft;
  onPatch: (patch: Partial<DoctorDraft>) => void;
  nameCheck: NameCheck;
  /** 用户点过保存之后才显示必填错误，否则一打开抽屉就飘红 */
  showError: boolean;
}

export function DoctorForm(props: DoctorFormProps): React.ReactElement {
  const { draft, onPatch, nameCheck, showError } = props;
  const { constraints } = draft;

  const toggleClinicDay = (weekday: number, checked: boolean): void => {
    const next = checked
      ? [...draft.fixedClinicDays, weekday].sort((a, b) => a - b)
      : draft.fixedClinicDays.filter((day) => day !== weekday);
    onPatch({ fixedClinicDays: next });
  };

  const patchConstraint = (key: keyof DoctorConstraints, value: boolean): void => {
    onPatch({ constraints: { ...constraints, [key]: value } });
  };

  return (
    <>
      <DrawerSection>
        <label className="field">
          <span className="field__label">{TEXTS.doctorNameLabel}</span>
          <input
            className="text-input"
            type="text"
            autoComplete="off"
            value={draft.name}
            placeholder={TEXTS.doctorNamePlaceholder}
            aria-invalid={showError && nameCheck.error !== null}
            onChange={(event) => onPatch({ name: event.target.value })}
          />
        </label>
        {showError && nameCheck.error && <p className="field__error">{nameCheck.error}</p>}
        {nameCheck.warning && <p className="field__warning">{nameCheck.warning}</p>}

        <label className="field">
          <span className="field__label">{TEXTS.doctorTitleLabel}</span>
          <select
            className="select-input"
            value={draft.title}
            onChange={(event) => onPatch({ title: event.target.value as DoctorTitle })}
          >
            {DOCTOR_TITLES.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field__label">{TEXTS.doctorColorLabel}</span>
          <div className="color-swatches" role="radiogroup" aria-label={TEXTS.doctorColorLabel}>
            {DOCTOR_COLORS.map((color, index) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={draft.color === color}
                aria-label={TEXTS.doctorColorOption(index + 1)}
                className={draft.color === color ? 'color-swatch is-checked' : 'color-swatch'}
                style={{ background: color }}
                onClick={() => onPatch({ color })}
              />
            ))}
          </div>
        </div>
      </DrawerSection>

      <DrawerSection title={TEXTS.fixedClinicDaysLabel}>
        <div className="chip-row">
          {WEEKDAY_DISPLAY_ORDER.map((weekday) => (
            <ToggleChip
              key={weekday}
              checked={draft.fixedClinicDays.includes(weekday)}
              title={WEEKDAY_FULL_NAMES[weekday]}
              onChange={(checked) => toggleClinicDay(weekday, checked)}
            >
              {WEEKDAY_NAMES[weekday]}
            </ToggleChip>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title={TEXTS.constraintsLabel}>
        <Switch
          checked={constraints.noDayShift}
          label={TEXTS.noDayShiftLabel}
          onChange={(checked) => patchConstraint('noDayShift', checked)}
        />
        <Switch
          checked={constraints.noNightShift}
          label={TEXTS.noNightShiftLabel}
          onChange={(checked) => patchConstraint('noNightShift', checked)}
        />
        <Switch
          checked={constraints.weekendOff}
          label={TEXTS.weekendOffLabel}
          onChange={(checked) => patchConstraint('weekendOff', checked)}
        />
      </DrawerSection>

      <DrawerSection title={TEXTS.leaveDrawerTitle} hint={TEXTS.doctorLeaveDraftHint}>
        <LeaveEditor
          leaves={draft.leaves}
          onAdd={(leave) => onPatch({ leaves: [...draft.leaves, leave] })}
          onRemove={(id) => onPatch({ leaves: draft.leaves.filter((l) => l.id !== id) })}
        />
      </DrawerSection>
    </>
  );
}

interface LeaveEditorProps {
  leaves: readonly LeaveRange[];
  onAdd: (leave: LeaveRange) => void;
  onRemove: (leaveId: string) => void;
}

/**
 * 请假登记：原生 `<input type="date">`。
 * 不自己造日历控件——原生控件自带本地化、键盘输入与移动端滚轮选择器，
 * 手写一个只会更差，还得多养一份无障碍代码。
 */
function LeaveEditor({ leaves, onAdd, onRemove }: LeaveEditorProps): React.ReactElement {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (start === '') {
      return;
    }
    // 只填开始日 = 单日请假，这是最高频的场景，不该逼用户填两遍
    const finalEnd = end === '' ? start : end;
    if (finalEnd < start) {
      setError(TEXTS.leaveInvalidRange);
      return;
    }
    onAdd({ id: createId(), start, end: finalEnd, note: note.trim() || undefined });
    setStart('');
    setEnd('');
    setNote('');
    setError(null);
  };

  return (
    <div className="leave-editor">
      <div className="leave-form">
        <label className="field field--inline">
          <span className="field__label">{TEXTS.leaveStartLabel}</span>
          <input
            className="text-input"
            type="date"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="field field--inline">
          <span className="field__label">{TEXTS.leaveEndLabel}</span>
          <input
            className="text-input"
            type="date"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="field field--inline">
          <span className="field__label">{TEXTS.leaveNoteLabel}</span>
          <input
            className="text-input"
            type="text"
            value={note}
            placeholder={TEXTS.leaveNotePlaceholder}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button variant="secondary" size="sm" icon="plus" disabled={start === ''} onClick={submit}>
          {TEXTS.leaveAdd}
        </Button>
      </div>

      {error && <p className="field__error">{error}</p>}

      {leaves.length === 0 ? (
        <p className="panel-empty panel-empty--tight">{TEXTS.leaveEmpty}</p>
      ) : (
        <ul className="leave-list">
          {leaves.map((leave) => (
            <li key={leave.id} className="leave-item">
              <span className="leave-item__main">
                <span className="leave-item__range">
                  {leave.start} ~ {leave.end}
                </span>
                <span className="leave-item__meta">
                  {TEXTS.leaveDayCount(expandDateRange(leave.start, leave.end).length)}
                  {leave.note ? ` · ${leave.note}` : ''}
                </span>
              </span>
              <IconButton
                icon="trash"
                label={TEXTS.leaveRemove}
                variant="ghost"
                size="sm"
                onClick={() => onRemove(leave.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="field__hint">{TEXTS.leaveCountedAsRest}</p>
    </div>
  );
}
