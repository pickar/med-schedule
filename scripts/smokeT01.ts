// T01 地基层烟测：验证 storage 往返、迁移入口、日期工具、常量一致性。
// 不参与 src 构建（tsconfig include 仅 ["src"]），验证完可删。
import { memoryStorage } from './smokeShim';
import { clearAll, listStoredMonths, loadAllDetailed, saveAll, saveAllSafe } from '../src/lib/storage';
import { createDefaultRules, createSampleDoctors, SCHEMA_VERSION, STORAGE_KEYS } from '../src/constants/defaults';
import { SHIFT_METAS, SHIFT_ORDER, getShiftMeta, isShiftType } from '../src/constants/shifts';
import { addDays, getDaysInMonth, getWeekday, listMonthDates, shiftMonth, formatMD } from '../src/lib/date';
import { csvFileName, pngFileName, TEXTS } from '../src/constants/texts';
import { createId } from '../src/lib/id';

const fails: string[] = [];
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

console.log('--- 日期工具 ---');
check('2026-02 天数 = 28', getDaysInMonth('2026-02') === 28);
check('2024-02 天数 = 29（闰年）', getDaysInMonth('2024-02') === 29);
check('2026-08 天数 = 31', getDaysInMonth('2026-08') === 31);
check('2026-08-01 是周六(6)', getWeekday('2026-08-01') === 6, String(getWeekday('2026-08-01')));
check('本地时区无偏移：2026-08-01 -> 8/1', formatMD('2026-08-01') === '8/1');
check('跨月加一天', addDays('2026-08-31', 1) === '2026-09-01');
check('月份平移 -1', shiftMonth('2026-01', -1) === '2025-12');
check('listMonthDates 长度 31', listMonthDates('2026-08').length === 31);

console.log('--- 常量 ---');
check('11 种班次', SHIFT_ORDER.length === 11, String(SHIFT_ORDER.length));
check('每个班次都有元数据', SHIFT_ORDER.every((k) => SHIFT_METAS[k] && SHIFT_METAS[k].key === k));
check('rest / postNightRest isWork=false', !SHIFT_METAS.rest.isWork && !SHIFT_METAS.postNightRest.isWork);
check(
  '急诊/连班/副班/总值班 不自动分配',
  (['emergency', 'continuousShift', 'deputyShift', 'chiefDuty'] as const).every((k) => !SHIFT_METAS[k].autoAssignable),
);
check('未知 key 降级为休息', getShiftMeta('nope' as never).key === 'rest');
check('isShiftType 守卫', isShiftType('nightShift') && !isShiftType('nope'));
check('CSV 月份补零', csvFileName('内分泌科', '2026-08') === '内分泌科202608排班表.csv', csvFileName('内分泌科', '2026-08'));
check('PNG 月份不补零', pngFileName('2026-08') === '2026年8月排班表.png', pngFileName('2026-08'));
check('竞品原文提示语未被改写', TEXTS.shiftCountHint === '左侧按钮调最小值，右侧按钮调最大值。系统会尽量安排到上限，人数不足时取下限。');
check('createId 唯一', createId() !== createId());

console.log('--- storage 往返 ---');
const doctors = createSampleDoctors(createId);
const rules = createDefaultRules();
rules.departmentName = '内分泌科';
const schedules = {
  '2026-08': {
    '2026-08-01': {
      [doctors[0].id]: { doctorId: doctors[0].id, shiftType: 'nightShift' as const, isRotation: false, locked: true },
      [doctors[1].id]: { doctorId: doctors[1].id, shiftType: 'clinic' as const, isRotation: true },
    },
  },
  '2026-09': {
    '2026-09-02': {
      [doctors[2].id]: { doctorId: doctors[2].id, shiftType: 'rest' as const, isRotation: false },
    },
  },
};

saveAll({ doctors, rules, schedules });
const loaded = loadAllDetailed();
check('读取无错误', loaded.error === null, String(loaded.error));
check('医生数还原 10', loaded.snapshot?.doctors.length === 10);
check('科室名还原', loaded.snapshot?.rules.departmentName === '内分泌科');
check('月份索引 2 个', listStoredMonths().length === 2, listStoredMonths().join(','));
check('锁定格还原', loaded.snapshot?.schedules['2026-08']['2026-08-01'][doctors[0].id].locked === true);
check('isRotation 还原', loaded.snapshot?.schedules['2026-08']['2026-08-01'][doctors[1].id].isRotation === true);
check('meta 带 schemaVersion', JSON.parse(memoryStorage.getItem(STORAGE_KEYS.meta) as string).schemaVersion === SCHEMA_VERSION);
check('排班按月分 key', memoryStorage.getItem(`${STORAGE_KEYS.schedules}:2026-08`) !== null);

console.log('--- 删除月份后残留清理 ---');
saveAll({ doctors, rules, schedules: { '2026-08': schedules['2026-08'] } });
check('9 月 key 已清理', memoryStorage.getItem(`${STORAGE_KEYS.schedules}:2026-09`) === null);
check('月份索引剩 1 个', listStoredMonths().length === 1);

console.log('--- 脏数据不清空 ---');
memoryStorage.setItem(STORAGE_KEYS.doctors, '{ 这不是合法 JSON');
const broken = loadAllDetailed();
check('解析失败返回 null 而非抛异常', broken.snapshot === null);
check('原始数据已备份', memoryStorage.getItem(STORAGE_KEYS.backup) !== null);

console.log('--- 低版本迁移入口 ---');
clearAll();
saveAll({ doctors, rules, schedules });
memoryStorage.setItem(STORAGE_KEYS.meta, JSON.stringify({ schemaVersion: 0, months: ['2026-08', '2026-09'], savedAt: 1 }));
const legacy = loadAllDetailed();
check('低版本不清空数据', legacy.snapshot !== null && legacy.snapshot.doctors.length === 10);

console.log('--- 写入失败可捕获 ---');
const original = memoryStorage.setItem.bind(memoryStorage);
memoryStorage.setItem = () => {
  throw new Error('QuotaExceeded simulated');
};
const r = saveAllSafe({ doctors, rules, schedules });
check('saveAllSafe 返回 ok=false', r.ok === false, JSON.stringify(r));
let threw = false;
try {
  saveAll({ doctors, rules, schedules });
} catch {
  threw = true;
}
check('saveAll 向上抛出可捕获错误', threw);
memoryStorage.setItem = original;

console.log('');
if (fails.length > 0) {
  console.log(`SMOKE FAILED: ${fails.length} 项 -> ${fails.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log('SMOKE PASSED: 全部检查通过');
}
