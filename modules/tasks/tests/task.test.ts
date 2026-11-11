import { test } from "node:test";
import assert from "node:assert/strict";
import { transitionTask } from "../index.ts";
import type { Task } from "../index.ts";
const task: Task = {
  id: "synthetic-task-1",
  title: "整理测试资料",
  status: "pending",
  version: 1,
};
test("complete leaves source unchanged and advances version", () => {
  assert.deepEqual(transitionTask(task, "complete", 1), {
    ...task,
    status: "completed",
    version: 2,
  });
  assert.equal(task.status, "pending");
});
test("discard requires reopen before completion", () => {
  const discarded = transitionTask(task, "discard", 1);
  assert.throws(
    () => transitionTask(discarded, "complete", 2),
    /REOPEN_REQUIRED/,
  );
  assert.equal(transitionTask(discarded, "reopen", 2).status, "pending");
});
test("stale edits cannot overwrite current state", () =>
  assert.throws(() => transitionTask(task, "complete", 0), /VERSION_CONFLICT/));
test("repeated state transition is a no-op, distinct from network idempotence", () =>
  assert.equal(transitionTask(task, "reopen", 1), task));
