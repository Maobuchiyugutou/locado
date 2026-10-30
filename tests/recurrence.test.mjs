import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRecurringDue, nextRecurringDue, normalizeRecurrence, planRecurringToggle, recurrenceSummary } from "../src/recurrence.ts";

function local(y, m, d, h = 9, minute = 30) {
  return new Date(y, m - 1, d, h, minute, 0, 0).getTime();
}

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeTask(overrides = {}) {
  return {
    id: "one",
    projectId: "inbox",
    title: "重复任务",
    note: "备注",
    priority: 3,
    important: true,
    urgent: false,
    completed: false,
    completedAt: null,
    dueDate: local(2026, 1, 31),
    hasTime: true,
    reminderMinutesBefore: 30,
    reminded: true,
    pinned: true,
    tags: ["tag-one"],
    subtasks: [{ id: "sub-one", title: "子任务", completed: true }],
    createdAt: 100,
    updatedAt: 100,
    recurrence: { kind: "daily" },
    ...overrides,
  };
}

function applyPlan(tasks, plan) {
  const result = tasks.filter((task) => !plan.deleteIds.includes(task.id));
  for (const task of plan.upserts) {
    const index = result.findIndex((item) => item.id === task.id);
    if (index >= 0) result[index] = task; else result.push(task);
  }
  return result;
}

test("重复规则规整保留有效值并拒绝非法输入", () => {
  assert.deepEqual(normalizeRecurrence({ kind: "weekly", weekdays: [5, 1, 5, 9, -1] }), { kind: "weekly", weekdays: [1, 5] });
  assert.deepEqual(normalizeRecurrence({ kind: "monthly", day: "last" }), { kind: "monthly", day: "last" });
  for (const rule of [
    { kind: "weekly", weekdays: [] },
    { kind: "monthly", day: 32 },
    { kind: "yearly", month: 2, day: 30 },
    { kind: "afterCompletion", days: 0 },
    { kind: "unknown" },
  ]) assert.equal(normalizeRecurrence(rule), null);
});

test("固定重复规则按本地日历计算并保留时刻", () => {
  const start = local(2026, 10, 28, 18, 45);
  assert.equal(dateKey(nextRecurringDue({ kind: "daily" }, start, start)), "2026-10-29");
  assert.equal(new Date(nextRecurringDue({ kind: "daily" }, start, start)).getHours(), 18);
  assert.equal(dateKey(nextRecurringDue({ kind: "weekly", weekdays: [1, 5] }, start, start)), "2026-10-30");
  const january = local(2026, 1, 31);
  assert.equal(dateKey(nextRecurringDue({ kind: "monthly", day: "last" }, january, january)), "2026-02-28");
  assert.equal(dateKey(nextRecurringDue({ kind: "monthly", day: 31 }, january, january)), "2026-02-28");
  const leapDay = local(2024, 2, 29);
  assert.equal(dateKey(nextRecurringDue({ kind: "yearly", month: 2, day: 29 }, leapDay, leapDay)), "2025-02-28");
});

test("首次重复日期包含今天并保留时刻", () => {
  const thursday = local(2026, 10, 29, 18, 45);
  assert.equal(firstRecurringDue({ kind: "daily" }, thursday), thursday);
  assert.equal(firstRecurringDue({ kind: "afterCompletion", days: 3 }, thursday), thursday);
  assert.equal(dateKey(firstRecurringDue({ kind: "weekly", weekdays: [4] }, thursday)), "2026-10-29");
  assert.equal(dateKey(firstRecurringDue({ kind: "weekly", weekdays: [5] }, thursday)), "2026-10-30");
  assert.equal(new Date(firstRecurringDue({ kind: "weekly", weekdays: [4] }, thursday)).getHours(), 18);
  assert.equal(dateKey(firstRecurringDue({ kind: "monthly", day: 31 }, thursday)), "2026-10-31");
  assert.equal(dateKey(firstRecurringDue({ kind: "monthly", day: 31 }, local(2026, 11, 1))), "2026-11-30");
  assert.equal(dateKey(firstRecurringDue({ kind: "monthly", day: "last" }, local(2026, 10, 31, 20))), "2026-10-31");
  assert.equal(dateKey(firstRecurringDue({ kind: "yearly", month: 2, day: 29 }, local(2025, 3, 1))), "2026-02-28");
  assert.equal(dateKey(firstRecurringDue({ kind: "yearly", month: 2, day: 29 }, local(2026, 2, 28, 20))), "2026-02-28");
});

test("重复规则中文摘要覆盖全部类型", () => {
  assert.equal(recurrenceSummary({ kind: "daily" }), "每天");
  assert.equal(recurrenceSummary({ kind: "weekly", weekdays: [5, 1] }), "每周一、五");
  assert.equal(recurrenceSummary({ kind: "monthly", day: 5 }), "每月5日");
  assert.equal(recurrenceSummary({ kind: "monthly", day: "last" }), "每月最后一天");
  assert.equal(recurrenceSummary({ kind: "yearly", month: 3, day: 5 }), "每年3月5日");
  assert.equal(recurrenceSummary({ kind: "afterCompletion", days: 3 }), "完成后3天");
});

