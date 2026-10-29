import { test } from "node:test";
import assert from "node:assert/strict";
import { importFromTickTickCsv, parseCsv } from "../src/importers.ts";

const HEADER = "List Name,Title,Due Date,Priority,Status,Completed Time,taskId,parentId";

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
