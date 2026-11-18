import { test } from "node:test";
import assert from "node:assert/strict";
import { importFromTickTickCsv, parseCsv } from "../src/importers.ts";

const HEADER = "List Name,Title,Due Date,Priority,Status,Completed Time,taskId,parentId";
const FULL_HEADER = "List Name,Title,Due Date,Reminder,Repeat,Priority,Status,Completed Time,taskId,parentId";

function taskNamed(result, title) {
  const task = result.tasks.find((item) => item.title === title);
  assert.ok(task, `缺少任务: ${title}`);
  return task;
}

test("CSV 保留完成时间、具体时刻与全天状态", () => {
  const csv = [
    HEADER,
    '工作,定时任务,"2026-11-01 09:30",5,0,,task-a,',
    '工作,已完成任务,2026-10-30,3,1,"2026-10-29 12:20",task-b,',
  ].join("\n");
  const result = importFromTickTickCsv(csv);
  assert.equal(result.tasks.length, 2);

  const timed = result.tasks.find((t) => t.id !== "task-b" && t.title === "定时任务");
  assert.ok(timed);
  assert.equal(timed.hasTime, true);
  assert.equal(timed.dueDate, Date.parse("2026-11-01 09:30"));
  assert.equal(timed.priority, 5);

  const completed = result.tasks.find((t) => t.title === "已完成任务");
  assert.ok(completed);
  assert.equal(completed.completed, true);
  assert.equal(completed.hasTime, false);
  assert.equal(completed.completedAt, Date.parse("2026-10-29 12:20"));
  assert.deepEqual(result.warnings, []);
});

test("完成时间无效时回退到导入时刻", () => {
  const before = Date.now();
  const result = importFromTickTickCsv([
    HEADER,
    '工作,旧任务,2026-10-30,3,1,not-a-date,task-c,',
  ].join("\n"));
  const after = Date.now();
  assert.equal(result.tasks.length, 1);
  assert.ok(result.tasks[0].completedAt >= before && result.tasks[0].completedAt <= after);
});

test("CSV 解析支持引号内逗号、换行和双引号转义", () => {
  const rows = parseCsv('Title,Content\n"任务,一","第一行\n第二行 ""备注"""');
  assert.deepEqual(rows, [["Title", "Content"], ["任务,一", '第一行\n第二行 "备注"']]);
});

test("缺少可识别表头时给出明确错误", () => {
  assert.throws(() => importFromTickTickCsv("a,b,c\n1,2,3"), /无法识别的 CSV/);
});

test("纯日期按本地 09:00 导入并拒绝不存在的日期", () => {
  const result = importFromTickTickCsv([
    HEADER,
    "工作,全天任务,2026-11-01,0,0,,date-1,",
    "工作,二月三十日,2026-02-30,0,0,,date-2,",
    "工作,非闰日,2025-02-29,0,0,,date-3,",
    "工作,十三月,2026-13-01,0,0,,date-4,",
  ].join("\n"));

  const allDay = taskNamed(result, "全天任务");
  assert.equal(allDay.dueDate, new Date(2026, 10, 1, 9, 0, 0, 0).getTime());
  assert.equal(new Date(allDay.dueDate).getFullYear(), 2026);
  assert.equal(new Date(allDay.dueDate).getMonth(), 10);
  assert.equal(new Date(allDay.dueDate).getDate(), 1);
  assert.equal(new Date(allDay.dueDate).getHours(), 9);
  assert.equal(allDay.hasTime, false);

  for (const title of ["二月三十日", "非闰日", "十三月"]) {
    const task = taskNamed(result, title);
    assert.equal(task.dueDate, null);
    assert.equal(task.hasTime, false);
  }
  assert.equal(result.tasks.length, 4);
  assert.deepEqual(result.warnings, []);
});

test("Reminder 支持提前分钟数和可精确换算的绝对时间", () => {
  const result = importFromTickTickCsv([
    FULL_HEADER,
    '工作,提前分钟,"2026-11-01 09:30",30,,0,0,,reminder-1,',
    '工作,准时,"2026-11-01 09:30",0,,0,0,,reminder-2,',
    '工作,绝对提醒,"2026-11-01 09:30","2026-11-01 09:00",,0,0,,reminder-3,',
    '工作,多重提醒,"2026-11-01 09:30","15,30",,0,0,,reminder-4,',
    '工作,晚于截止,"2026-11-01 09:30","2026-11-01 10:00",,0,0,,reminder-5,',
    '工作,无截止日期,,"2026-11-01 09:00",,0,0,,reminder-6,',
    '工作,空提醒,"2026-11-01 09:30",,,0,0,,reminder-7,',
  ].join("\n"));

  assert.equal(taskNamed(result, "提前分钟").reminderMinutesBefore, 30);
  assert.equal(taskNamed(result, "准时").reminderMinutesBefore, 0);
  assert.equal(taskNamed(result, "绝对提醒").reminderMinutesBefore, 30);
  for (const title of ["多重提醒", "晚于截止", "无截止日期", "空提醒"]) {
    assert.equal(taskNamed(result, title).reminderMinutesBefore, null);
  }
  assert.equal(result.tasks.length, 7);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /已忽略 3 个任务的提醒/);
});

