/**
 * 保存状态指示器。
 *
 * 「已保存」后面一定要跟**时间**。只写「已保存」，用户三分钟后再看还是「已保存」，
 * 分不清那是刚才那次还是这次；带上 HH:mm 才构成一个可信的凭据。
 *
 * 失败态不只是变红：`saveError` 时把「重试」按钮直接放在徽标旁边。
 * 存储写失败通常是隐私模式或配额满，用户能做的动作就一个，别让他去菜单里找。
 */

import { memo } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import type { SaveStatus } from '../../types/state';
import { TEXTS } from '../../constants/texts';
import { pad2 } from '../../lib/date';

export interface SaveIndicatorProps {
  status: SaveStatus;
  /** 最近一次保存成功的时间戳 */
  lastSavedAt: number | null;
  /** 失败原因，作为 tooltip */
  storageError: string | null;
  onRetry: () => void;
}

const TONE: Record<SaveStatus, string> = {
  idle: 'badge--muted',
  saving: 'badge--muted',
  saved: 'badge--success',
  error: 'badge--danger',
};

/** 时间戳 -> 'HH:mm' */
export function formatClock(at: number): string {
  const date = new Date(at);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function labelOf(status: SaveStatus, lastSavedAt: number | null): string {
  switch (status) {
    case 'saving':
      return TEXTS.saveSaving;
    case 'saved':
      return lastSavedAt === null ? TEXTS.saveSaved : `${TEXTS.saveSaved} ${formatClock(lastSavedAt)}`;
    case 'error':
      return TEXTS.saveError;
    default:
      return TEXTS.saveIdle;
  }
}

export const SaveIndicator = memo(function SaveIndicator(
  props: SaveIndicatorProps,
): React.ReactElement {
  const { status, lastSavedAt, storageError, onRetry } = props;

  return (
    <div className="save-indicator">
      <span className={`badge ${TONE[status]}`} role="status" title={storageError ?? undefined}>
        {status === 'saving' && <Icon name="loader" size={12} spin />}
        {status === 'saved' && <Icon name="check" size={12} />}
        {status === 'error' && <Icon name="alert" size={12} />}
        {labelOf(status, lastSavedAt)}
      </span>
      {status === 'error' && (
        <Button variant="ghost" size="sm" icon="refresh" onClick={onRetry}>
          {TEXTS.saveRetry}
        </Button>
      )}
    </div>
  );
});
