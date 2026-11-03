import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSnapshotImport,
  createLocalStore,
  normalizeSnapshot,
  onStorageError,
  SNAPSHOT_KEY,
} from "../src/db.ts";
import {
  CURRENT_SCHEMA_VERSION,
  migrateSnapshotRecord,
  UnsupportedSchemaVersionError,
} from "../src/migrations.ts";
import { BACKUP_PREFIX, listBackups, readBackupSnapshot } from "../src/backups.ts";

class MemoryStorage {
  constructor() { this.data = new Map(); this.failPrefix = null; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (this.failPrefix && key.startsWith(this.failPrefix)) throw new Error("write failed");
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
  key(index) { return [...this.data.keys()][index] ?? null; }
  get length() { return this.data.size; }
}

function legacySnapshot() {
  return {
    projects: [{ id: "inbox", name: "收集箱" }],
    tags: [],
    tasks: [{
      id: "history", projectId: "inbox", title: "历史任务", completed: true,
      completedAt: 123456, createdAt: 100000, updatedAt: 123456,
      tags: [], subtasks: [],
    }],
    filters: [],
    habits: [{ id: "habit", name: "阅读", checkins: ["2026-10-1"] }],
    focusRecords: [],
  };
}

onStorageError(() => {});

test("无版本号的旧快照升级到当前版本并保留历史字段", () => {
  const legacy = legacySnapshot();
  const result = normalizeSnapshot(legacy);
  assert.equal(result.sourceVersion, 1);
  assert.equal(result.migrated, true);
  assert.equal(result.snap.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(result.snap.tasks[0].id, "history");
  assert.equal(result.snap.tasks[0].completedAt, 123456);
  assert.equal(result.snap.tasks[0].createdAt, 100000);
  assert.deepEqual(result.snap.habits[0].checkins, ["2026-10-1"]);
  assert.doesNotThrow(() => assertSnapshotImport(legacy));
});

test("当前版本不会重复迁移，未来版本明确拒绝", () => {
  const current = { ...legacySnapshot(), schemaVersion: CURRENT_SCHEMA_VERSION };
  const result = migrateSnapshotRecord(current);
  assert.equal(result.migrated, false);
  assert.deepEqual(result.data, current);
  assert.throws(
    () => normalizeSnapshot({ ...current, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
    UnsupportedSchemaVersionError,
  );
});

test("本地旧数据先保留迁移前原文再写入新版本", async () => {
  globalThis.localStorage = new MemoryStorage();
  const legacy = legacySnapshot();
  const original = JSON.stringify(legacy);
  localStorage.setItem(SNAPSHOT_KEY, original);
  const db = createLocalStore();
  const snap = await db.load();
  assert.equal(snap.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(snap.tasks[0].id, "history");
  assert.equal(JSON.parse(localStorage.getItem(SNAPSHOT_KEY)).schemaVersion, CURRENT_SCHEMA_VERSION);

  const backups = listBackups();
  const protection = backups.find((backup) => backup.reason === "before-migration");
  assert.ok(protection);
  assert.equal(readBackupSnapshot(protection.key).data.schemaVersion, undefined);
  assert.equal(readBackupSnapshot(protection.key).data.tasks[0].id, "history");
});

test("迁移前备份失败时保留原始主键且不启动应用", async () => {
  globalThis.localStorage = new MemoryStorage();
  const original = JSON.stringify(legacySnapshot());
  localStorage.setItem(SNAPSHOT_KEY, original);
  localStorage.failPrefix = BACKUP_PREFIX;
  const db = createLocalStore();
  await assert.rejects(() => db.load());
  assert.equal(localStorage.getItem(SNAPSHOT_KEY), original);
});

test("非对象存储不会误进迁移备份流程", async () => {
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem(SNAPSHOT_KEY, "null");
  const db = createLocalStore();
  const snap = await db.load();
  assert.equal(snap.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(listBackups().some((backup) => backup.reason === "before-migration"), false);
});

test("未来版本数据在读取和后续写入中都保持原文不变", async () => {
  globalThis.localStorage = new MemoryStorage();
  const future = JSON.stringify({ ...legacySnapshot(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
  localStorage.setItem(SNAPSHOT_KEY, future);
  const db = createLocalStore();
  await assert.rejects(() => db.load(), UnsupportedSchemaVersionError);
  await assert.rejects(() => db.saveTask({ id: "new-task" }), UnsupportedSchemaVersionError);
  assert.equal(localStorage.getItem(SNAPSHOT_KEY), future);
});
