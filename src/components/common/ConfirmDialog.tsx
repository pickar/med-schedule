/**
 * 确认对话框：删除医生、清空排班、重新生成覆盖手动调整，统统走这里。
 *
 * 三条防误触的规则：
 * 1. 破坏性操作用 `role="alertdialog"`，读屏会立刻打断当前朗读播报内容。
 * 2. 破坏性操作**不允许点遮罩关闭**（`dismissOnScrim=false`）。
 *    点空白就消失的弹窗，用户会分不清自己是「取消了」还是「确认了」。
 * 3. 焦点默认落在**取消**上。`Overlay` 会聚焦面板内第一个可聚焦元素，
 *    所以 DOM 顺序里取消必须排在确认前面 —— 视觉顺序靠 CSS 的 row-reverse
 *    还原成「取消在左、确认在右」，两边都不将就。
 */

import { useId } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TEXTS } from '../../constants/texts';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** 主说明文案 */
  message: ReactNode;
  /** 补充细节，如「已锁定 5 格将被保留」 */
  detail?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作：确认按钮变红、禁止点遮罩关闭 */
  danger?: boolean;
  /** 确认按钮 loading（异步确认场景） */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null {
  const {
    open,
    title,
    message,
    detail,
    confirmText = TEXTS.confirm,
    cancelText = TEXTS.cancel,
    danger = false,
    loading = false,
    onConfirm,
    onCancel,
  } = props;

  const titleId = useId();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      titleId={titleId}
      size="sm"
      role={danger ? 'alertdialog' : 'dialog'}
      hideClose
      dismissOnScrim={!danger}
      footer={
        <div className="confirm__actions">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </div>
      }
    >
      <p className="confirm__message">{message}</p>
      {detail && <p className="confirm__detail">{detail}</p>}
    </Modal>
  );
}
