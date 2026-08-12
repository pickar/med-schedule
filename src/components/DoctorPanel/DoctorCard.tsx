/**
 * 左栏名册里的单个医生条目。
 *
 * ## 为什么整张卡是一个 `<button>`
 * 名册的唯一动作就是「点开编辑」。做成卡片 + 角落一个小编辑按钮，
 * 会让 260px 宽的窄栏里出现一个 28px 的点击靶子，还得额外解释
 * 「点卡片和点按钮有什么区别」。整卡可点，靶子最大、心智最小。
 * 代价是卡内不能再放任何按钮（嵌套按钮是非法 HTML），
 * 所以徽标一律用 `<span>`，删除动作放进抽屉里。
 *
 * ## 为什么 `onLeaveToday` 由父级算
 * 「今天是否在请假区间内」依赖 `todayDateKey()`，是一个外部时钟输入。
 * 放进 memo 组件内部会让同样的 props 渲染出不同结果，破坏可预测性，
 * 也让 SSR 烟测无法固定断言。父级算一次、当作数据传下来，
 * 这个组件就退化成纯函数。
 */

import { memo } from 'react';
import type { Doctor } from '../../types/domain';
import { TITLE_SHORT, WEEKDAY_DISPLAY_ORDER, WEEKDAY_NAMES } from '../../constants/palette';
import { TEXTS } from '../../constants/texts';

export interface DoctorCardProps {
  doctor: Doctor;
  /** 洞察面板「定位」过来的高亮态 */
  highlighted: boolean;
  /** 今天是否落在该医生的某段请假内，由父级统一计算 */
  onLeaveToday: boolean;
  onEdit: (doctorId: string) => void;
}

/**
 * 固定门诊日缩写：按「一二三四五六日」的阅读顺序输出，
 * 而不是按数据里 0-6 的存储顺序（那会把周日排到最前面）。
 */
export function formatClinicDays(days: readonly number[]): string {
  const owned = new Set(days);
  return WEEKDAY_DISPLAY_ORDER.filter((weekday) => owned.has(weekday))
    .map((weekday) => WEEKDAY_NAMES[weekday])
    .join(' ');
}

export const DoctorCard = memo(function DoctorCard(props: DoctorCardProps): React.ReactElement {
  const { doctor, highlighted, onLeaveToday, onEdit } = props;
  const { constraints } = doctor;

  const clinicDays = formatClinicDays(doctor.fixedClinicDays);
  const hasLeaves = (doctor.leaves ?? []).length > 0;

  const classes = ['doctor-card'];
  if (highlighted) {
    classes.push('is-highlighted');
  }

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-label={TEXTS.doctorEditAction(doctor.name)}
      onClick={() => onEdit(doctor.id)}
    >
      {/* 标识色是数据而非主题色，只能内联；样式表里依旧零字面色值 */}
      <span className="doctor-card__dot" style={{ background: doctor.color }} aria-hidden="true" />

      <span className="doctor-card__body">
        <span className="doctor-card__line">
          <span className="doctor-card__name text-truncate">{doctor.name}</span>
          <span className="doctor-card__title">{TITLE_SHORT[doctor.title]}</span>
        </span>

        {clinicDays !== '' && (
          <span className="doctor-card__clinic text-truncate">
            {TEXTS.doctorFixedClinicSummary(clinicDays)}
          </span>
        )}

        {(constraints.noDayShift ||
          constraints.noNightShift ||
          constraints.weekendOff ||
          hasLeaves) && (
          <span className="doctor-card__badges">
            {constraints.noDayShift && <span className="badge badge--info">{TEXTS.doctorBadgeNoDay}</span>}
            {constraints.noNightShift && (
              <span className="badge badge--info">{TEXTS.doctorBadgeNoNight}</span>
            )}
            {constraints.weekendOff && (
              <span className="badge badge--muted">{TEXTS.doctorBadgeWeekendOff}</span>
            )}
            {onLeaveToday ? (
              <span className="badge badge--warning">{TEXTS.cellLeaveMark}</span>
            ) : (
              hasLeaves && <span className="badge badge--muted">{TEXTS.doctorBadgeLeave}</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
});
