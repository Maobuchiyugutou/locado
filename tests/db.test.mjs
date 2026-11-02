import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSnapshotImport, createLocalStore, normalizeSnapshot, onStorageError, SNAPSHOT_KEY } from "../src/db.ts";
import { flushAutoBackup, listBackups } from "../src/backups.ts";

class MemoryStorage {
  constructor() { this.data = new Map(); this.failPrefix = null; this.readFailPrefix = null; }
  getItem(key) {
    if (this.readFailPrefix && key.startsWith(this.readFailPrefix)) throw new Error("read failed");
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    if (this.failPrefix && key.startsWith(this.failPrefix)) throw new Error("write failed");
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
  key(index) { return [...this.data.keys()][index] ?? null; }
  get length() { return this.data.size; }
}

test("旧快照补默认值并保留显式四象限字段", () => {
  const { snap, warnings } = normalizeSnapshot({
    projects: [{ id: "inbox", name: "收集箱" }],
    tags: [{ id: "urgent", name: "紧急" }],
    tasks: [
      { id: "legacy", projectId: "inbox", title: "旧任务", priority: 5, tags: ["urgent", "missing"] },
      { id: "classified", projectId: "inbox", title: "已分类", important: true, urgent: false },
    ],
  });
  const legacy = snap.tasks.find((t) => t.id === "legacy");
  const classified = snap.tasks.find((t) => t.id === "classified");
  assert.equal(legacy.important, undefined);
  assert.equal(legacy.urgent, undefined);
  assert.deepEqual(legacy.tags, ["urgent"]);
  assert.equal(legacy.completed, false);
  assert.equal(legacy.completedAt, null);
  assert.equal(legacy.recurrence, undefined);
  assert.equal(classified.important, true);
  assert.equal(classified.urgent, false);
  assert.ok(warnings.some((w) => w.includes("标签引用失效")));
});

test("快照规整保留有效重复字段并丢弃非法规则", () => {
  const { snap } = normalizeSnapshot({
    projects: [{ id: "inbox", name: "收集箱" }],
    tasks: [
      {
        id: "repeat", projectId: "inbox", title: "重复",
        recurrence: { kind: "weekly", weekdays: [5, 1, 5, 9] },
        recurrenceSourceId: "previous", recurrenceNextId: "next",
      },
      {
        id: "invalid", projectId: "inbox", title: "非法",
        recurrence: { kind: "monthly", day: 32 }, recurrenceNextId: "orphan",
      },
    ],
  });
  const repeat = snap.tasks.find((task) => task.id === "repeat");
  const invalid = snap.tasks.find((task) => task.id === "invalid");
  assert.deepEqual(repeat.recurrence, { kind: "weekly", weekdays: [1, 5] });
  assert.equal(repeat.recurrenceSourceId, "previous");
  assert.equal(repeat.recurrenceNextId, "next");
  assert.equal(invalid.recurrence, undefined);
  assert.equal(invalid.recurrenceNextId, undefined);
});

test("异常快照输入不会导致白屏", () => {
  for (const raw of [null, undefined, 42, "broken", [], { tasks: [null, 7, "bad"] }]) {
    const { snap } = normalizeSnapshot(raw);
    assert.ok(Array.isArray(snap.projects));
    assert.ok(Array.isArray(snap.tasks));
    assert.ok(Array.isArray(snap.focusRecords));
  }
});

test("本地存储写入、标签删除、番茄幂等和损坏备份", async () => {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  const db = createLocalStore();
  const snap = await db.load();

  const task = snap.tasks[0];
  task.important = true;
  task.urgent = false;
  await db.saveTask(task);
  let disk = JSON.parse(storage.getItem(SNAPSHOT_KEY));
  assert.equal(disk.tasks.find((t) => t.id === task.id).important, true);
  assert.equal(disk.tasks.find((t) => t.id === task.id).urgent, false);
  flushAutoBackup();
  assert.ok(listBackups().some((backup) => backup.valid && backup.reason === "auto"));

  const batchTask = { ...task, id: "batch-task", title: "批量新增" };
  await db.saveTasks([{ ...task, title: "批量更新" }, batchTask]);
  disk = JSON.parse(storage.getItem(SNAPSHOT_KEY));
  assert.equal(disk.tasks.find((t) => t.id === task.id).title, "批量更新");
  assert.equal(disk.tasks.find((t) => t.id === "batch-task").title, "批量新增");
  await db.saveTasks([], ["batch-task"]);
  disk = JSON.parse(storage.getItem(SNAPSHOT_KEY));
  assert.equal(disk.tasks.some((t) => t.id === "batch-task"), false);
  assert.equal(disk.tasks.some((t) => t.id === task.id), true);

  const tagId = snap.tags[0].id;
  await db.deleteTag(tagId);
  const afterTagDelete = await db.reload();
  assert.equal(afterTagDelete.tags.some((t) => t.id === tagId), false);
  assert.ok(afterTagDelete.tasks.every((t) => !t.tags.includes(tagId)));

  const record = { id: "focus-one", startedAt: 1000, minutes: 25, taskId: null };
  await db.saveFocusRecord(record);
  await db.saveFocusRecord({ ...record, minutes: 45 });
  const afterFocus = await db.reload();
  assert.equal(afterFocus.focusRecords.filter((item) => item.id === record.id).length, 1);
  assert.equal(afterFocus.focusRecords.find((item) => item.id === record.id).minutes, 45);

  storage.setItem(SNAPSHOT_KEY, "{broken-json");
  const recovered = await db.reload();
  assert.ok(recovered.tasks.length > 0);
  const corruptKey = [...storage.data.keys()].find((key) => key.startsWith(SNAPSHOT_KEY + ".corrupt."));
  assert.ok(corruptKey);
  assert.equal(storage.getItem(corruptKey), "{broken-json");
});

function taskFrom(snap, id, title = id) {
  return {
    ...structuredClone(snap.tasks[0]), id, title, completed: false, completedAt: null,
    dueDate: null, hasTime: false, reminderMinutesBefore: null, reminded: false,
    recurrence: undefined, recurrenceSourceId: undefined, recurrenceNextId: undefined,
  };
}

async function withWebLocks(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let chain = Promise.resolve();
  const locks = {
    request(_name, callback) {
      const result = chain.then(callback);
      chain = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
  try { return await run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
}

test("JSON 导入拒绝结构不完整、无效记录和重复 ID", () => {
  const valid = {
    projects: [{ id: "inbox" }], tags: [], tasks: [{ id: "task" }],
    filters: [], habits: [], focusRecords: [],
  };
  assert.doesNotThrow(() => assertSnapshotImport(valid));
  const duplicate = { ...valid, tasks: [{ id: "same" }, { id: "same" }] };
  const invalid = [
    null, [], { tasks: [], projects: [] },
    { ...valid, tasks: [null] },
    { ...valid, projects: [{ name: "缺少 ID" }] },
    { ...valid, filters: {} },
    duplicate,
  ];
  for (const value of invalid) assert.throws(() => assertSnapshotImport(value));
});

test("写入失败会 reject 且不污染磁盘或缓存", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  const db = createLocalStore();
  const snap = await db.load();
  const originalRaw = storage.getItem(SNAPSHOT_KEY);
  storage.failPrefix = SNAPSHOT_KEY;
  await assert.rejects(db.updateTask({ ...snap.tasks[0], title: "不应保存" }));
  assert.equal(storage.getItem(SNAPSHOT_KEY), originalRaw);
  storage.failPrefix = null;
  const cached = await db.load();
  assert.equal(cached.tasks[0].title, snap.tasks[0].title);
});

test("损坏原文副本写入失败时保留原始主键", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  storage.setItem(SNAPSHOT_KEY, "{broken-json");
  storage.failPrefix = SNAPSHOT_KEY + ".corrupt.";
  const db = createLocalStore();
  await assert.rejects(db.reload());
  assert.equal(storage.getItem(SNAPSHOT_KEY), "{broken-json");
  assert.equal([...storage.data.keys()].some((key) => key.startsWith(SNAPSHOT_KEY + ".corrupt.")), false);
});

test("读取失败不会用示例数据覆盖原快照", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  storage.setItem(SNAPSHOT_KEY, "{still-protected");
  storage.readFailPrefix = SNAPSHOT_KEY;
  const db = createLocalStore();
  await assert.rejects(db.load());
  storage.readFailPrefix = null;
  assert.equal(storage.getItem(SNAPSHOT_KEY), "{still-protected");
});

test("共享 Web Locks 下并发新增不会互相覆盖", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  await withWebLocks(async () => {
    const a = createLocalStore();
    const b = createLocalStore();
    const snap = await a.load();
    await b.load();
    await Promise.all([
      a.saveTask(taskFrom(snap, "from-a")),
      b.saveTask(taskFrom(snap, "from-b")),
    ]);
    const finalSnap = await a.reload();
    assert.ok(finalSnap.tasks.some((task) => task.id === "from-a"));
    assert.ok(finalSnap.tasks.some((task) => task.id === "from-b"));
  });
});

