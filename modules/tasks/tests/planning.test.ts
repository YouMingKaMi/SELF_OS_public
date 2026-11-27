import assert from "node:assert/strict";
import { test } from "node:test";
import { isNextTask, type PlannedTask } from "../domain/planning.ts";

test("next actions wait for a start day and all prerequisites", () => {
  const next: PlannedTask = {
    id: "next",
    status: "pending",
    schedule: { kind: "day", date: "2026-11-15" },
    listId: "",
    prerequisiteIds: ["first", "second"],
  };
  const byId = new Map<string, PlannedTask>([
    [
      "first",
      { ...next, id: "first", status: "completed", prerequisiteIds: [] },
    ],
    ["second", { ...next, id: "second", prerequisiteIds: [] }],
  ]);
  assert.equal(isNextTask(next, byId, "2026-11-15"), false);
  byId.set("second", { ...byId.get("second")!, status: "completed" });
  assert.equal(isNextTask(next, byId, "2026-11-14"), false);
  assert.equal(isNextTask(next, byId, "2026-11-15"), true);
  assert.equal(
    isNextTask(
      { ...next, schedule: { kind: "unscheduled" } },
      byId,
      "2026-11-15",
    ),
    true,
  );
  assert.equal(
    isNextTask(
      { ...next, listId: "work", schedule: { kind: "unscheduled" } },
      byId,
      "2026-11-15",
    ),
    true,
  );
});