test("CSV 重复标签只保留一个标签引用", () => {
  const result = importFromTickTickCsv([
    "List Name,Title,Tags,taskId,parentId",
    '工作,重复标签,"工作,工作，工作",tagged,',
  ].join("\n"));
  assert.equal(result.tags.length, 1);
  assert.equal(result.tasks[0].tags.length, 1);
});

test("Repeat 支持简单中文规则和 RRULE 白名单", () => {
  const result = importFromTickTickCsv([
    FULL_HEADER,
    "工作,每天中文,,,每天,0,0,,repeat-1,",
    "工作,每天规则,,,FREQ=DAILY;INTERVAL=1,0,0,,repeat-2,",
    '工作,每周中文,,,每周一、三、五,0,0,,repeat-3,',
    '工作,每周规则,,,"FREQ=WEEKLY;INTERVAL=1;BYDAY=FR,MO,WE,MO",0,0,,repeat-4,',
    "工作,每月中文,,,每月十五号,0,0,,repeat-5,",
    "工作,每月规则,,,FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15,0,0,,repeat-6,",
    "工作,每月最后一日,,,FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1,0,0,,repeat-7,",
    "工作,每年中文,,,每年三月五日,0,0,,repeat-8,",
    "工作,每年使用截止,2026-03-05,,FREQ=YEARLY;INTERVAL=1,0,0,,repeat-9,",
    "工作,每年指定日期,,,RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=7;BYMONTHDAY=20,0,0,,repeat-10,",
  ].join("\n"));

  assert.deepEqual(taskNamed(result, "每天中文").recurrence, { kind: "daily" });
  assert.deepEqual(taskNamed(result, "每天规则").recurrence, { kind: "daily" });
  assert.deepEqual(taskNamed(result, "每周中文").recurrence, { kind: "weekly", weekdays: [1, 3, 5] });
  assert.deepEqual(taskNamed(result, "每周规则").recurrence, { kind: "weekly", weekdays: [1, 3, 5] });
  assert.deepEqual(taskNamed(result, "每月中文").recurrence, { kind: "monthly", day: 15 });
  assert.deepEqual(taskNamed(result, "每月规则").recurrence, { kind: "monthly", day: 15 });
  assert.deepEqual(taskNamed(result, "每月最后一日").recurrence, { kind: "monthly", day: "last" });
  assert.deepEqual(taskNamed(result, "每年中文").recurrence, { kind: "yearly", month: 3, day: 5 });
  assert.deepEqual(taskNamed(result, "每年使用截止").recurrence, { kind: "yearly", month: 3, day: 5 });
  assert.deepEqual(taskNamed(result, "每年指定日期").recurrence, { kind: "yearly", month: 7, day: 20 });
  assert.deepEqual(result.warnings, []);
});

test("不支持的 Repeat 保留任务、忽略规则并聚合警告", () => {
  const result = importFromTickTickCsv([
    FULL_HEADER,
    "工作,中文间隔,,,每两天,0,0,,bad-repeat-1,",
    "工作,每日间隔,,,FREQ=DAILY;INTERVAL=2,0,0,,bad-repeat-2,",
    "工作,每周缺日期,,,FREQ=WEEKLY;INTERVAL=1,0,0,,bad-repeat-3,",
    '工作,每月多日,,,"FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15",0,0,,bad-repeat-4,',
    "工作,每年无依据,,,FREQ=YEARLY;INTERVAL=1,0,0,,bad-repeat-5,",
    "工作,有限次数,,,FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3,0,0,,bad-repeat-6,",
    "工作,空规则,,,,0,0,,bad-repeat-7,",
  ].join("\n"));

  assert.equal(result.tasks.length, 7);
  for (const task of result.tasks) assert.equal(task.recurrence, undefined);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /已忽略 6 个任务的重复规则/);
});
