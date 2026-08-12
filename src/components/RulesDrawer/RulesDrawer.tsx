/**
 * 排班规则抽屉：科室名 / 每日班次人数 / 休息天数 / 自动规则 / 轮流门诊。
 *
 * ## 没有「保存」按钮
 * 规则是配置而非表单提交，每一项改完立刻 dispatch 生效，底部只留关闭。
 * 敢这么做的前提是撤销栈：任何一次改动都进历史，顶栏「撤销」能原样退回，
 * 所以不需要用一个保存按钮来当反悔的最后防线。
 *
 * ## 唯一的例外：科室名走失焦提交
 * 文本框如果每敲一个字就 dispatch 一次，30 条历史上限会被
 * 「内分泌科」五个字直接冲掉四分之一，撤销栈变成打字回放。
 * 所以科室名用本地草稿，失焦 / 回车才落库——对用户仍然是「不用点保存」。
 *
 * ## 为什么表单主体是独立的纯组件
 * 同 `DoctorForm`：`Drawer` 依赖 `createPortal`，服务端渲染会抛错，
 * 拆出 `RulesForm` 才能被 `renderToStaticMarkup` 烟测覆盖。
 */

import { useCallback, useState } from 'react';
import { useAppDispatch, useAppState } from '../../state/contexts';
import type { Doctor, RotationRule, Rules } from '../../types/domain';
import { Drawer, DrawerSection } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { RangeStepper, Stepper } from '../ui/Stepper';
import { Switch } from '../ui/Switch';
import { RotationRuleItem } from './RotationRuleItem';
import { RANGED_SHIFTS, SHIFT_METAS } from '../../constants/shifts';
import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_FULL_NAMES } from '../../constants/palette';
import {
  MAX_REST_DAYS,
  MAX_SHIFT_COUNT,
  MIN_REST_DAYS,
  MIN_SHIFT_COUNT,
} from '../../constants/defaults';
import { TEXTS } from '../../constants/texts';

const TITLE_ID = 'rules-drawer-title';
const COUNT_BOUND = { min: MIN_SHIFT_COUNT, max: MAX_SHIFT_COUNT } as const;

export interface RulesFormHandlers {
  onDepartmentName: (name: string) => void;
  onShiftBound: (
    weekday: number,
    shift: 'dayShift' | 'nightShift',
    bound: 'min' | 'max',
    value: number,
  ) => void;
  onRestDays: (value: number) => void;
  onNoConsecutiveNight: (checked: boolean) => void;
  onAddRotation: () => void;
  onUpdateRotation: (rule: RotationRule) => void;
  onRemoveRotation: (id: string) => void;
}

export interface RulesFormProps {
  rules: Rules;
  doctors: readonly Doctor[];
  handlers: RulesFormHandlers;
}

