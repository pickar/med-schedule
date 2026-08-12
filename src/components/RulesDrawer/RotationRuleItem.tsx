/**
 * 单条轮流门诊规则：星期 + 轮流方式 + 参与医生。
 *
 * ## 为什么方式用 `<select>` 而不是三段式按钮组
 * 三个选项的文案是竞品原文（「全员轮流（公平轮值）」等），最长 10 个汉字。
 * 塞进 520px 抽屉里的分段控件必然要截断或换行，截断后三个选项会长得一模一样。
 * 原生 select 天生带省略、带键盘选择、带移动端原生选择器，是这里的正解。
 *
 * ## 参与医生为什么只在 selected 模式露出
 * all / random 两种模式下这份名单不参与运算。留在界面上会被当成
 * 「我勾了人却没生效」的 bug 报上来——不生效的控件就不该出现。
 */

import { memo } from 'react';
import type { Doctor, RotationMode, RotationRule } from '../../types/domain';
import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_FULL_NAMES } from '../../constants/palette';
import { ToggleChip } from '../ui/Switch';
import { IconButton } from '../ui/Button';
import { TEXTS } from '../../constants/texts';

/** 三种模式的展示顺序与文案，全部取自竞品原文 */
export const ROTATION_MODES: readonly { mode: RotationMode; label: string }[] = [
  { mode: 'all', label: TEXTS.rotationModeAll },
  { mode: 'selected', label: TEXTS.rotationModeSelected },
  { mode: 'random', label: TEXTS.rotationModeRandom },
];

export interface RotationRuleItemProps {
  rule: RotationRule;
  doctors: readonly Doctor[];
  onChange: (rule: RotationRule) => void;
  onRemove: (id: string) => void;
}

export const RotationRuleItem = memo(function RotationRuleItem(
  props: RotationRuleItemProps,
): React.ReactElement {
  const { rule, doctors, onChange, onRemove } = props;

  const toggleDoctor = (doctorId: string, checked: boolean): void => {
    const doctorIds = checked
      ? [...rule.doctorIds, doctorId]
      : rule.doctorIds.filter((id) => id !== doctorId);
    onChange({ ...rule, doctorIds });
  };

  return (
    <li className="rotation-item">
      <div className="rotation-item__head">
        <label className="field field--inline">
          <span className="field__label">{TEXTS.rotationWeekdayLabel}</span>
          <select
            className="select-input select-input--narrow"
            value={rule.weekday}
            onChange={(event) => onChange({ ...rule, weekday: Number(event.target.value) })}
          >
            {WEEKDAY_DISPLAY_ORDER.map((weekday) => (
              <option key={weekday} value={weekday}>
                {WEEKDAY_FULL_NAMES[weekday]}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline field--grow">
          <span className="field__label">{TEXTS.rotationModeLabel}</span>
          <select
            className="select-input"
            value={rule.mode}
            onChange={(event) => onChange({ ...rule, mode: event.target.value as RotationMode })}
          >
            {ROTATION_MODES.map((option) => (
              <option key={option.mode} value={option.mode}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <IconButton
          icon="trash"
          label={TEXTS.rotationRemove}
          variant="ghost"
          size="sm"
          onClick={() => onRemove(rule.id)}
        />
      </div>

      {rule.mode === 'selected' && (
        <div className="rotation-item__doctors">
          <span className="field__label">{TEXTS.rotationDoctorsLabel}</span>
          <div className="chip-row">
            {doctors.map((doctor) => (
              <ToggleChip
                key={doctor.id}
                checked={rule.doctorIds.includes(doctor.id)}
                onChange={(checked) => toggleDoctor(doctor.id, checked)}
              >
                {doctor.name}
              </ToggleChip>
            ))}
          </div>
          {rule.doctorIds.length === 0 && (
            <p className="field__warning">{TEXTS.rotationSelectedEmpty}</p>
          )}
        </div>
      )}

      {rule.mode === 'random' && <p className="field__hint">{TEXTS.randomModeLabel}</p>}
    </li>
  );
});
