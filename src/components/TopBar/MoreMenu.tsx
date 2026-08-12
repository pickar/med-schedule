/**
 * 移动端顶栏的「更多」溢出菜单。
 *
 * 手机上顶栏只放得下四件东西：品牌图标、月份导航、生成排班、以及这个菜单。
 * 撤销、重做、规则、三种导出、保存状态——七项全部收进来。
 *
 * ## 为什么保存状态也塞在菜单里
 *
 * 它不是操作，是状态，按理不该出现在动作菜单中。但手机顶栏确实没有它的位置，
 * 而「存储写失败」这件事必须让用户看得见、并且能点重试（隐私模式、配额满是真实场景）。
 * 折中办法是把它放在菜单最下方、用一条分隔线与上面的动作项隔开，
 * 让它读起来像页脚状态而不是第七个可点项。
 *
 * ## 纯 props
 *
 * 本组件不碰任何 Context，全部数据与回调由 TopBar 透传。
 * TopBar 已经订阅了整个 state，这里再订一次只会多出一份无谓的重渲染依赖。
 */

import { memo, useCallback, useRef, useState } from 'react';
import type { SaveStatus } from '../../types/state';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { MenuItem, Popover, PopoverMenu } from '../ui/Popover';
import { SaveIndicator } from './SaveIndicator';
import { TEXTS } from '../../constants/texts';

export interface MoreMenuProps {
  canUndo: boolean;
  canRedo: boolean;
  /** 当前月是否已有排班；无排班时三项导出全部不可用 */
  hasSchedule: boolean;
  /** PNG 正在渲染 */
  pngBusy: boolean;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  storageError: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onOpenRules: () => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onPrint: () => void;
  onRetrySave: () => void;
}

export const MoreMenu = memo(function MoreMenu(props: MoreMenuProps): React.ReactElement {
  const {
    canUndo,
    canRedo,
    hasSchedule,
    pngBusy,
    saveStatus,
    lastSavedAt,
    storageError,
    onUndo,
    onRedo,
    onOpenRules,
    onExportCsv,
    onExportPng,
    onPrint,
    onRetrySave,
  } = props;

  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  /** 点完一律收起：下载对话框弹出后菜单还浮着会挡住半个屏幕 */
  const runAndClose = useCallback((action: () => void): (() => void) => {
    return () => {
      setOpen(false);
      action();
    };
  }, []);

  return (
    <>
      {/* 用 Button 而不是 IconButton：只有 Button 转发了 ref，Popover 要拿它当锚点 */}
      <Button
        ref={anchorRef}
        variant="ghost"
        icon="more"
        aria-label={TEXTS.moreActions}
        title={TEXTS.moreActions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      />

      <Popover
        open={open}
        anchor={anchorRef.current}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        role="menu"
      >
        <PopoverMenu>
          <MenuItem
            onClick={runAndClose(onUndo)}
            disabled={!canUndo}
            icon={<Icon name="undo" size={15} />}
          >
            {TEXTS.undoButton}
          </MenuItem>
          <MenuItem
            onClick={runAndClose(onRedo)}
            disabled={!canRedo}
            icon={<Icon name="redo" size={15} />}
          >
            {TEXTS.redoButton}
          </MenuItem>
          <MenuItem onClick={runAndClose(onOpenRules)} icon={<Icon name="sliders" size={15} />}>
            {TEXTS.rulesButton}
          </MenuItem>
          <MenuItem
            onClick={runAndClose(onExportCsv)}
            disabled={!hasSchedule}
            icon={<Icon name="download" size={15} />}
          >
            {TEXTS.exportCsv}
          </MenuItem>
          <MenuItem
            onClick={runAndClose(onExportPng)}
            disabled={!hasSchedule || pngBusy}
            icon={<Icon name="calendar" size={15} />}
          >
            {pngBusy ? TEXTS.exportPngWorking : TEXTS.exportPng}
          </MenuItem>
          <MenuItem
            onClick={runAndClose(onPrint)}
            disabled={!hasSchedule}
            icon={<Icon name="print" size={15} />}
          >
            {TEXTS.printSchedule}
          </MenuItem>
        </PopoverMenu>

        {/* 灰掉的三项要说明原因，否则就是一排「点不动也不知道为什么」的按钮 */}
        {!hasSchedule && <p className="popover-menu__empty">{TEXTS.exportEmptyHint}</p>}

        <div className="popover-menu__footer">
          <SaveIndicator
            status={saveStatus}
            lastSavedAt={lastSavedAt}
            storageError={storageError}
            onRetry={onRetrySave}
          />
        </div>
      </Popover>
    </>
  );
});
