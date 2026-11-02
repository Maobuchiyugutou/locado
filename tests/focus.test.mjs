import { test } from "node:test";
import assert from "node:assert/strict";
import { focusRecordId, idleFocus, parseFocusState, serializeFocusState } from "../src/focus.ts";

const running = {
  mode: "work",
  running: true,
  remaining: 1500,
  total: 1500,
  endsAt: 100000,
  startedAt: 50000,
  taskId: "task-1",
  sessionId: "session-1",
};

test("空值、损坏 JSON 和非法状态回退为空闲番茄钟", () => {
  for (const raw of [null, "{broken", "42", JSON.stringify({ mode: "unknown" })]) {
    assert.deepEqual(parseFocusState(raw, 0, 1500, 300), idleFocus(1500));
  }
});

test("运行中的番茄钟按结束时间恢复剩余秒数和关联任务", () => {
  const state = parseFocusState(JSON.stringify(running), 70000, 1500, 300);
  assert.equal(state.mode, "work");
  assert.equal(state.running, true);
  assert.equal(state.remaining, 30);
  assert.equal(state.endsAt, 100000);
  assert.equal(state.taskId, "task-1");
  assert.equal(state.sessionId, "session-1");
});

test("刷新时已过期的计时保留待完成状态和稳定记录 ID", () => {
  const state = parseFocusState(JSON.stringify(running), 100001, 1500, 300);
  assert.equal(state.running, true);
  assert.equal(state.remaining, 0);
  assert.equal(focusRecordId(state), "focus-session-1");
  const restoredAgain = parseFocusState(serializeFocusState(state), 100002, 1500, 300);
  assert.equal(focusRecordId(restoredAgain), "focus-session-1");
});

test("暂停状态保留剩余时间且不使用旧结束时间倒计时", () => {
  const paused = { ...running, running: false, remaining: 777, endsAt: 100000 };
  const state = parseFocusState(JSON.stringify(paused), 200000, 1500, 300);
  assert.equal(state.running, false);
  assert.equal(state.remaining, 777);
  assert.equal(state.endsAt, 0);
});

test("非法时长和越界剩余时间会被规整", () => {
  const state = parseFocusState(JSON.stringify({ ...running, total: -1, remaining: 99999 }), 70000, 1500, 300);
  assert.equal(state.total, 1500);
  assert.equal(state.remaining, 30);
});
