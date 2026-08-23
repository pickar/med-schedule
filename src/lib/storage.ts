/**
 * localStorage 持久化：读写、schemaVersion 迁移入口、失败捕获。
 * 数据归一化与迁移函数见同目录 `storageSchema.ts`。
 *
 * 核心原则（P0-1）：
 * 1. **读取失败绝不静默清空用户数据** —— 解析失败时把原始字符串备份到
 *    `warmshift:v1:backup`，返回 null 让上层用默认值兜底并提示。
 * 2. **写入失败绝不静默吞掉** —— 隐私模式 / 超配额时抛出 `StorageError`，
 *    由 UI 层捕获并展示「数据未能保存到本地，请勿关闭页面」。
 * 3. 排班按 'YYYY-MM' 分月存储，避免单 key 过大导致整体写入失败。
 */

import type { SchedulesByMonth } from '../types/domain';
import type { DataSnapshot } from '../types/state';
import { SCHEMA_VERSION, STORAGE_KEYS, scheduleStorageKey } from '../constants/defaults';
import { isValidMonthKey } from './date';
import type { RawBundle } from './storageSchema';
import {
  isObject,
  migrateBundle,
  normalizeCustomShifts,
  normalizeDoctors,
  normalizeMonthSchedule,
  normalizeRules,
} from './storageSchema';

export type StorageErrorCode = 'unavailable' | 'quota' | 'serialize' | 'unknown';

/** 可捕获的存储错误，携带原因码供 UI 区分提示 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly reason: unknown;

  constructor(code: StorageErrorCode, message: string, reason?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.reason = reason;
  }
}

export interface StoredMeta {
  schemaVersion: number;
  /** 已存储的月份列表，用于增量清理与「有数据月圆点」 */
  months: string[];
  savedAt: number;
}

export interface LoadResult {
  snapshot: DataSnapshot | null;
  /** 非 null 时表示读取异常，原始数据已备份到 backup key */
  error: string | null;
  /** 发生过迁移时为迁移前的版本号 */
  migratedFrom: number | null;
}

// ============ 底层读写 ============

function getStore(): Storage {
  try {
    const store = globalThis.localStorage;
    if (!store) {
      throw new StorageError('unavailable', '当前环境不支持 localStorage');
    }
    return store;
  } catch (reason) {
    if (reason instanceof StorageError) {
      throw reason;
    }
    throw new StorageError('unavailable', '当前环境不支持 localStorage', reason);
  }
}

