/**
 * 浏览器文件下载工具（零依赖）。
 *
 * 统一走 `URL.createObjectURL` + 隐藏 `<a>` + `revokeObjectURL`，
 * 避免各导出模块各写一套导致内存泄漏。
 */

/** 触发浏览器下载指定 Blob；失败时抛出错误供上层 toast 提示 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // 立刻 revoke 在部分浏览器会中断下载，延迟一帧后释放
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** 下载纯文本（默认 UTF-8） */
export function downloadText(content: string, fileName: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type: mime }), fileName);
}

/** UTF-8 BOM，保证 Excel 打开 CSV 时中文不乱码 */
export const UTF8_BOM = '\uFEFF';

/** 下载 CSV（自动加 BOM 头） */
export function downloadCsv(content: string, fileName: string): void {
  downloadText(`${UTF8_BOM}${content}`, fileName, 'text/csv;charset=utf-8');
}
