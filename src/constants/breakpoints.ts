/**
 * 响应式断点的单一事实来源。
 *
 * 断点值同时出现在三个地方，任何一处漂移都会造成「CSS 已经切成单栏、JS 还以为是桌面端」
 * 这类最难查的错位，因此这里是唯一的定义点：
 * - `src/styles/tokens.css` 的 `--bp-mobile`（仅登记，CSS 变量不能用于 @media 条件）
 * - `src/styles/layout.css` 的 `@media (max-width: 768px)`（CSS 语法限制，只能写字面量）
 * - 本文件（JS 侧 matchMedia 的唯一来源）
 *
 * 改动断点时必须同步改这三处，`scripts/smokeRebrand.tsx` 会做一致性断言。
 */

/** 移动端宽度上界（含）。>768px 视为桌面端三栏布局。 */
export const MOBILE_MAX = 768;

/** matchMedia 查询串，全应用只在此处拼装一次 */
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX}px)`;
