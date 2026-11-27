import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseTaskPlan, TaskPlanError } from "../../apps/web/src/data/task-plan.ts";

const vectors: { name: string; response: unknown; expected?: unknown; error?: string }[] = JSON.parse(
  readFileSync(new URL("../../fixtures/task-plan-vectors.json", import.meta.url), "utf8"),
);
for (const vector of vectors) {
  test("AI task plan: " + vector.name, () => {
    if (vector.error) {
      assert.throws(
        () => parseTaskPlan(vector.response),
        (issue) => issue instanceof TaskPlanError && issue.code === vector.error,
      );
    } else {
      assert.deepEqual(parseTaskPlan(vector.response), vector.expected);
    }
  });
}
