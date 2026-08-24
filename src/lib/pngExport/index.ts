/**
 * PNG 导出入口：建画布 → 绘制 → `toBlob` → 触发下载。
 *
 * 三个必须守住的点：
 * 1. **`toBlob` 返回 null 也算失败**。它在画布过大或内存紧张时会静默回传 null，
 *    不显式判空就会变成「点了没反应」这种最难排查的故障。
 * 2. 全程 try/catch，任何异常都收敛成 reject，由调用方统一 toast
 *    「导出图片失败，请重试」（`TEXTS.pngFailed`），绝不让异常冒到 React 边界外白屏。
 * 3. 文件名走 `pngFileName()`，**月份不补零**（`2026年8月排班表.png`）。
 */

import { downloadBlob } from '../download';
import { pngFileName } from '../../constants/texts';
import { listMonthDates } from '../date';
import type { Ctx2D, PngTableParams } from './canvasTable';
import { PNG_SCALE, computeTableLayout, drawScheduleTable } from './canvasTable';

export type { PngTableParams } from './canvasTable';
export { PNG_SCALE, computeTableLayout, drawScheduleTable } from './canvasTable';

/** 画布尺寸上限：超过后多数浏览器会直接吐 null，提前拦下给出可解释的失败 */
const MAX_CANVAS_EDGE = 16384;

/**
 * 渲染并下载 PNG。
 *
 * @returns 实际文件名，供成功 toast 展示
 * @throws  绘制或编码失败时抛出 Error，调用方负责提示
 */
export async function exportSchedulePng(params: PngTableParams): Promise<string> {
  const dayCount = listMonthDates(params.month).length;
  const layout = computeTableLayout(dayCount, params.doctors.length, params.customShifts);

  const pixelW = Math.round(layout.width * PNG_SCALE);
  const pixelH = Math.round(layout.height * PNG_SCALE);
  if (pixelW > MAX_CANVAS_EDGE || pixelH > MAX_CANVAS_EDGE) {
    throw new Error(`画布尺寸超出浏览器上限（${pixelW}×${pixelH}）`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = pixelW;
  canvas.height = pixelH;
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D');
  }
  ctx.scale(PNG_SCALE, PNG_SCALE);
  drawScheduleTable(ctx as Ctx2D, params, layout);

  const blob = await toBlobAsync(canvas);
  const fileName = pngFileName(params.month);
  downloadBlob(blob, fileName);
  return fileName;
}

/** `canvas.toBlob` 的 Promise 包装；null 与异常一律转成 reject */
function toBlobAsync(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('Canvas 编码 PNG 失败'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch (reason) {
      reject(reason instanceof Error ? reason : new Error('Canvas 编码 PNG 失败'));
    }
  });
}
