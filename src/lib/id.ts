/**
 * ID 生成：优先使用浏览器原生 `crypto.randomUUID()`，
 * 非安全上下文（http 局域网访问）下降级为时间戳 + 随机串。
 */

let fallbackCounter = 0;

/** 生成全局唯一 ID */
export function createId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  fallbackCounter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${rand}`;
}

/** 生成带业务前缀的 ID，便于调试时肉眼识别来源 */
export function createPrefixedId(prefix: string): string {
  return `${prefix}-${createId()}`;
}
