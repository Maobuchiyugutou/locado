export const BACKUP_PREFIX = "locado.snapshot.v1.backup.";
const BACKUP_LIMIT = 5;
const AUTO_BACKUP_DELAY = 3000;

export type BackupReason = "auto" | "before-restore";

interface BackupRecord {
  v: 1;
  createdAt: number;
  reason: BackupReason;
  raw: string;
}

export interface BackupSummary {
  key: string;
  createdAt: number;
  reason: BackupReason;
  valid: boolean;
  tasks: number;
  projects: number;
  tags: number;
}

export interface BackupWriteResult {
  key: string;
  createdAt: number;
  duplicate: boolean;
}

interface BackupSnapshot extends Record<string, unknown> {
  tasks: unknown[];
  projects: unknown[];
  tags: unknown[];
}

function snapshotFromRaw(raw: string): BackupSnapshot {
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== "object") throw new Error("备份内容无效");
  const snapshot = value as BackupSnapshot;
  if (!Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.tags)) {
    throw new Error("备份缺少必要数据");
  }
  return snapshot;
}

function readRecord(key: string): { record: BackupRecord; snapshot: BackupSnapshot } {
  const stored = localStorage.getItem(key);
  if (!stored) throw new Error("备份不存在");
  const value: unknown = JSON.parse(stored);
  if (value === null || typeof value !== "object") throw new Error("备份格式无效");
  const record = value as Partial<BackupRecord>;
  if (record.v !== 1 || typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)
    || (record.reason !== "auto" && record.reason !== "before-restore") || typeof record.raw !== "string") {
    throw new Error("备份信息无效");
  }
  return { record: record as BackupRecord, snapshot: snapshotFromRaw(record.raw) };
}

function summary(key: string): BackupSummary {
  const fallbackTime = Number(key.slice(BACKUP_PREFIX.length).split(".")[0]) || 0;
  try {
    const { record, snapshot } = readRecord(key);
    return {
      key,
      createdAt: record.createdAt,
      reason: record.reason,
      valid: true,
      tasks: snapshot.tasks.length,
      projects: snapshot.projects.length,
      tags: snapshot.tags.length,
    };
  } catch {
    return { key, createdAt: fallbackTime, reason: "auto", valid: false, tasks: 0, projects: 0, tags: 0 };
  }
}

export function listBackups(): BackupSummary[] {
  const backups: BackupSummary[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(BACKUP_PREFIX)) backups.push(summary(key));
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key));
}

export function readBackupSnapshot(key: string): { data: Record<string, unknown>; createdAt: number; reason: BackupReason } {
  const { record, snapshot } = readRecord(key);
  return { data: snapshot, createdAt: record.createdAt, reason: record.reason };
}

let lastBackupCreatedAt = 0;

export function createBackup(raw: string, reason: BackupReason): BackupWriteResult {
  snapshotFromRaw(raw);
  if (reason === "auto") {
    const latest = listBackups().find((item) => item.valid);
    if (latest && readRecord(latest.key).record.raw === raw) {
      return { key: latest.key, createdAt: latest.createdAt, duplicate: true };
    }
  }

  const latestCreatedAt = listBackups().reduce((latest, backup) => Math.max(latest, backup.createdAt), 0);
  const createdAt = Math.max(Date.now(), lastBackupCreatedAt + 1, latestCreatedAt + 1);
  lastBackupCreatedAt = createdAt;
  const key = `${BACKUP_PREFIX}${createdAt}.${Math.random().toString(36).slice(2, 9)}`;
  const record: BackupRecord = { v: 1, createdAt, reason, raw };
  localStorage.setItem(key, JSON.stringify(record));
  const verified = readRecord(key);
  if (verified.record.raw !== raw) throw new Error("备份写入校验失败");

  for (const old of listBackups().slice(BACKUP_LIMIT)) localStorage.removeItem(old.key);
  return { key, createdAt, duplicate: false };
}

let pendingRaw: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let errorHandler: ((message: string) => void) | null = null;
let lastErrorAt = 0;

export function onBackupError(handler: (message: string) => void): void { errorHandler = handler; }

function report(message: string): void {
  if (Date.now() - lastErrorAt < 4000) return;
  lastErrorAt = Date.now();
  if (errorHandler) errorHandler(message);
  else console.warn("[Locado] " + message);
}

function cancelScheduled(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  pendingRaw = null;
}

export function flushAutoBackup(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  const raw = pendingRaw;
  pendingRaw = null;
  if (!raw) return;
  try { createBackup(raw, "auto"); }
  catch { report("自动备份失败，任务数据已正常保存。请检查浏览器存储空间。"); }
}

export function scheduleAutoBackup(raw: string): void {
  pendingRaw = raw;
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(flushAutoBackup, AUTO_BACKUP_DELAY);
  const nodeTimer = timer as unknown as { unref?: () => void };
  if (typeof nodeTimer.unref === "function") nodeTimer.unref();
}

export function createSafetyBackup(raw: string): BackupWriteResult {
  cancelScheduled();
  return createBackup(raw, "before-restore");
}
