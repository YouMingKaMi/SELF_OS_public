import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { timeSummary } from "../index.ts";

// Language-neutral vectors. The Swift client runs the same file (SharedVectorTests.swift).
const vectors = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/time-vectors.json", import.meta.url),
    "utf8",
  ),
);
for (const vector of vectors)
  test("time vector: " + vector.name, () => {
    const summary = timeSummary(
      vector.sessions.map((data: Record<string, unknown>, i: number) => ({
        id: String(i),
        data,
      })),
      Date.parse(vector.now),
    );
    assert.deepEqual(summary.daily, vector.daily);
    assert.equal(summary.overlapSeconds, vector.overlapSeconds);
    assert.equal(summary.manualSeconds, vector.manualSeconds);
  });
