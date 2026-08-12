/**
 * 数据备份：导出全量 JSON / 从 JSON 恢复。
 *
 * ⚠️ 这个文件不在 DESIGN 2.9 的 T05 清单里，是实现「左栏底部 · 数据备份」入口时补的。
 * 理由：恢复逻辑必须复用 `storageSchema` 的迁移与归一化管线（否则一份旧版本备份
 * 导进来就是脏数据），这段逻辑放进组件既没法单测，也会把 DoctorPanel 顶破 300 行。
 *
 * 恢复的安全底线：
 * 1. 先 `migrateBundle()` 再归一化，老版本备份文件必须能被今天的应用读懂。
 * 2. 任何字段缺失都降级为默认值而不是抛错——用户手上那份文件是他唯一的副本，
 *    宁可导进来一部分，也不能因为一个字段不认识就整份拒绝。
 * 3. 解析失败返回结构化错误，由 UI 提示，绝不 throw 到 React 边界外。
 * 4. **排班条目必须与名册对齐**：只保留 doctorId 在册的条目（QA-BUG-02）。
 */

import type { SchedulesByMonth } from '../types/domain';
import type { DataSnapshot } from '../types/state';
import { SCHEMA_VERSION } from '../constants/defaults';
import { isValidMonthKey } from './date';
import { doctorIdSet, pruneOrphanEntries } from './dataShape';
import { downloadText } from './download';
import type { RawBundle } from './storageSchema';
import {
  isObject,
  migrateBundle,
  normalizeDoctors,
  normalizeMonthSchedule,
  normalizeRules,
} from './storageSchema';

/** 备份文件的顶层结构 */
export interface BackupFile {
  app: 'warmshift';
  schemaVersion: number;
  /** ISO 字符串，仅供人肉辨认，不参与恢复逻辑 */
  exportedAt: string;
  data: DataSnapshot;
}

export type RestoreResult =
  | { ok: true; snapshot: DataSnapshot; migratedFrom: number | null }
  | { ok: false; error: string };

/** 备份文件名：`医键排班数据备份-20260809.json` */
export function backupFileName(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `医键排班数据备份-${y}${m}${d}.json`;
}

/** 序列化为可读 JSON（缩进 2 空格，方便用户自己打开核对） */
export function buildBackupJson(snapshot: DataSnapshot, now: Date = new Date()): string {
  const file: BackupFile = {
    app: 'warmshift',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data: {
      doctors: snapshot.doctors,
      rules: snapshot.rules,
      schedules: snapshot.schedules,
    },
  };
  return JSON.stringify(file, null, 2);
}

/** 组装并触发下载，返回文件名供 toast 展示 */
export function exportBackup(snapshot: DataSnapshot): string {
  const fileName = backupFileName();
  downloadText(buildBackupJson(snapshot), fileName, 'application/json;charset=utf-8');
  return fileName;
}

/**
 * 解析备份文本。
 * 兼容两种形态：带 `data` 包装的标准备份，以及直接是 `{doctors, rules, schedules}` 的裸快照
 * （用户从别处手工拼的文件、或早期版本导出的内容）。
 */
export function parseBackup(text: string): RestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，请确认选择的是备份文件' };
  }
  if (!isObject(parsed)) {
    return { ok: false, error: '备份文件内容为空或格式不正确' };
  }

  const payload = isObject(parsed.data) ? parsed.data : parsed;
  const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `备份文件版本（v${version}）高于当前应用（v${SCHEMA_VERSION}），请先升级后再恢复`,
    };
  }

  const rawSchedules = isObject(payload.schedules) ? payload.schedules : {};
  const input: RawBundle = {
    schemaVersion: version,
    doctors: payload.doctors,
    rules: payload.rules,
    schedules: rawSchedules,
  };

  try {
    const { bundle, migratedFrom } = migrateBundle(input, SCHEMA_VERSION);

    // 名册先归一化：它是判定「谁在册」的唯一权威，孤儿过滤依赖它，必须排在排班之前。
    const doctors = normalizeDoctors(bundle.doctors);
    const knownIds = doctorIdSet(doctors);

    const schedules: SchedulesByMonth = {};
    for (const [month, value] of Object.entries(bundle.schedules)) {
      if (!isValidMonthKey(month)) {
        continue;
      }
      // QA-BUG-02：删过医生再导出的备份里会残留孤儿条目，导进来会让统计与校验双双失真。
      // 归一化之后立刻按名册过滤，孤儿数据不进 state 一步。
      const monthSchedule = pruneOrphanEntries(normalizeMonthSchedule(value), knownIds);
      if (Object.keys(monthSchedule).length > 0) {
        schedules[month] = monthSchedule;
      }
    }
    return {
      ok: true,
      snapshot: {
        doctors,
        rules: normalizeRules(bundle.rules),
        schedules,
      },
      migratedFrom,
    };
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : '备份文件解析失败',
    };
  }
}
