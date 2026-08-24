/**
 * 班次管理抽屉：列出内置（只读）+ 自定义（编辑 / 删除）+ 新增入口。
 *
 * 复用 `Drawer` / `DrawerSection` 与全局 `ConfirmDialog`。
 * 删除被引用的班次前先扫描 `schedules` 统计引用格数，弹确认框展示数量，
 * 确认后 `shiftDef/remove{clearUsages:true}` 级联置空引用格（设计 §1.5 / Q2）。
 *
 * 本组件是容器，直接订阅 state（抽屉全局唯一，订阅成本可忽略，
 * 与 RulesDrawer / DoctorDrawer 同口径）。
 */

import { useCallback, useMemo, useState } from 'react';
import type { ShiftDefinition, ShiftId, SchedulesByMonth } from '../../types/domain';
import { useAppDispatch, useAppState } from '../../state/contexts';
import { allShiftMetas, resolveShiftMeta, shiftCellStyle } from '../../constants/shifts';
import { MAX_CUSTOM_SHIFTS } from '../../state/handlers/shiftHandlers';
import { TEXTS } from '../../constants/texts';
import { Drawer, DrawerSection } from '../ui/Drawer';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ShiftDefinitionForm } from './ShiftDefinitionForm';

const TITLE_ID = 'shift-manager-title';

/** 统计每个班次 id 在全部排班中的引用格数 */
function countUsages(schedules: SchedulesByMonth): Map<ShiftId, number> {
  const result = new Map<ShiftId, number>();
  for (const monthSchedule of Object.values(schedules)) {
    for (const day of Object.values(monthSchedule)) {
      for (const entry of Object.values(day)) {
        if (entry.shiftType) {
          result.set(entry.shiftType, (result.get(entry.shiftType) ?? 0) + 1);
        }
      }
    }
  }
  return result;
}

export function ShiftManagerDrawer(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const open = state.ui.activeDrawer === 'shiftManager';
  const close = useCallback((): void => {
    dispatch({ type: 'ui/patch', payload: { activeDrawer: 'none' } });
  }, [dispatch]);

  // undefined = 列表视图；null = 新增；ShiftDefinition = 编辑
  const [editing, setEditing] = useState<ShiftDefinition | null | undefined>(undefined);
  const [pendingRemove, setPendingRemove] = useState<ShiftDefinition | null>(null);

  const usages = useMemo(() => countUsages(state.schedules), [state.schedules]);
  const builtinMetas = useMemo(() => allShiftMetas([]).filter((m) => !state.customShifts.some((d) => d.id === m.key)), [state.customShifts]);
  const maxReached = state.customShifts.length >= MAX_CUSTOM_SHIFTS;

  const handleAdd = useCallback((): void => setEditing(null), []);
  const handleEdit = useCallback((def: ShiftDefinition): void => setEditing(def), []);
  const handleCancelForm = useCallback((): void => setEditing(undefined), []);

  const handleSubmit = useCallback(
    (def: ShiftDefinition): void => {
      if (editing === null) {
        dispatch({ type: 'shiftDef/add', payload: def });
      } else {
        dispatch({ type: 'shiftDef/update', payload: def });
      }
      setEditing(undefined);
    },
    [dispatch, editing],
  );

  const confirmRemove = useCallback((): void => {
    if (!pendingRemove) {
      return;
    }
    const used = usages.get(pendingRemove.id) ?? 0;
    dispatch({
      type: 'shiftDef/remove',
      payload: { id: pendingRemove.id, clearUsages: used > 0 },
    });
    setPendingRemove(null);
  }, [dispatch, pendingRemove, usages]);

  const drawerTitle = editing === null ? TEXTS.shiftManagerNewTitle : editing ? TEXTS.shiftManagerEditTitle : TEXTS.shiftManagerTitle;

  return (
    <Drawer
      open={open}
      onClose={close}
      titleId={TITLE_ID}
      title={drawerTitle}
      width="var(--drawer-doctor-w)"
      footer={
        <Button variant="secondary" onClick={close}>
          {TEXTS.close}
        </Button>
      }
    >
      {editing !== undefined ? (
        <ShiftDefinitionForm
          initial={editing}
          usedCount={editing ? (usages.get(editing.id) ?? 0) : 0}
          maxReached={maxReached}
          onSubmit={handleSubmit}
          onCancel={handleCancelForm}
        />
      ) : (
        <>
          <DrawerSection title={TEXTS.shiftManagerBuiltinSection} hint={TEXTS.shiftManagerBuiltinHint}>
            <ul className="shift-manager-list">
              {builtinMetas.map((meta) => (
                <li key={meta.key} className="shift-manager-item">
                  <span className="shift-manager__swatch" style={shiftCellStyle(meta)}>
                    {meta.short}
                  </span>
                  <span className="shift-manager__name">{meta.label}</span>
                  <span className="tag tag--muted">{TEXTS.shiftManagerBuiltinTag}</span>
                </li>
              ))}
            </ul>
          </DrawerSection>

          <DrawerSection title={TEXTS.shiftManagerCustomSection} hint={TEXTS.shiftManagerCustomHint}>
            <div className="shift-manager__add">
              <Button
                variant="secondary"
                icon="plus"
                disabled={maxReached}
                onClick={handleAdd}
              >
                {TEXTS.shiftManagerAdd}
              </Button>
              {maxReached && (
                <span className="field__hint">{TEXTS.shiftManagerMaxReached(MAX_CUSTOM_SHIFTS)}</span>
              )}
            </div>

            {state.customShifts.length === 0 ? (
              <p className="panel-empty panel-empty--tight">{TEXTS.shiftManagerEmpty}</p>
            ) : (
              <ul className="shift-manager-list">
                {state.customShifts.map((def) => {
                  const meta = resolveShiftMeta(def.id, state.customShifts);
                  const used = usages.get(def.id) ?? 0;
                  return (
                    <li key={def.id} className="shift-manager-item">
                      <span className="shift-manager__swatch" style={shiftCellStyle(meta)}>
                        {meta.short}
                      </span>
                      <span className="shift-manager__name">
                        {meta.label}
                        {used > 0 && (
                          <span className="shift-manager__count">{TEXTS.shiftManagerUsedCount(used)}</span>
                        )}
                      </span>
                      <span className="shift-manager__actions">
                        <IconButton
                          icon="edit"
                          label={TEXTS.edit}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(def)}
                        />
                        <IconButton
                          icon="trash"
                          label={TEXTS.delete}
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingRemove(def)}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </DrawerSection>
        </>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title={TEXTS.shiftManagerDeleteTitle}
        message={TEXTS.shiftManagerDeleteMessage}
        detail={
          pendingRemove
            ? (usages.get(pendingRemove.id) ?? 0) > 0
              ? TEXTS.shiftManagerDeleteDetailUsed(usages.get(pendingRemove.id) ?? 0)
              : TEXTS.shiftManagerDeleteDetailUnused
            : undefined
        }
        danger
        confirmText={TEXTS.delete}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </Drawer>
  );
}
