import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverdue, matchesRule, matchView, sortTasks, startOfToday } from "../src/view-rules.ts";

function local(y, m, d, h = 9) {
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

function makeTask(overrides = {}) {
  return {
    id: "task",
    projectId: "inbox",
    title: "任务",
    note: "",
    priority: 0,
    completed: false,
    completedAt: null,
    dueDate: null,
    pinned: false,
    tags: [],
    subtasks: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeRule(overrides = {}) {
  return { projectIds: [], tagIds: [], priorities: [], due: "any", ...overrides };
}

test("startOfToday 使用本地午夜、支持 offset 且不修改传入时间", () => {
  const now = new Date(2026, 10, 18, 16, 45);
  const original = now.getTime();
  assert.equal(startOfToday(0, now), local(2026, 11, 18, 0));
  assert.equal(startOfToday(-1, now), local(2026, 11, 17, 0));
  assert.equal(startOfToday(1, now), local(2026, 11, 19, 0));
  assert.equal(now.getTime(), original);
});

test("startOfToday 跨 DST 时按日历天而不是固定 24 小时计算", () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const now = new Date(2026, 2, 8, 12);
    const today = startOfToday(0, now);
    const tomorrow = startOfToday(1, now);
    assert.equal(today, new Date(2026, 2, 8, 0).getTime());
    assert.equal(tomorrow, new Date(2026, 2, 9, 0).getTime());
    assert.equal(tomorrow - today, 23 * 60 * 60 * 1000);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("isOverdue 只把今天本地午夜之前的日期视为逾期", () => {
  const now = new Date(2026, 10, 18, 12);
  assert.equal(isOverdue(local(2026, 11, 17, 23), now), true);
  assert.equal(isOverdue(local(2026, 11, 18, 0), now), false);
  assert.equal(isOverdue(local(2026, 11, 18, 23), now), false);
});

test("matchesRule 保持五种日期条件的既有边界", () => {
  const now = new Date(2026, 10, 18, 12);
  const overdue = makeTask({ dueDate: local(2026, 11, 17) });
  const today = makeTask({ dueDate: local(2026, 11, 18, 23) });
  const inSixDays = makeTask({ dueDate: local(2026, 11, 24) });
  const inSevenDays = makeTask({ dueDate: local(2026, 11, 25, 0) });

  assert.equal(matchesRule(makeTask(), makeRule({ due: "any" }), now), true);
  assert.equal(matchesRule(overdue, makeRule({ due: "overdue" }), now), true);
  assert.equal(matchesRule(today, makeRule({ due: "overdue" }), now), false);
  assert.equal(matchesRule(overdue, makeRule({ due: "today" }), now), true);
  assert.equal(matchesRule(today, makeRule({ due: "today" }), now), true);
  assert.equal(matchesRule(inSixDays, makeRule({ due: "today" }), now), false);
  assert.equal(matchesRule(overdue, makeRule({ due: "next7" }), now), true);
  assert.equal(matchesRule(inSixDays, makeRule({ due: "next7" }), now), true);
  assert.equal(matchesRule(inSevenDays, makeRule({ due: "next7" }), now), false);
  assert.equal(matchesRule(makeTask(), makeRule({ due: "nodate" }), now), true);
  assert.equal(matchesRule(today, makeRule({ due: "nodate" }), now), false);
});

test("matchesRule 组内使用 OR、组间使用 AND", () => {
  const now = new Date(2026, 10, 18, 12);
  const rule = makeRule({ projectIds: ["p1", "p2"], tagIds: ["red", "blue"], priorities: [1, 5] });
  assert.equal(matchesRule(makeTask({ projectId: "p1", tags: ["red"], priority: 1 }), rule, now), true);
  assert.equal(matchesRule(makeTask({ projectId: "p2", tags: ["blue"], priority: 5 }), rule, now), true);
  assert.equal(matchesRule(makeTask({ projectId: "p3", tags: ["red"], priority: 1 }), rule, now), false);
  assert.equal(matchesRule(makeTask({ projectId: "p1", tags: ["green"], priority: 1 }), rule, now), false);
  assert.equal(matchesRule(makeTask({ projectId: "p1", tags: ["red"], priority: 3 }), rule, now), false);
});

test("matchView 保持完成态、智能视图、项目、标签和筛选器行为", () => {
  const now = new Date(2026, 10, 18, 12);
  const task = makeTask({ projectId: "p1", tags: ["red"], priority: 5, dueDate: local(2026, 11, 18) });
  const completed = makeTask({ completed: true, completedAt: now.getTime() });
  const filters = [{ id: "f1", name: "筛选", color: "#000000", rule: makeRule({ projectIds: ["p1"], tagIds: ["red"], priorities: [5] }) }];

  assert.equal(matchView(completed, "smart:completed", filters, now), true);
  assert.equal(matchView(completed, "smart:all", filters, now), false);
  assert.equal(matchView(task, "smart:completed", filters, now), false);
  assert.equal(matchView(task, "smart:all", filters, now), true);
  assert.equal(matchView(task, "smart:today", filters, now), true);
  assert.equal(matchView(task, "smart:next7", filters, now), true);
  assert.equal(matchView(makeTask({ dueDate: local(2026, 11, 25) }), "smart:next7", filters, now), false);
  assert.equal(matchView(task, "project:p1", filters, now), true);
  assert.equal(matchView(task, "project:p2", filters, now), false);
  assert.equal(matchView(task, "tag:red", filters, now), true);
  assert.equal(matchView(task, "tag:blue", filters, now), false);
  assert.equal(matchView(task, "filter:f1", filters, now), true);
  assert.equal(matchView(task, "filter:missing", filters, now), false);
  assert.equal(matchView(task, "unknown", filters, now), false);
});

test("sortTasks 按置顶、优先级、截止日期、创建时间排序并保持原地排序", () => {
  const tasks = [
    makeTask({ id: "no-date", priority: 5 }),
    makeTask({ id: "created-later", priority: 5, dueDate: 100, createdAt: 20 }),
    makeTask({ id: "pinned-low", priority: 0, pinned: true }),
    makeTask({ id: "medium", priority: 3, dueDate: 1 }),
    makeTask({ id: "created-first", priority: 5, dueDate: 100, createdAt: 10 }),
    makeTask({ id: "pinned-high", priority: 5, pinned: true }),
    makeTask({ id: "due-later", priority: 5, dueDate: 200 }),
  ];
  const result = tasks.sort(sortTasks);
  assert.equal(result, tasks);
  assert.deepEqual(result.map((task) => task.id), [
    "pinned-high",
    "pinned-low",
    "created-first",
    "created-later",
    "due-later",
    "no-date",
    "medium",
  ]);
});
