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

test("纯日期统一为本地 09:00 的全天任务", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const cases = [
      ["明天 开会", "2026-10-30"],
      ["2026年11月3日 开会", "2026-11-03"],
      ["每天 背单词", "2026-10-29"],
    ];
    for (const [input, expected] of cases) {
      const result = parseTask(input);
      assert.ok(result.dueDate != null, input);
      const due = new Date(result.dueDate);
      assert.equal(dateKey(result.dueDate), expected, input);
      assert.equal(due.getHours(), 9, input);
      assert.equal(due.getMinutes(), 0, input);
      assert.equal(result.hasTime, false, input);
    }

    const noTime = applyQuickAddCorrections(parseTask("明天9点 开会"), new Set(["time"]));
    assert.equal(new Date(noTime.dueDate).getHours(), 9);
    assert.equal(new Date(noTime.dueDate).getMinutes(), 0);
    assert.equal(noTime.hasTime, false);
  });
});

test("多个冲突日期采用第一个有效日期并保留后续日期文字", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const cases = [
      ["明天 后天 开会", "2026-10-30", "后天 开会", "明天"],
      ["2026年11月5日 明天 开会", "2026-11-05", "明天 开会", "2026年11月5日"],
      ["2月30日 明天 学习", "2026-10-30", "2月30日 学习", "明天"],
    ];
    for (const [input, expectedDate, expectedTitle, expectedDatePart] of cases) {
      const result = parseTask(input);
      assert.ok(result.dueDate != null, input);
      assert.equal(dateKey(result.dueDate), expectedDate, input);
      assert.equal(result.title, expectedTitle, input);
      assert.equal(result.parts.find((part) => part.kind === "date")?.text, expectedDatePart, input);
      assert.equal(result.hasTime, false, input);
    }
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

test("Quick Add 识别每天及每周重复并计算首次日期", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const daily = parseTask("每天9点 背单词 提前10分钟提醒");
    assert.deepEqual(daily.recurrence, { kind: "daily" });
    assert.equal(dateKey(daily.dueDate), "2026-10-29");
    assert.equal(daily.title, "背单词");
    assert.equal(daily.reminderMinutesBefore, 10);

    const weekly = parseTask("每周五18点 提交周报");
    assert.deepEqual(weekly.recurrence, { kind: "weekly", weekdays: [5] });
    assert.equal(dateKey(weekly.dueDate), "2026-10-30");
    assert.equal(new Date(weekly.dueDate).getHours(), 18);
    assert.equal(weekly.title, "提交周报");
    assert.equal(weekly.parts.some((part) => part.kind === "date"), false);

    assert.deepEqual(parseTask("每周一、三、五 健身").recurrence, { kind: "weekly", weekdays: [1, 3, 5] });
    assert.deepEqual(parseTask("每周一、周五 健身").recurrence, { kind: "weekly", weekdays: [1, 5] });
  });
});

test("Quick Add 识别每月、每年和完成后重复", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const monthly = parseTask("每月5日 还款");
    assert.deepEqual(monthly.recurrence, { kind: "monthly", day: 5 });
    assert.equal(dateKey(monthly.dueDate), "2026-11-05");
    assert.equal(monthly.parts.find((part) => part.kind === "recurrence").fallbackDate.text, "5日");

    assert.equal(dateKey(parseTask("每月最后一天 总结").dueDate), "2026-10-31");
    assert.equal(dateKey(parseTask("月末 总结").dueDate), "2026-10-31");
    const yearly = parseTask("每年3月5日 纪念");
    assert.deepEqual(yearly.recurrence, { kind: "yearly", month: 3, day: 5 });
    assert.equal(dateKey(yearly.dueDate), "2027-03-05");
    const after = parseTask("完成后3天 浇水");
    assert.deepEqual(after.recurrence, { kind: "afterCompletion", days: 3 });
    assert.equal(dateKey(after.dueDate), "2026-10-29");
  });
});

test("Quick Add 重复语法拒绝歧义并优先显式日期", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const multiple = parseTask("每天 每周五 学习");
    assert.equal(multiple.recurrence, null);
    assert.equal(multiple.dueDate, null);
    assert.equal(multiple.title, "每天 每周五 学习");

    const ambiguous = parseTask("每周一日用品");
    assert.equal(ambiguous.recurrence, null);
    assert.equal(ambiguous.dueDate, null);
    assert.equal(ambiguous.title, "每周一日用品");

    const explicit = parseTask("下周一 每周五 开会");
    assert.deepEqual(explicit.recurrence, { kind: "weekly", weekdays: [5] });
    assert.equal(dateKey(explicit.dueDate), "2026-11-02");
    assert.equal(explicit.title, "开会");
  });
});

test("Quick Add 取消重复可恢复单次日期或清除推导日期", () => {
  withNow(new Date("2026-10-29T08:00:00"), () => {
    const weekly = parseTask("每周五18点 提交周报 提前30分钟提醒");
    const single = applyQuickAddCorrections(weekly, new Set(["recurrence"]));
    assert.equal(single.recurrence, null);
    assert.equal(dateKey(single.dueDate), "2026-10-30");
    assert.equal(new Date(single.dueDate).getHours(), 18);
    assert.equal(single.reminderMinutesBefore, 30);
    assert.equal(single.title, "提交周报 周五");
    assert.equal(single.parts.some((part) => part.kind === "date"), true);

    const daily = applyQuickAddCorrections(parseTask("每天 背单词"), new Set(["recurrence"]));
    assert.equal(daily.recurrence, null);
    assert.equal(daily.dueDate, null);
    assert.equal(daily.title, "背单词 每天");

    const explicit = parseTask("下周一 每周五18点 提交周报");
    const noExplicitDate = applyQuickAddCorrections(explicit, new Set(["date"]));
    assert.deepEqual(noExplicitDate.recurrence, { kind: "weekly", weekdays: [5] });
    assert.equal(dateKey(noExplicitDate.dueDate), "2026-10-30");
    assert.equal(new Date(noExplicitDate.dueDate).getHours(), 18);
    assert.equal(noExplicitDate.title, "提交周报 下周一");
  });
});