test("提前完成不跳期，逾期完成顺推到未来", () => {
  const due = local(2026, 10, 1);
  assert.equal(dateKey(nextRecurringDue({ kind: "daily" }, due, local(2026, 9, 30))), "2026-10-02");
  assert.equal(dateKey(nextRecurringDue({ kind: "daily" }, due, local(2026, 10, 5, 12))), "2026-10-06");
});

test("完成后 N 天使用完成日期并保留原时刻", () => {
  const next = nextRecurringDue({ kind: "afterCompletion", days: 3 }, local(2026, 10, 29, 9, 30), local(2026, 11, 1, 22, 10));
  assert.equal(dateKey(next), "2026-11-04");
  assert.equal(new Date(next).getHours(), 9);
  assert.equal(new Date(next).getMinutes(), 30);
});

test("完成时保留历史并生成状态干净的下一实例", () => {
  const original = makeTask({ recurrence: { kind: "monthly", day: 31 } });
  const now = local(2026, 1, 31, 12);
  const plan = planRecurringToggle([original], "one", now, () => "next");
  assert.equal(plan.upserts.length, 2);
  assert.deepEqual(plan.deleteIds, []);
  const [done, next] = plan.upserts;
  assert.equal(done.completed, true);
  assert.equal(done.completedAt, now);
  assert.equal(done.recurrenceNextId, "next");
  assert.equal(next.id, "next");
  assert.equal(next.recurrenceSourceId, "one");
  assert.equal(next.completed, false);
  assert.equal(next.completedAt, null);
  assert.equal(next.reminded, false);
  assert.equal(next.reminderMinutesBefore, 30);
  assert.equal(next.hasTime, true);
  assert.equal(next.subtasks[0].completed, false);
  assert.equal(next.createdAt, now);
  assert.equal(next.updatedAt, now);
  assert.equal(dateKey(next.dueDate), "2026-02-28");
  assert.notEqual(next.tags, original.tags);
  assert.notEqual(next.subtasks, original.subtasks);
  assert.notEqual(next.subtasks[0], original.subtasks[0]);
  assert.notEqual(next.recurrence, original.recurrence);
  next.tags.push("other");
  next.subtasks[0].title = "已修改";
  assert.deepEqual(original.tags, ["tag-one"]);
  assert.equal(original.subtasks[0].title, "子任务");

  const allDay = planRecurringToggle([makeTask({ hasTime: false })], "one", now, () => "all-day-next");
  assert.equal(allDay.upserts[1].hasTime, false);
});

test("已有有效下一实例链接时不会重复生成", () => {
  const now = local(2026, 1, 31, 12);
  const tasks = applyPlan([makeTask()], planRecurringToggle([makeTask()], "one", now, () => "next"));
  const activeWithLink = { ...tasks[0], completed: false, completedAt: null };
  const repeated = planRecurringToggle([activeWithLink, tasks[1]], "one", now + 1000, () => "unexpected");
  assert.equal(repeated.upserts.length, 1);
  assert.equal(repeated.upserts[0].recurrenceNextId, "next");
  assert.deepEqual(repeated.deleteIds, []);
});

test("撤销完成只删除未编辑的自动下一实例", () => {
  const now = local(2026, 1, 31, 12);
  const tasks = applyPlan([makeTask()], planRecurringToggle([makeTask()], "one", now, () => "next"));
  const undone = planRecurringToggle(tasks, "one", now + 1000, () => "unused");
  assert.deepEqual(undone.deleteIds, ["next"]);
  assert.equal(undone.upserts[0].completed, false);
  assert.ok(undone.upserts[0].recurrence);
  assert.equal(applyPlan(tasks, undone).length, 1);
});

test("下一实例已编辑或异常链接时撤销不会误删", () => {
  const now = local(2026, 1, 31, 12);
  const tasks = applyPlan([makeTask()], planRecurringToggle([makeTask()], "one", now, () => "next"));
  const edited = tasks.map((task) => task.id === "next" ? { ...task, title: "已编辑", updatedAt: now + 1 } : task);
  const undone = planRecurringToggle(edited, "one", now + 1000, () => "unused");
  assert.deepEqual(undone.deleteIds, []);
  assert.equal(undone.nextPreserved, true);
  assert.equal(undone.upserts[0].recurrence, undefined);
  assert.equal(applyPlan(edited, undone).length, 2);

  const completedNext = tasks.map((task) => task.id === "next" ? { ...task, completed: true, completedAt: now + 1, updatedAt: now + 1 } : task);
  const undoneCompleted = planRecurringToggle(completedNext, "one", now + 1000, () => "unused");
  assert.deepEqual(undoneCompleted.deleteIds, []);
  assert.equal(undoneCompleted.nextPreserved, true);
  assert.equal(applyPlan(completedNext, undoneCompleted).length, 2);

  const broken = makeTask({ completed: true, recurrenceNextId: "missing" });
  const safe = planRecurringToggle([broken], "one", now, () => "unused");
  assert.deepEqual(safe.deleteIds, []);
  assert.equal(safe.upserts[0].recurrenceNextId, undefined);
});

test("无日期的重复任务可以完成但不会生成下一实例", () => {
  const plan = planRecurringToggle([makeTask({ dueDate: null })], "one", 1000, () => "next");
  assert.equal(plan.upserts.length, 1);
  assert.equal(plan.upserts[0].completed, true);
  assert.equal(plan.upserts[0].recurrenceNextId, undefined);
});
