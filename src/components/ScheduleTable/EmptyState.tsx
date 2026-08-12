/**
 * 空状态：三步引导。
 *
 * 文案逐字照录竞品，一个标点都不许改——理由不是崇拜竞品，
 * 而是这套「还没有排班表 / 点击「生成排班」按钮」的措辞已经被真实科室用熟了，
 * 换成「暂无数据」之类的通用话术，用户反而要重新猜下一步该点哪儿。
 *
 * 两条主副文案是分工的：
 * - 名册里已有医生 → `emptySubtitle`，直接指向「生成排班」按钮；
 * - 一位医生都没有 → `emptyNeedSetup`，先说清楚缺的是前置条件，
 *   否则用户点了生成按钮只会撞见一句「请先添加至少 1 位医生」。
 */

import { memo } from 'react';
import { BRAND, TEXTS } from '../../constants/texts';
import { Icon } from '../ui/Icons';

export interface EmptyStateProps {
  /** 名册里是否已有医生 */
  hasDoctor: boolean;
}

interface StepItem {
  icon: 'userPlus' | 'sliders' | 'sparkles';
  title: string;
  desc: string;
}

const STEPS: readonly StepItem[] = [
  { icon: 'userPlus', title: TEXTS.step1Title, desc: TEXTS.step1Desc },
  { icon: 'sliders', title: TEXTS.step2Title, desc: TEXTS.step2Desc },
  { icon: 'sparkles', title: TEXTS.step3Title, desc: TEXTS.step3Desc },
];

function EmptyStateBase(props: EmptyStateProps): React.ReactElement {
  const { hasDoctor } = props;

  return (
    <div className="empty-state">
      <div className="empty-state__mark" aria-hidden="true">
        <Icon name="medcross" size={34} strokeWidth={1.4} />
      </div>
      {/* 空状态是首访用户停留最久的一屏，品牌 slogan 放这里比塞在顶栏小字里更有机会被读到 */}
      <p className="empty-state__slogan">{BRAND.slogan}</p>
      <h2 className="empty-state__title">{TEXTS.emptyTitle}</h2>
      <p className="empty-state__subtitle">
        {hasDoctor ? TEXTS.emptySubtitle : TEXTS.emptyNeedSetup}
      </p>

      <ol className="empty-state__steps">
        {STEPS.map((step) => (
          <li key={step.title} className="empty-state__step">
            <span className="empty-state__step-icon" aria-hidden="true">
              <Icon name={step.icon} size={18} />
            </span>
            <span className="empty-state__step-title">{step.title}</span>
            <span className="empty-state__step-desc">{step.desc}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const EmptyState = memo(EmptyStateBase);
EmptyState.displayName = 'EmptyState';
