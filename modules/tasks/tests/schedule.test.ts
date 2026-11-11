import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSchedule, validDay, overlaps } from "../index.ts";
test("strict dates reject overflow and invalid leap days", () => {
  for (const day of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "26-01-01",
    "0000-01-01",
    "",
  ])
    assert.equal(validDay(day), false, day);
  assert.equal(validDay("2028-02-29"), true);
  assert.throws(
    () =>
      validateSchedule({
        kind: "range",
        start: "2026-11-02",
        end: "2026-11-01",
      }),
    /INVALID_RANGE/,
  );
});
test("cross month interval intersects both inclusive boundaries", () => {
  const s = validateSchedule({
    kind: "range",
    start: "2026-11-28",
    end: "2026-12-03",
  });
  assert.equal(overlaps(s, "2026-11-01", "2026-11-30"), true);
  assert.equal(overlaps(s, "2026-12-03", "2026-12-03"), true);
  assert.equal(overlaps(s, "2026-12-04", "2026-12-31"), false);
  assert.equal(overlaps({ kind: "recent" }, "2026-11-01", "2026-11-30"), false);
});