export function RulesForm({ rules, doctors, handlers }: RulesFormProps): React.ReactElement {
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const commitName = (): void => {
    if (nameDraft !== null) {
      const trimmed = nameDraft.trim();
      // 空科室名会让导出文件名变成「202608排班表.csv」，宁可放弃这次编辑
      if (trimmed !== '' && trimmed !== rules.departmentName) {
        handlers.onDepartmentName(trimmed);
      }
      setNameDraft(null);
    }
  };

  return (
    <>
      <DrawerSection hint={TEXTS.rulesAutoSavedHint}>
        <label className="field">
          <span className="field__label">{TEXTS.departmentNameLabel}</span>
          <input
            className="text-input"
            type="text"
            autoComplete="off"
            value={nameDraft ?? rules.departmentName}
            placeholder={TEXTS.departmentNamePlaceholder}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitName();
              } else if (event.key === 'Escape') {
                setNameDraft(null);
              }
            }}
          />
        </label>
      </DrawerSection>

      <DrawerSection title={TEXTS.weekdayShiftTitle} hint={TEXTS.shiftCountHint}>
        <p className="field__hint">{TEXTS.weekdayShiftScopeHint}</p>
        <div className="rules-grid">
          <div className="rules-grid__row rules-grid__row--head">
            <span className="rules-grid__label">{TEXTS.rulesWeekdayColumn}</span>
            {RANGED_SHIFTS.map((shift) => (
              <span key={shift} className="rules-grid__cell">
                {SHIFT_METAS[shift].label}
              </span>
            ))}
          </div>
          {WEEKDAY_DISPLAY_ORDER.map((weekday) => {
            const config = rules.shiftsByWeekday[weekday];
            return (
              <div key={weekday} className="rules-grid__row">
                <span className="rules-grid__label">{WEEKDAY_FULL_NAMES[weekday]}</span>
                {RANGED_SHIFTS.map((shift) => (
                  <span key={shift} className="rules-grid__cell">
                    <RangeStepper
                      label={`${WEEKDAY_FULL_NAMES[weekday]} ${SHIFT_METAS[shift].label}`}
                      bound={COUNT_BOUND}
                      minValue={config[shift].min}
                      maxValue={config[shift].max}
                      onChangeMin={(value) => handlers.onShiftBound(weekday, shift, 'min', value)}
                      onChangeMax={(value) => handlers.onShiftBound(weekday, shift, 'max', value)}
                    />
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </DrawerSection>

      <DrawerSection title={TEXTS.restDaysLabel} hint={TEXTS.restDaysHint}>
        <Stepper
          value={rules.restDaysPerMonth}
          min={MIN_REST_DAYS}
          max={MAX_REST_DAYS}
          label={TEXTS.restDaysLabel}
          suffix="天"
          onChange={handlers.onRestDays}
        />
      </DrawerSection>

      <DrawerSection title={TEXTS.autoRulesTitle}>
        {/* 夜下休由生成器原子写入，没有关闭位；如实呈现为锁定态而不是给个假开关 */}
        <Switch
          checked
          disabled
          label={TEXTS.autoPostNightRestLabel}
          description={TEXTS.postNightRestHint}
          onChange={() => undefined}
        />
        <p className="field__hint">{TEXTS.autoPostNightRestLocked}</p>
        <Switch
          checked={rules.rules.noConsecutiveNightShift}
          label={TEXTS.noConsecutiveNightLabel}
          description={TEXTS.noConsecutiveNightHint}
          onChange={handlers.onNoConsecutiveNight}
        />
      </DrawerSection>

      <DrawerSection title={TEXTS.rotationTitle}>
        {doctors.length === 0 && <p className="field__warning">{TEXTS.rotationNoDoctor}</p>}
        {rules.rotationRules.length === 0 ? (
          <p className="panel-empty panel-empty--tight">{TEXTS.rotationEmpty}</p>
        ) : (
          <ul className="rotation-list">
            {rules.rotationRules.map((rule) => (
              <RotationRuleItem
                key={rule.id}
                rule={rule}
                doctors={doctors}
                onChange={handlers.onUpdateRotation}
                onRemove={handlers.onRemoveRotation}
              />
            ))}
          </ul>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          disabled={doctors.length === 0}
          onClick={handlers.onAddRotation}
        >
          {TEXTS.rotationAdd}
        </Button>
      </DrawerSection>
    </>
  );
}

export function RulesDrawer(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const close = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { activeDrawer: 'none' } });
  }, [dispatch]);

  // dispatch 引用恒定，所以这些回调也恒定 —— RotationRuleItem 的 memo 才有意义
  const handlers: RulesFormHandlers = {
    onDepartmentName: useCallback(
      (departmentName: string) => dispatch({ type: 'rules/patch', payload: { departmentName } }),
      [dispatch],
    ),
    onShiftBound: useCallback(
      (weekday: number, shift: 'dayShift' | 'nightShift', bound: 'min' | 'max', value: number) =>
        dispatch({ type: 'rules/setWeekdayShift', payload: { weekday, shift, bound, value } }),
      [dispatch],
    ),
    onRestDays: useCallback(
      (restDaysPerMonth: number) =>
        dispatch({ type: 'rules/patch', payload: { restDaysPerMonth } }),
      [dispatch],
    ),
    onNoConsecutiveNight: useCallback(
      (noConsecutiveNightShift: boolean) =>
        dispatch({ type: 'rules/patch', payload: { rules: { noConsecutiveNightShift } } }),
      [dispatch],
    ),
    onAddRotation: useCallback(
      () =>
        dispatch({
          type: 'rules/addRotation',
          // 默认周一 · 全员轮流：最常见的配置，用户多半直接就能用
          payload: { weekday: 1, mode: 'all', doctorIds: [] },
        }),
      [dispatch],
    ),
    onUpdateRotation: useCallback(
      (rule: RotationRule) => dispatch({ type: 'rules/updateRotation', payload: rule }),
      [dispatch],
    ),
    onRemoveRotation: useCallback(
      (id: string) => dispatch({ type: 'rules/removeRotation', payload: { id } }),
      [dispatch],
    ),
  };

  return (
    <Drawer
      open={state.ui.activeDrawer === 'rules'}
      onClose={close}
      titleId={TITLE_ID}
      title={TEXTS.rulesDrawerTitle}
      width="var(--drawer-rules-w)"
      footer={
        <Button variant="secondary" onClick={close}>
          {TEXTS.close}
        </Button>
      }
    >
      <RulesForm rules={state.rules} doctors={state.doctors} handlers={handlers} />
    </Drawer>
  );
}
