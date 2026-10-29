import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { parseTask } from "../src/nlp.ts";

function withNow(now, run) {
  mock.timers.enable({ apis: ["Date"], now });
  try { run(); } finally { mock.timers.reset(); }
}

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("周日期按自然周解析", () => {
  const cases = [
    ["2026-10-28T10:00:00", "下周一 开会", "2026-11-02"],
    ["2026-10-28T10:00:00", "本周五 提交", "2026-10-30"],
    ["2026-10-28T10:00:00", "本周一 复盘", "2026-10-26"],
    ["2026-10-28T10:00:00", "周五 提交", "2026-10-30"],
    ["2026-11-01T10:00:00", "下周一 开会", "2026-11-02"],
    ["2026-11-01T10:00:00", "本周一 复盘", "2026-10-26"],
    ["2026-11-01T10:00:00", "本周日 休息", "2026-11-01"],
    ["2026-10-31T10:00:00", "下周日 休息", "2026-11-08"],
  ];
  for (const [now, input, expected] of cases) {
    withNow(new Date(now), () => {
      const result = parseTask(input);
      assert.ok(result.dueDate != null, input);
      assert.equal(dateKey(result.dueDate), expected, input);
    });
  }
});

test("日期、具体时刻和提醒可组合解析", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const result = parseTask("明天9点开会 提前30分钟提醒");
    assert.equal(dateKey(result.dueDate), "2026-10-30");
    assert.equal(new Date(result.dueDate).getHours(), 9);
    assert.equal(result.hasTime, true);
    assert.equal(result.reminderMinutesBefore, 30);
    assert.equal(result.title, "开会");
  });
});

test("弱中文表达不会被误判为日期", () => {
  const result = parseTask("有一点问题需要处理");
  assert.equal(result.dueDate, null);
  assert.equal(result.hasTime, false);
  assert.equal(result.reminderMinutesBefore, null);
});
