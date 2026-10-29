import { test } from "node:test";
import assert from "node:assert/strict";
import { getDB, normalizeSnapshot, onStorageError, SNAPSHOT_KEY } from "../src/db.ts";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
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
  assert.equal(classified.important, true);
  assert.equal(classified.urgent, false);
  assert.ok(warnings.some((w) => w.includes("标签引用失效")));
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
  const db = getDB();
  const snap = await db.load();

  const task = snap.tasks[0];
  task.important = true;
  task.urgent = false;
  await db.saveTask(task);
  let disk = JSON.parse(storage.getItem(SNAPSHOT_KEY));
  assert.equal(disk.tasks.find((t) => t.id === task.id).important, true);
  assert.equal(disk.tasks.find((t) => t.id === task.id).urgent, false);

  const tagId = snap.tags[0].id;
  await db.deleteTag(tagId);
  assert.equal(snap.tags.some((t) => t.id === tagId), false);
  assert.ok(snap.tasks.every((t) => !t.tags.includes(tagId)));

  snap.focusRecords.length = 0;
  const record = { id: "focus-one", startedAt: 1000, minutes: 25, taskId: null };
  snap.focusRecords.push(record);
  await db.saveFocusRecord(record);
  await db.saveFocusRecord({ ...record, minutes: 45 });
  assert.equal(snap.focusRecords.length, 1);
  assert.equal(snap.focusRecords[0].minutes, 45);

  storage.setItem(SNAPSHOT_KEY, "{broken-json");
  const recovered = await db.reload();
  assert.ok(recovered.tasks.length > 0);
  const corruptKey = [...storage.data.keys()].find((key) => key.startsWith(SNAPSHOT_KEY + ".corrupt."));
  assert.ok(corruptKey);
  assert.equal(storage.getItem(corruptKey), "{broken-json");
});
