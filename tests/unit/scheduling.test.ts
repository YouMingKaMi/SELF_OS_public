import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inPeriod,
  groupTasks,
  localDay,
} from "../../apps/web/src/scheduling.ts";
import type { Task } from "../../apps/web/src/data/tasks.ts";
const task: Task = {
  id: "x",
  title: "x",
  status: "pending",
  version: 1,
  schedule: { kind: "range", start: "2026-11-28", end: "2026-12-03" },
};
test("month/day filters intersect intervals and keep undated only outside exact-day searches", () => {
  assert.equal(inPeriod(task, "2026-12", ""), true);
  assert.equal(inPeriod(task, "2026-12", "2026-12-04"), false);
  assert.equal(
    inPeriod({ ...task, schedule: { kind: "recent" } }, "2026-12", ""),
    true,
  );
  assert.equal(
    inPeriod(
      { ...task, schedule: { kind: "unscheduled" } },
      "2026-12",
      "2026-12-01",
    ),
    false,
  );
});
test("completed tasks use completion day even after plan changes", () => {
  const done = {
    ...task,
    status: "completed" as const,
    completedAt: "2026-11-02T04:00:00Z",
    schedule: { kind: "day" as const, date: "2026-12-05" },
  };
  assert.equal(inPeriod(done, "2026-11", ""), true);
  assert.equal(inPeriod(done, "2026-12", ""), false);
  assert.match(groupTasks([done])[0].label, /2026-11-02/);
});

test("completion date uses business timezone across midnight", () => {
  assert.equal(localDay(new Date("2026-11-01T20:00:00Z")), "2026-11-02");
});
