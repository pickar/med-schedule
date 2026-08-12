/**
 * 右栏洞察面板：把生成器与校验/统计的产出收敛成一个可读面板。
 *
 * 这是容器组件，订阅 DerivedContext 取校验与统计、订阅 AppState 取
 * `ui.lastDiagnostics`（生成说明，不入撤销栈也不持久化），并用
 * AppDispatch 触发「定位」。三个子块都是纯展示组件，数据以 props 灌入，
 * 可被 SSR 烟测直接渲染（不碰任何 Portal）。
 *
 * 「休息天数不足」段内联在此文件（rest-shortage 内联），与生成说明一样
 * 源自派生数据，没必要再拆一个文件徒增 import 成本。
 */

import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppState, useDerived } from '../../state/contexts';
import type { DoctorStat } from '../../core/stats/doctor';
import type { Diagnostic } from '../../types/domain';
import { TEXTS } from '../../constants/texts';
import { ViolationList } from './ViolationList';
import { WorkloadBoard } from './WorkloadBoard';
import { GenerateNote } from './GenerateNote';

export function InsightPanel(): React.ReactElement {
  const derived = useDerived();
  const dispatch = useAppDispatch();
  const lastDiagnostics = useAppState().ui.lastDiagnostics;

  const handleLocate = useCallback(
    (date: string, doctorId: string): void => {
      dispatch({ type: 'ui/locate', payload: { date, doctorId } });
    },
    [dispatch],
  );

  // 生成说明只认 high 级诊断，解释「为什么这样排」；中低档是噪音，不进此区
  const highDiagnostics = useMemo(
    (): readonly Diagnostic[] => lastDiagnostics.filter((diag) => diag.level === 'high'),
    [lastDiagnostics],
  );

  const exemptDoctors = useMemo(
    (): readonly DoctorStat[] => derived.doctorStats.filter((stat) => stat.excludedFromNight),
    [derived.doctorStats],
  );

  return (
    <div className="insight-panel">
      <ViolationList violations={derived.validation.violations} onLocate={handleLocate} />
      <WorkloadBoard
        fairness={derived.fairness}
        doctorStats={derived.doctorStats}
        exemptDoctors={exemptDoctors}
      />
      <RestShortageSection shortages={derived.restShortages} />
      {highDiagnostics.length > 0 && <GenerateNote diagnostics={highDiagnostics} />}
    </div>
  );
}

interface RestShortageSectionProps {
  /** 休息未达标的医生，按缺口降序 */
  shortages: readonly DoctorStat[];
}

/**
 * 休息天数不足段（内联）：列出实休 < 应休的医生，并用进度条直观显示缺口。
 * 全员达标时显示一句肯定的空态，而不是留一块空白让用户怀疑是不是没加载。
 */
function RestShortageSection(props: RestShortageSectionProps): React.ReactElement {
  const { shortages } = props;

  return (
    <section className="insight-section" aria-labelledby="insight-rest-title">
      <h3 className="insight-section__title" id="insight-rest-title">
        {TEXTS.restShortageTitle}
      </h3>
      {shortages.length === 0 ? (
        <div className="panel-empty panel-empty--tight">{TEXTS.restAllOk}</div>
      ) : (
        <ul className="rest-list">
          {shortages.map((stat) => {
            const ratio =
              stat.shouldRest > 0
                ? Math.min(100, (stat.actualRest / stat.shouldRest) * 100)
                : 100;
            return (
              <li className="rest-item" key={stat.doctorId}>
                <div className="rest-item__head">
                  <span className="rest-item__name">{stat.name}</span>
                  <span className="rest-item__gap">{TEXTS.restGapLabel(stat.restGap)}</span>
                </div>
                <div className="rest-item__track">
                  <div className="rest-item__fill" style={{ width: `${ratio}%` }} />
                </div>
                <span className="rest-item__progress">
                  {TEXTS.restProgressLabel(stat.actualRest, stat.shouldRest)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
