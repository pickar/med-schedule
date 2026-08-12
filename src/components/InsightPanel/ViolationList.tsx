/**
 * 违规清单：把派生数据里的 `validation.violations` 摊开成可读列表。
 *
 * 纯展示组件：数据由 InsightPanel 以 props 灌入，定位动作通过 `onLocate`
 * 回调上抛。这样做有两层好处：
 * 1. 组件不订阅任何 Context，可被 SSR 烟测直接渲染（Portal 之外的普通组件）。
 * 2. 配合 `React.memo`，派生数据引用不变时这一块整块跳过重渲染。
 *
 * 列表顺序直接沿用校验器输出的「severity 降序 → date 升序 → doctorId」，
 * 这里不再二次排序，避免与校验器的排序承诺打架。
 */

import { memo } from 'react';
import type { Violation } from '../../types/validation';
import { TEXTS } from '../../constants/texts';
import { Button } from '../ui/Button';

export interface ViolationListProps {
  /** 已按严重度排好序的违规，来自 derived.validation.violations */
  violations: readonly Violation[];
  /** 点击「定位」后把坐标上抛，由 InsightPanel 转成 ui/locate */
  onLocate: (date: string, doctorId: string) => void;
}

export const ViolationList = memo(function ViolationList(
  props: ViolationListProps,
): React.ReactElement {
  const { violations, onLocate } = props;

  return (
    <section className="insight-section" aria-labelledby="insight-violation-title">
      <h3 className="insight-section__title" id="insight-violation-title">
        <span>{TEXTS.violationTitle}</span>
        {violations.length > 0 && (
          <span className="insight-section__count">{violations.length}</span>
        )}
      </h3>

      {violations.length === 0 ? (
        <div className="panel-empty panel-empty--tight">{TEXTS.violationEmpty}</div>
      ) : (
        <ul className="violation-list">
          {violations.map((violation) => {
            const canLocate = violation.date !== undefined && violation.doctorId !== undefined;
            return (
              <li
                key={violation.id}
                className={`violation-item violation-item--${violation.severity}`}
              >
                <div className="violation-item__body">
                  <p className="violation-item__message">{violation.message}</p>
                  {violation.detail !== undefined && (
                    <p className="violation-item__detail">{violation.detail}</p>
                  )}
                </div>
                {canLocate && (
                  <Button
                    variant="subtle"
                    size="sm"
                    icon="locate"
                    className="violation-item__locate"
                    onClick={() =>
                      onLocate(violation.date as string, violation.doctorId as string)
                    }
                  >
                    {TEXTS.violationLocate}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