/** 探测存储是否可用（隐私模式下 setItem 会直接抛错） */
export function isStorageAvailable(): boolean {
  try {
    const probe = `${STORAGE_KEYS.meta}:probe`;
    const store = getStore();
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  try {
    return getStore().getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    getStore().setItem(key, value);
  } catch (reason) {
    if (reason instanceof StorageError) {
      throw reason;
    }
    const isQuota =
      reason instanceof DOMException && /quota|exceed/i.test(`${reason.name}${reason.message}`);
    throw new StorageError(
      isQuota ? 'quota' : 'unknown',
      isQuota ? '本地存储空间已满，无法保存' : '写入本地存储失败',
      reason,
    );
  }
}

function removeRaw(key: string): void {
  try {
    getStore().removeItem(key);
  } catch {
    // 删除失败不影响主流程，忽略
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw === '') {
    return null;
  }
  return JSON.parse(raw) as unknown;
}

function backupCorrupted(meta: string | null, doctors: string | null, rules: string | null): void {
  try {
    writeRaw(STORAGE_KEYS.backup, JSON.stringify({ at: Date.now(), meta, doctors, rules }));
  } catch {
    // 备份失败也不能影响主流程
  }
}

// ============ 对外 API ============

/** 读取全部数据；返回 null 表示无数据或读取失败（失败时已备份原始数据） */
export function loadAll(): DataSnapshot | null {
  return loadAllDetailed().snapshot;
}

/** 读取全部数据（带错误与迁移信息），供 UI 层做差异化提示 */
export function loadAllDetailed(): LoadResult {
  const rawMeta = readRaw(STORAGE_KEYS.meta);
  const rawDoctors = readRaw(STORAGE_KEYS.doctors);
  const rawRules = readRaw(STORAGE_KEYS.rules);
  const rawShifts = readRaw(STORAGE_KEYS.shifts);
  if (rawMeta === null && rawDoctors === null && rawRules === null && rawShifts === null) {
    return { snapshot: null, error: null, migratedFrom: null };
  }

  try {
    const meta = parseJson(rawMeta);
    const storedVersion =
      isObject(meta) && typeof meta.schemaVersion === 'number' ? meta.schemaVersion : SCHEMA_VERSION;
    const months =
      isObject(meta) && Array.isArray(meta.months) ? meta.months.filter(isValidMonthKey) : [];

    const rawSchedules: Record<string, unknown> = {};
    for (const month of months) {
      rawSchedules[month] = parseJson(readRaw(scheduleStorageKey(month)));
    }

    const input: RawBundle = {
      schemaVersion: storedVersion,
      doctors: parseJson(rawDoctors),
      rules: parseJson(rawRules),
      schedules: rawSchedules,
      customShifts: parseJson(rawShifts),
    };
    const { bundle, migratedFrom } = migrateBundle(input, SCHEMA_VERSION);

    const schedules: SchedulesByMonth = {};
    for (const [month, value] of Object.entries(bundle.schedules)) {
      const monthSchedule = normalizeMonthSchedule(value);
      if (Object.keys(monthSchedule).length > 0) {
        schedules[month] = monthSchedule;
      }
    }

    return {
      snapshot: {
        doctors: normalizeDoctors(bundle.doctors),
        rules: normalizeRules(bundle.rules),
        schedules,
        customShifts: normalizeCustomShifts(bundle.customShifts),
      },
      error: null,
      migratedFrom,
    };
  } catch (reason) {
    backupCorrupted(rawMeta, rawDoctors, rawRules);
    return {
      snapshot: null,
      error: reason instanceof Error ? reason.message : '本地数据解析失败',
      migratedFrom: null,
    };
  }
}

/** 写入全部数据；失败抛出 `StorageError`（隐私模式 / 超配额 / 序列化失败） */
export function saveAll(snapshot: DataSnapshot): void {
  let doctorsJson: string;
  let rulesJson: string;
  let shiftsJson: string;
  try {
    doctorsJson = JSON.stringify(snapshot.doctors);
    rulesJson = JSON.stringify(snapshot.rules);
    shiftsJson = JSON.stringify(snapshot.customShifts);
  } catch (reason) {
    throw new StorageError('serialize', '数据序列化失败', reason);
  }

  const months = Object.keys(snapshot.schedules).filter(isValidMonthKey).sort();
  const staleMonths = listStoredMonths().filter((m) => !months.includes(m));

  writeRaw(STORAGE_KEYS.doctors, doctorsJson);
  writeRaw(STORAGE_KEYS.rules, rulesJson);
  writeRaw(STORAGE_KEYS.shifts, shiftsJson);
  for (const month of months) {
    writeRaw(scheduleStorageKey(month), JSON.stringify(snapshot.schedules[month]));
  }
  // 清理已被删除月份的残留 key（先算后删，避免 meta 更新后丢失线索）
  for (const stale of staleMonths) {
    removeRaw(scheduleStorageKey(stale));
  }

  const meta: StoredMeta = { schemaVersion: SCHEMA_VERSION, months, savedAt: Date.now() };
  writeRaw(STORAGE_KEYS.meta, JSON.stringify(meta));
}

/** 写入全部数据的安全版本，把异常转成结果对象，供 AppProvider 直接消费 */
export function saveAllSafe(
  snapshot: DataSnapshot,
): { ok: boolean; error?: string; code?: StorageErrorCode } {
  try {
    saveAll(snapshot);
    return { ok: true };
  } catch (reason) {
    if (reason instanceof StorageError) {
      return { ok: false, error: reason.message, code: reason.code };
    }
    return { ok: false, error: '写入本地存储失败', code: 'unknown' };
  }
}

/** 已存储的月份列表（升序），供「有数据月圆点」使用 */
export function listStoredMonths(): string[] {
  let meta: unknown = null;
  try {
    meta = parseJson(readRaw(STORAGE_KEYS.meta));
  } catch {
    return [];
  }
  if (isObject(meta) && Array.isArray(meta.months)) {
    return meta.months.filter(isValidMonthKey).sort();
  }
  return [];
}

/** 清空本应用的全部数据（保留 backup，便于事后追溯） */
export function clearAll(): void {
  for (const month of listStoredMonths()) {
    removeRaw(scheduleStorageKey(month));
  }
  removeRaw(STORAGE_KEYS.doctors);
  removeRaw(STORAGE_KEYS.rules);
  removeRaw(STORAGE_KEYS.shifts);
  removeRaw(STORAGE_KEYS.meta);
}
