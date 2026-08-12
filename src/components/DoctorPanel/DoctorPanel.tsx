/**
 * 左栏医生名册：搜索 + 列表 + 新增入口。
 *
 * ## 为什么这里可以直接消费 Context
 * `state/contexts.ts` 那条「叶子不订阅 Context」的铁律，约束的是排班表里
 * 900+ 个单元格。左栏最多几十个节点，让它订阅整个 state 换来的是
 * 不用从 App 往下透传五六个 prop。真正的性能纪律落在 `DoctorCard` 上：
 * 它被 `memo` 包住，且 `onEdit` 用 `useCallback` 固定引用——
 * 输入搜索词时列表项的 props 完全没变，一个卡片都不会重渲染。
 *
 * ## 两种空态必须分开
 * 「一个医生都没有」和「搜到了但没匹配上」是完全不同的处境：
 * 前者要引导去添加，后者要告诉用户「换个词试试，别以为数据丢了」。
 * 合并成一句「暂无数据」是最省事也最坑人的写法。
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppState } from '../../state/contexts';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { DoctorCard } from './DoctorCard';
import { TEXTS } from '../../constants/texts';
import { isDateInRange, todayDateKey } from '../../lib/date';
import type { Doctor } from '../../types/domain';

/** 今天是否落在该医生的任一段请假区间内 */
export function isOnLeave(doctor: Doctor, date: string): boolean {
  return (doctor.leaves ?? []).some((leave) => isDateInRange(date, leave.start, leave.end));
}

/** 按姓名做大小写无关的包含匹配；空关键词直接返回原数组引用 */
export function filterDoctors(doctors: readonly Doctor[], keyword: string): readonly Doctor[] {
  const needle = keyword.trim().toLowerCase();
  if (needle === '') {
    return doctors;
  }
  return doctors.filter((doctor) => doctor.name.toLowerCase().includes(needle));
}

export function DoctorPanel(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { doctorSearch, highlightDoctorId } = state.ui;

  const handleEdit = useCallback(
    (doctorId: string): void => {
      dispatch({ type: 'ui/openDoctorDrawer', payload: { doctorId } });
    },
    [dispatch],
  );

  const visible = filterDoctors(state.doctors, doctorSearch);
  const today = todayDateKey();
  const searching = doctorSearch.trim() !== '';

  return (
    <div className="doctor-panel">
      <div className="search-field">
        <Icon name="search" size={14} className="search-field__icon" />
        <input
          className="search-field__input"
          type="search"
          autoComplete="off"
          value={doctorSearch}
          placeholder={TEXTS.doctorSearchPlaceholder}
          aria-label={TEXTS.doctorSearchPlaceholder}
          onChange={(event) =>
            dispatch({ type: 'ui/patch', payload: { doctorSearch: event.target.value } })
          }
        />
        {searching && (
          <IconButton
            icon="close"
            label={TEXTS.searchClear}
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'ui/patch', payload: { doctorSearch: '' } })}
          />
        )}
      </div>

      <div className="doctor-panel__meta">
        <span className="doctor-panel__count">{TEXTS.doctorCountLabel(state.doctors.length)}</span>
        <Button
          variant="primary"
          size="sm"
          icon="plus"
          onClick={() => dispatch({ type: 'ui/openDoctorDrawer', payload: { doctorId: null } })}
        >
          {TEXTS.doctorAdd}
        </Button>
      </div>

      {visible.length > 0 ? (
        <ul className="doctor-list">
          {visible.map((doctor) => (
            <li key={doctor.id}>
              <DoctorCard
                doctor={doctor}
                highlighted={doctor.id === highlightDoctorId}
                onLeaveToday={isOnLeave(doctor, today)}
                onEdit={handleEdit}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-empty">{searching ? TEXTS.doctorFilterEmpty : TEXTS.doctorEmpty}</p>
      )}
    </div>
  );
}
