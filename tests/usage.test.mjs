import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyUsageEvent,
  clearUsage,
  emptyUsage,
  normalizeUsage,
  readUsage,
  recordUsage,
  summarizeUsage,
  USAGE_KEY,
} from "../src/usage.ts";

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();
const at = (offset) => new Date(2026, 10, 3 - offset, 12, 0, 0).getTime();

function usageWithDay(offset, day) {
  const data = emptyUsage(NOW);
  const date = new Date(at(offset));
  const pad = (value) => String(value).padStart(2, "0");
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  data.days[key] = { opens: 0, created: 0, completed: 0, quickAdds: 0, quickAddClean: 0, ...day };
  return data;
}

test("异常统计输入被规整，Quick Add 无需修正次数不会超过总次数", () => {
  const fallback = normalizeUsage(null, NOW);
  assert.deepEqual(fallback, emptyUsage(NOW));

  const data = normalizeUsage({
    v: 1,
    firstSeenAt: NOW - 1000,
    lastSeenAt: NOW,
    exports: 2.8,
    days: {
      "2026-11-03": { opens: 2.9, created: -1, completed: "bad", quickAdds: 2, quickAddClean: 5 },
      invalid: { opens: 10 },
      "2026-11-02": null,
    },
  }, NOW);
  assert.equal(data.exports, 2);
  assert.deepEqual(data.days["2026-11-03"], {
    opens: 2, created: 0, completed: 0, quickAdds: 2, quickAddClean: 2,
  });
  assert.equal(data.days.invalid, undefined);
  assert.equal(data.days["2026-11-02"], undefined);
});

test("使用事件只更新对应计数，导出不会伪造打开天数", () => {
  let data = emptyUsage(NOW);
  data = applyUsageEvent(data, { type: "open" }, NOW);
  data = applyUsageEvent(data, { type: "open" }, NOW);
  data = applyUsageEvent(data, { type: "create" }, NOW);
  data = applyUsageEvent(data, { type: "complete" }, NOW);
  data = applyUsageEvent(data, { type: "quick-add", clean: true }, NOW);
  data = applyUsageEvent(data, { type: "quick-add", clean: false }, NOW);
  data = applyUsageEvent(data, { type: "export" }, NOW);

  const summary = summarizeUsage(data, NOW);
  assert.equal(summary.activeDays, 1);
  assert.equal(summary.created, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.quickAdds, 2);
  assert.equal(summary.quickAddCleanRate, 0.5);
  assert.equal(summary.exports, 1);
  assert.equal(data.lastSeenAt, NOW);
});

test("最近七天目标要求至少打开两天并完成三个任务", () => {
  let data = usageWithDay(0, { opens: 1, completed: 3 });
  assert.equal(summarizeUsage(data, NOW).weeklyGoalMet, false);
  data = usageWithDay(1, { opens: 1, completed: 3 });
  const summary = summarizeUsage(data, NOW);
  assert.equal(summary.weeklyGoalMet, false);
  assert.equal(summary.last7.openDays, 1);

  data.days[Object.keys(data.days)[0]].completed = 2;
  const today = summarizeUsage(usageWithDay(0, { opens: 1, completed: 1 }), NOW);
  assert.equal(today.weeklyGoalMet, false);
  const merged = usageWithDay(0, { opens: 1, completed: 1 });
  const yesterdayKey = Object.keys(data.days)[0];
  merged.days[yesterdayKey] = data.days[yesterdayKey];
  const result = summarizeUsage(merged, NOW);
  assert.equal(result.last7.completed, 3);
  assert.equal(result.last7.openDays, 2);
  assert.equal(result.weeklyGoalMet, true);
});

test("连续使用允许今天尚未打开，但昨天必须连续", () => {
  const data = usageWithDay(1, { opens: 1 });
  const yesterdayKey = Object.keys(data.days)[0];
  const day2 = usageWithDay(2, { opens: 1 });
  data.days[Object.keys(day2.days)[0]] = day2.days[Object.keys(day2.days)[0]];
  assert.equal(summarizeUsage(data, NOW).streakDays, 2);
  data.days[yesterdayKey].opens = 0;
  assert.equal(summarizeUsage(data, NOW).streakDays, 0);
});

test("统计使用独立本地键，损坏数据不会阻断后续记录", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  values.set(USAGE_KEY, "not-json");
  assert.deepEqual(readUsage(NOW), emptyUsage(NOW));
  recordUsage({ type: "open" }, NOW);
  assert.equal(summarizeUsage(readUsage(NOW), NOW).activeDays, 1);
  clearUsage();
  assert.equal(values.has(USAGE_KEY), false);
  delete globalThis.localStorage;
});
