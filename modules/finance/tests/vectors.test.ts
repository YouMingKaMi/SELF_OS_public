import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { add, net, round, usage } from "../index.ts";

// Language-neutral vectors. The Swift client runs the same file (SharedVectorTests.swift).
const vectors = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/ledger-vectors.json", import.meta.url),
    "utf8",
  ),
);
const daysOf = (month: string, asOf: string) =>
  Array.from(
    { length: 31 },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  ).filter(
    (day) =>
      day <= asOf &&
      new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day,
  );
for (const vector of vectors)
  test("ledger vector: " + vector.name, () => {
    const expense = { data: vector.expense };
    assert.equal(net(expense).toString(), vector.net);
    for (const expected of vector.days)
      for (const basis of ["term", "current"] as const)
        assert.equal(
          round(
            usage(expense, expected.day, vector.asOf, basis === "current"),
          ).toString(),
          expected[basis],
          `${expected.day} ${basis}`,
        );
    for (const basis of ["term", "current"] as const)
      assert.equal(
        round(
          daysOf(vector.month.month, vector.asOf).reduce(
            (sum, day) =>
              add(sum, usage(expense, day, vector.asOf, basis === "current")),
            { n: 0n, d: 1n },
          ),
        ).toString(),
        vector.month[basis],
        `month ${basis}`,
      );
  });
