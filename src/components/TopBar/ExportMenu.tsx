/**
 * 导出下拉：CSV / 图片 / 打印。
 *
 * 三项合成一个菜单而不是三个并排按钮：顶栏右侧已经挤了撤销、重做、保存状态、
 * 规则、生成，再摊开三个导出按钮会把「生成排班」这个主操作淹掉。
 *
 * 没有排班时整组置灰并给出原因（`exportEmptyHint`）。
 * 灰按钮不解释为什么灰，是最常见的一类「点不动」投诉。
 */

import { memo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { MenuItem, Popover, PopoverMenu } from '../ui/Popover';
import { TEXTS } from '../../constants/texts';

export interface ExportMenuProps {
  /** 当前月是否已有排班；无排班时三项全部不可用 */
  hasSchedule: boolean;
  /** PNG 正在渲染，菜单按钮转圈 */
  busy: boolean;
  onExportCsv: () => void;
  onExportPng: () => void;
  onPrint: () => void;
}

export const ExportMenu = memo(function ExportMenu(props: ExportMenuProps): React.ReactElement {
  const { hasSchedule, busy, onExportCsv, onExportPng, onPrint } = props;
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  // 每一项点完都要收起菜单，否则下载对话框弹出后菜单还浮在上面
  const runAndClose = (action: () => void): (() => void) => {
    return () => {
      setOpen(false);
      action();
    };
  };

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        icon="download"
        trailingIcon="chevronDown"
        loading={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={hasSchedule ? TEXTS.exportButton : TEXTS.exportEmptyHint}
        onClick={() => setOpen((prev) => !prev)}
      >
        {busy ? TEXTS.exportPngWorking : TEXTS.exportButton}
      </Button>

      <Popover
        open={open}
        anchor={anchorRef.current}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        role="menu"
      >
        <PopoverMenu>
          <MenuItem
            onClick={runAndClose(onExportCsv)}
            disabled={!hasSchedule}
            icon={<Icon name="download" size={15} />}
          >
            {TEXTS.exportCsv}
          </MenuItem>
          <MenuItem
            onClick={runAndClose(onExportPng)}
            disabled={!hasSchedule}
            icon={<Icon name="calendar" size={15} />}
          >
            {TEXTS.exportPng}
          </MenuItem>
          <MenuItem
            onClick={runAndClose(onPrint)}
            disabled={!hasSchedule}
            icon={<Icon name="print" size={15} />}
          >
            {TEXTS.printSchedule}
          </MenuItem>
        </PopoverMenu>
        {!hasSchedule && <p className="popover-menu__empty">{TEXTS.exportEmptyHint}</p>}
      </Popover>
    </>
  );
});