test("其它实例删除后，旧编辑不会复活任务", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  const a = createLocalStore();
  const b = createLocalStore();
  const snap = await a.load();
  const task = snap.tasks[0];
  await b.deleteTask(task.id);
  await a.updateTask({ ...task, title: "过期编辑" });
  const finalSnap = await a.reload();
  assert.equal(finalSnap.tasks.some((item) => item.id === task.id), false);
});

test("并发提醒认领只有一个成功且只落盘一次状态", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  await withWebLocks(async () => {
    const a = createLocalStore();
    const b = createLocalStore();
    const snap = await a.load();
    const at = Date.now() + 1000;
    const task = { ...taskFrom(snap, "reminder"), dueDate: at, hasTime: true, reminderMinutesBefore: 0 };
    await a.saveTask(task);
    const claims = await Promise.all([
      a.claimReminder(task.id, at, at),
      b.claimReminder(task.id, at, at),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const finalSnap = await a.reload();
    assert.equal(finalSnap.tasks.find((item) => item.id === task.id).reminded, true);
  });
});

test("启动补查只系统通知十二小时内的提醒，较早提醒会标记为遗漏", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  const db = createLocalStore();
  const snap = await db.load();
  const now = Date.now();
  const recentAt = now - 12 * 3600000 + 1000;
  const oldAt = now - 12 * 3600000 - 1000;
  const recent = { ...taskFrom(snap, "recent-reminder"), dueDate: recentAt, hasTime: true, reminderMinutesBefore: 0 };
  const old = { ...taskFrom(snap, "old-reminder"), dueDate: oldAt, hasTime: true, reminderMinutesBefore: 0 };
  await db.saveTasks([recent, old]);
  const recentClaim = await db.claimReminder(recent.id, recentAt, now);
  const oldClaim = await db.claimReminder(old.id, oldAt, now);
  assert.equal(recentClaim.notify, true);
  assert.equal(oldClaim.notify, false);
});

