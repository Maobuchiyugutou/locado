import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_PREFIX,
  createBackup,
  createSafetyBackup,
  flushAutoBackup,
  listBackups,
  onBackupError,
  readBackupSnapshot,
  scheduleAutoBackup,
} from "../src/backups.ts";

class MemoryStorage {
  constructor() { this.data = new Map(); this.failPrefix = null; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (this.failPrefix && key.startsWith(this.failPrefix)) throw new Error("write failed");
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
  key(index) { return [...this.data.keys()][index] ?? null; }
  get length() { return this.data.size; }
}

function raw(id) {
  return JSON.stringify({
    projects: [{ id: "inbox", name: "收集箱" }], tags: [], tasks: [{ id, title: id }],
    filters: [], habits: [], focusRecords: [],
  });
}

onBackupError(() => {});

test("自动备份去重，恢复前保护始终单独保留", () => {
  globalThis.localStorage = new MemoryStorage();
  const value = raw("same");
  assert.equal(createBackup(value, "auto").duplicate, false);
  assert.equal(createBackup(value, "auto").duplicate, true);
  assert.equal(listBackups().length, 1);
  createSafetyBackup(value);
  const backups = listBackups();
  assert.equal(backups.length, 2);
  assert.equal(backups[0].reason, "before-restore");
  assert.equal(readBackupSnapshot(backups[0].key).data.tasks[0].id, "same");
});

test("连续修改只保留最后一次自动备份", () => {
  globalThis.localStorage = new MemoryStorage();
  scheduleAutoBackup(raw("old"));
  scheduleAutoBackup(raw("latest"));
  assert.equal(listBackups().length, 0);
  flushAutoBackup();
  const backups = listBackups();
  assert.equal(backups.length, 1);
  assert.equal(readBackupSnapshot(backups[0].key).data.tasks[0].id, "latest");
});

test("轮转最多保留最新五份且先写新备份", () => {
  globalThis.localStorage = new MemoryStorage();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-30T08:00:00") });
  try {
    for (let i = 0; i < 7; i++) { createBackup(raw(`task-${i}`), "auto"); mock.timers.tick(1); }
  } finally { mock.timers.reset(); }
  const backups = listBackups();
  assert.equal(backups.length, 5);
  assert.equal(readBackupSnapshot(backups[0].key).data.tasks[0].id, "task-6");
  assert.equal(readBackupSnapshot(backups[4].key).data.tasks[0].id, "task-2");
});

test("损坏备份会标记且不能读取恢复", () => {
  globalThis.localStorage = new MemoryStorage();
  createBackup(raw("valid"), "auto");
  localStorage.setItem(BACKUP_PREFIX + "999.bad", "{broken");
  const invalid = listBackups().find((item) => !item.valid);
  assert.ok(invalid);
  assert.throws(() => readBackupSnapshot(invalid.key));
  const valid = listBackups().find((item) => item.valid);
  assert.equal(readBackupSnapshot(valid.key).data.tasks[0].id, "valid");
});

test("备份写失败不影响已有备份，保护备份失败会抛错", () => {
  globalThis.localStorage = new MemoryStorage();
  for (let i = 0; i < 5; i++) createBackup(raw(`safe-${i}`), "auto");
  localStorage.failPrefix = BACKUP_PREFIX;
  assert.throws(() => createSafetyBackup(raw("new")));
  assert.equal(listBackups().length, 5);
  assert.doesNotThrow(() => { scheduleAutoBackup(raw("new")); flushAutoBackup(); });
  assert.equal(listBackups().length, 5);
});
