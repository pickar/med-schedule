/**
 * 医生编辑抽屉的**容器**：连 Context、管草稿、发 action。
 * 表单长什么样在 `DoctorForm.tsx`，这里一行 JSX 结构都不写死。
 *
 * ## 草稿如何跟着「当前编辑对象」重置
 * 不用 `useEffect` 同步，而是「渲染期比对 sessionKey，不一致就 setState」——
 * 这是 React 官方推荐的 derived-state 写法。用 effect 的话会先渲染出
 * 一帧「旧医生的数据配新标题」，用户在快速切换两位医生时看得见闪动。
 * sessionKey 把开合状态也算进去，所以「关掉再打开同一个人」也会拿到干净草稿，
 * 上次没保存的半截输入不会阴魂不散。
 *
 * ## 删除为什么必须走 ConfirmDialog
 * `window.confirm` 会阻塞主线程、样式不可控、在部分浏览器里可被用户永久屏蔽——
 * 一旦被屏蔽，`confirm()` 直接返回 false，表现为「点删除没反应」。
 * 破坏性操作不能建立在这种基础上。
 */

import { useState } from 'react';
import { useAppDispatch, useAppState } from '../../state/contexts';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DoctorForm, checkDoctorName, createDoctorDraft } from './DoctorForm';
import type { DoctorDraft } from './DoctorForm';
import { pickDoctorColor } from '../../constants/palette';
import { TEXTS } from '../../constants/texts';
import type { Doctor } from '../../types/domain';

const TITLE_ID = 'doctor-drawer-title';

export function DoctorDrawer(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const open = state.ui.activeDrawer === 'doctor';
  const editingId = state.ui.editingDoctorId;
  const editing: Doctor | null =
    editingId === null ? null : (state.doctors.find((d) => d.id === editingId) ?? null);

  const sessionKey = `${open ? 'open' : 'closed'}:${editingId ?? 'new'}`;
  const [session, setSession] = useState(sessionKey);
  const [draft, setDraft] = useState<DoctorDraft>(() =>
    createDoctorDraft(editing, pickDoctorColor(state.doctors.map((d) => d.color))),
  );
  const [showError, setShowError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 编辑对象或开合状态一变，立刻在同一次渲染里换掉草稿（见文件头说明）
  if (session !== sessionKey) {
    setSession(sessionKey);
    setDraft(createDoctorDraft(editing, pickDoctorColor(state.doctors.map((d) => d.color))));
    setShowError(false);
    setConfirmingDelete(false);
  }

  const nameCheck = checkDoctorName(draft.name, state.doctors, editingId);

  const close = (): void => {
    dispatch({ type: 'ui/patch', payload: { activeDrawer: 'none', editingDoctorId: null } });
  };

  const patch = (next: Partial<DoctorDraft>): void => {
    setDraft((prev) => ({ ...prev, ...next }));
  };

  const save = (): void => {
    if (nameCheck.error) {
      setShowError(true);
      return;
    }
    const payload = {
      name: draft.name.trim(),
      title: draft.title,
      fixedClinicDays: draft.fixedClinicDays,
      constraints: draft.constraints,
      leaves: draft.leaves,
    };
    if (editing) {
      dispatch({ type: 'doctor/update', payload: { ...payload, id: editing.id, color: draft.color } });
    } else {
      dispatch({ type: 'doctor/add', payload: { ...payload, color: draft.color } });
    }
    close();
  };

  const remove = (): void => {
    if (editing) {
      dispatch({ type: 'doctor/remove', payload: { id: editing.id } });
    }
    setConfirmingDelete(false);
    close();
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={close}
        titleId={TITLE_ID}
        title={editing ? TEXTS.doctorEdit : TEXTS.doctorAdd}
        subtitle={editing ? editing.name : undefined}
        headerExtra={
          editing ? (
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              className="text-danger"
              onClick={() => setConfirmingDelete(true)}
            >
              {TEXTS.doctorDelete}
            </Button>
          ) : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {TEXTS.cancel}
            </Button>
            <Button variant="primary" icon="save" onClick={save}>
              {TEXTS.save}
            </Button>
          </>
        }
      >
        <DoctorForm draft={draft} onPatch={patch} nameCheck={nameCheck} showError={showError} />
      </Drawer>

      <ConfirmDialog
        open={confirmingDelete && editing !== null}
        danger
        title={TEXTS.doctorDelete}
        message={TEXTS.doctorDeleteConfirm(editing?.name ?? '')}
        confirmText={TEXTS.delete}
        onConfirm={remove}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
