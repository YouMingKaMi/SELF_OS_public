import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dailyCosts, roundMinor } from "../index.ts";
const cases = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/daily-costs.json", import.meta.url),
    "utf8",
  ),
);
for (const vector of cases)
  test(vector.name, () => {
    const result = dailyCosts({
      ...vector,
      netCostMinor: BigInt(vector.netCostMinor),
    });
    assert.equal(roundMinor(result.term).toString(), vector.termMinor);
    assert.equal(
      result.current ? roundMinor(result.current).toString() : null,
      vector.currentMinor,
    );
  });
test("half rounding is symmetric and safe above Number precision", () => {
  assert.equal(roundMinor({ numerator: -1n, denominator: 2n }), -1n);
  assert.equal(
    roundMinor({ numerator: 90071992547409931n, denominator: 10n }),
    9007199254740993n,
  );
});
test("zero term and fractional day counts rejected", () => {
  for (const plannedDays of [0, 1.5, NaN])
    assert.throws(
      () =>
        dailyCosts({
          kind: "fixed",
          netCostMinor: 1n,
          plannedDays,
          elapsedDays: 1,
        }),
      /INVALID_DAYS/,
    );
});
