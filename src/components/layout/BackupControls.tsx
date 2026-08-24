/**
 * 左栏底部「数据备份」：导出全量 JSON + 从备份恢复。
 *
 * 恢复走「预览确认」而非直接覆盖：读完文件先 parseBackup 校验，
 * 成功才弹 ConfirmDialog 让用户确认，确认后才 dispatch app/hydrate。
 * 这一步不能省——恢复是覆盖式、不可逆的，误点一下就抹掉当前全部数据。
 *
 * 组件订阅 Context（容器），本身不含 Portal；ConfirmDialog 内部的 Modal
 * 才是 Portal 件。SSR 烟测不渲染本组件（避免 Portal 报错），仅对
 * parseBackup 做单元级断言（见 scripts/smokeT05b.tsx）。
 */

import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAppDispatch, useAppState, useToast } from '../../state/contexts';
import type { DataSnapshot } from '../../types/state';
import { exportBackup, parseBackup } from '../../lib/backup';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Button } from '../ui/Button';
import { TEXTS } from '../../constants/texts';

interface PendingRestore {
  snapshot: DataSnapshot;
  doctorCount: number;
  monthCount: number;
}

export function BackupControls(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PendingRestore | null>(null);

  const handleExport = useCallback((): void => {
    const snapshot: DataSnapshot = {
      doctors: state.doctors,
      rules: state.rules,
      schedules: state.schedules,
      customShifts: state.customShifts,
    };
    const fileName = exportBackup(snapshot);
    toast.show({ tone: 'success', message: TEXTS.exportSuccess(fileName) });
  }, [state.doctors, state.rules, state.schedules, toast]);

  const handlePick = useCallback((): void => {
    fileRef.current?.click();
  }, []);

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      // 清空，确保再次选同一文件仍会触发 change
      event.target.value = '';
      if (!file) {
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        toast.show({ tone: 'danger', message: TEXTS.backupRestoreFailed });
        return;
      }
      const result = parseBackup(text);
      if (!result.ok) {
        toast.show({ tone: 'danger', message: result.error });
        return;
      }
      setPending({
        snapshot: result.snapshot,
        doctorCount: result.snapshot.doctors.length,
        monthCount: Object.keys(result.snapshot.schedules).length,
      });
      setConfirmOpen(true);
    },
    [toast],
  );

  const handleConfirm = useCallback((): void => {
    if (pending) {
      dispatch({ type: 'app/hydrate', payload: pending.snapshot });
      toast.show({ tone: 'success', message: TEXTS.backupRestoreSuccess });
    }
    setConfirmOpen(false);
    setPending(null);
  }, [pending, dispatch, toast]);

  const handleCancel = useCallback((): void => {
    setConfirmOpen(false);
    setPending(null);
  }, []);

  return (
    <>
      <div className="backup-controls">
        <Button variant="subtle" size="sm" icon="download" block onClick={handleExport}>
          {TEXTS.backupExport}
        </Button>
        <Button variant="subtle" size="sm" icon="refresh" block onClick={handlePick}>
          {TEXTS.backupImport}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="backup-controls__file"
          onChange={handleFile}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={TEXTS.backupButton}
        message={TEXTS.backupRestoreConfirm}
        detail={pending ? TEXTS.backupRestoreDetail(pending.doctorCount, pending.monthCount) : undefined}
        danger
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
