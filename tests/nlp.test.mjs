import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { applyQuickAddCorrections, parseTask, resolveQuickAddMetadata } from "../src/nlp.ts";

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

test("清单、标签、优先级、日期时间和提醒可组合解析", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const result = parseTask("明天下午3点 #工作 @会议 @客户 高优先级 和客户开会，提前30分钟提醒");
    assert.equal(result.title, "和客户开会");
    assert.equal(dateKey(result.dueDate), "2026-10-30");
    assert.equal(new Date(result.dueDate).getHours(), 15);
    assert.equal(result.projectName, "工作");
    assert.deepEqual(result.tagNames, ["会议", "客户"]);
    assert.equal(result.priority, 5);
    assert.equal(result.reminderMinutesBefore, 30);
  });
});

test("支持常见优先级写法并保留默认优先级", () => {
  const cases = [
    ["低优先级 写周报", 1, "写周报", true],
    ["优先级：中 写周报", 3, "写周报", true],
    ["无优先级 写周报", 0, "写周报", true],
    ["写周报", 0, "写周报", false],
  ];
  for (const [input, priority, title, specified] of cases) {
    const result = parseTask(input);
    assert.equal(result.priority, priority, input);
    assert.equal(result.title, title, input);
    assert.equal(result.prioritySpecified, specified, input);
  }
});

test("清单和标签语法不会误伤 C# 与邮箱", () => {
  const input = "整理 C# 笔记和 a@b.com 联系方式";
  const result = parseTask(input);
  assert.equal(result.title, input);
  assert.equal(result.projectName, null);
  assert.deepEqual(result.tagNames, []);
});

test("支持明晚、月底和带年份的日期", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const evening = parseTask("明晚8点 吃饭");
    assert.equal(dateKey(evening.dueDate), "2026-10-30");
    assert.equal(new Date(evening.dueDate).getHours(), 20);
    assert.equal(evening.title, "吃饭");

    assert.equal(dateKey(parseTask("本月底 总结").dueDate), "2026-10-31");
    assert.equal(dateKey(parseTask("下个月底 总结").dueDate), "2026-11-30");
    assert.equal(dateKey(parseTask("2027年2月28日 总结").dueDate), "2027-02-28");
  });
});

test("无效日期和弱时间表达保持原样", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const invalidDate = parseTask("2月30日 学习");
    assert.equal(invalidDate.dueDate, null);
    assert.equal(invalidDate.title, "2月30日 学习");
  });
  const weakTime = parseTask("三点意见需要讨论");
  assert.equal(weakTime.dueDate, null);
  assert.equal(weakTime.title, "三点意见需要讨论");
});

test("Quick Add 按已有名称匹配并报告缺失项", () => {
  const projects = [{ id: "p-work", name: "Work" }];
  const tags = [{ id: "t-focus", name: "Focus" }, { id: "t-meeting", name: "会议" }];
  const found = resolveQuickAddMetadata("work", ["focus", "会议", "focus"], projects, tags);
  assert.equal(found.projectId, "p-work");
  assert.deepEqual(found.tagIds, ["t-focus", "t-meeting"]);
  assert.equal(found.missingProject, null);
  assert.deepEqual(found.missingTags, []);

  const missing = resolveQuickAddMetadata("不存在", ["缺失标签"], projects, tags);
  assert.equal(missing.projectId, null);
  assert.equal(missing.missingProject, "不存在");
  assert.deepEqual(missing.missingTags, ["缺失标签"]);
});

test("Quick Add 可取消清单、标签、优先级和提醒识别", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const parsed = parseTask("明天9点 #工作 @会议 高优先级 开会，提前30分钟提醒");
    assert.deepEqual(parsed.parts.map((part) => part.kind), ["date", "time", "project", "tag", "priority", "reminder"]);
    const corrected = applyQuickAddCorrections(parsed, new Set(["project", "tag:会议", "priority", "reminder"]));
    assert.equal(corrected.projectName, null);
    assert.deepEqual(corrected.tagNames, []);
    assert.equal(corrected.priority, 0);
    assert.equal(corrected.prioritySpecified, false);
    assert.equal(corrected.reminderMinutesBefore, null);
    assert.equal(corrected.title, "开会 #工作 @会议 高优先级 提前30分钟 提醒");
    assert.equal(corrected.dueDate, parsed.dueDate);
  });
});

test("Quick Add 日期和时间纠错保持其余结果一致", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const parsed = parseTask("明天9点开会 提前30分钟提醒");
    const noDate = applyQuickAddCorrections(parsed, new Set(["date"]));
    assert.equal(dateKey(noDate.dueDate), "2026-10-29");
    assert.equal(new Date(noDate.dueDate).getHours(), 9);
    assert.equal(noDate.hasTime, true);
    assert.equal(noDate.reminderMinutesBefore, 30);
    assert.equal(noDate.title, "开会 明天");

    const noTime = applyQuickAddCorrections(parsed, new Set(["time"]));
    assert.equal(dateKey(noTime.dueDate), "2026-10-30");
    assert.equal(noTime.hasTime, false);
    assert.equal(noTime.title, "开会 9点");

    const noDateTime = applyQuickAddCorrections(parsed, new Set(["date", "time"]));
    assert.equal(noDateTime.dueDate, null);
    assert.equal(noDateTime.reminderMinutesBefore, null);
    assert.equal(noDateTime.title, "开会 明天 9点");
  });
});