test("提醒认领写失败不会返回可通知结果", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  const db = createLocalStore();
  const snap = await db.load();
  const at = Date.now() + 1000;
  const task = { ...taskFrom(snap, "reminder-failure"), dueDate: at, hasTime: true, reminderMinutesBefore: 0 };
  await db.saveTask(task);
  const originalRaw = storage.getItem(SNAPSHOT_KEY);
  storage.failPrefix = SNAPSHOT_KEY;
  await assert.rejects(db.claimReminder(task.id, at, at));
  assert.equal(storage.getItem(SNAPSHOT_KEY), originalRaw);
});

test("过期编辑不会重置其它实例已认领的提醒", async () => {
  flushAutoBackup();
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  onStorageError(() => {});
  const a = createLocalStore();
  const b = createLocalStore();
  const snap = await a.load();
  const at = Date.now() + 60000;
  const task = { ...taskFrom(snap, "reminded"), dueDate: at, hasTime: true, reminderMinutesBefore: 0 };
  await a.saveTask(task);
  const claim = await b.claimReminder(task.id, at, at);
  assert.ok(claim);
  await a.updateTask({ ...task, title: "仅修改标题", reminded: false });
  const finalSnap = await a.reload();
  const updated = finalSnap.tasks.find((item) => item.id === task.id);
  assert.equal(updated.title, "仅修改标题");
  assert.equal(updated.reminded, true);
});
