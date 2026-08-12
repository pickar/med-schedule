/**
 * 生成说明：把最近一次生成产出的 high 级诊断摊开，
 * 解释「为什么这样排」（如夜班人数不足被迫降配、连续夜班不可避免等）。
 *
 * 仅在存在 high 诊断时由 InsightPanel 挂载，无诊断时直接不渲染，
 * 避免空区占位干扰用户对「排得怎么样」的判断。
 *
 * 纯展示组件，diagnostics 由 InsightPanel 过滤好（只传 high）后灌入。
 */

import { memo } from 'react';
import type { Diagnostic } from '../../types/domain';
import { TEXTS } from '../../constants/texts';

export interface GenerateNoteProps {
  /** 已筛选为 level === 'high' 的诊断 */
  diagnostics: readonly Diagnostic[];
}

export const GenerateNote = memo(function GenerateNote(
  props: GenerateNoteProps,
): React.ReactElement {
  const { diagnostics } = props;

  return (
    <section className="insight-section" aria-labelledby="insight-note-title">
      <h3 className="insight-section__title" id="insight-note-title">
        {TEXTS.generationNotesTitle}
      </h3>
      <ul className="note-list">
        {diagnostics.map((diag, index) => (
          <li className="note-item" key={`${diag.stage}-${index}`}>
            <span className="note-item__stage">{diag.stage}</span>
            <span className="note-item__message">{diag.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
});
