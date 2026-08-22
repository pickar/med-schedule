/**
 * 移动端排班容器（仅 ≤768px 由 MainArea 挂载）。
 *
 * 顶部一个分段控件，在两条移动端路线间切换：
 * - 月历（CalendarView）：一屏看整月排布，点天弹面板写班
 * - 医生（DoctorScheduleView）：锁定单个医生往下滚
 *
 * 默认「月历」，方便用户直接预览这次的新尝试；两条路线都复用同一套写班 / 锁定链路。
 */

import { useState } from 'react';
import { TEXTS } from '../../constants/texts';
import { CalendarView } from './CalendarView';
import { DoctorScheduleView } from './DoctorScheduleView';

type MobileView = 'calendar' | 'doctor';

export function MobileScheduleView(): React.ReactElement {
  const [view, setView] = useState<MobileView>('calendar');

  return (
    <div className="mview">
      <div className="mview__switch no-print" role="tablist" aria-label={TEXTS.mobileTabSchedule}>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'calendar'}
          className={view === 'calendar' ? 'mview__btn is-active' : 'mview__btn'}
          onClick={() => setView('calendar')}
        >
          {TEXTS.calViewCalendar}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'doctor'}
          className={view === 'doctor' ? 'mview__btn is-active' : 'mview__btn'}
          onClick={() => setView('doctor')}
        >
          {TEXTS.calViewDoctor}
        </button>
      </div>

      {view === 'calendar' ? <CalendarView /> : <DoctorScheduleView />}
    </div>
  );
}
