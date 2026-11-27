import { test } from "node:test";
import assert from "node:assert/strict";
import {
  belongsToday,
  isTodaySchedule,
  overlaps,
  validDay,
  validateSchedule,
  type Schedule,
} from "../index.ts";
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

test("deadline calendar overlap matches only the due date", () => {
  const schedule: Schedule = { kind: "deadline", date: "2026-11-09" };
  assert.equal(overlaps(schedule, "2026-11-08", "2026-11-08"), false);
  assert.equal(overlaps(schedule, "2026-11-09", "2026-11-09"), true);
});

function assertTodaySchedule(
  schedule: Schedule,
  day: string,
  expected: boolean,
) {
  const context = `${JSON.stringify(schedule)} on ${day}`;
  assert.equal(isTodaySchedule(schedule, day), expected, context);
  assert.equal(
    belongsToday({ status: "pending", schedule }, day),
    expected,
    context,
  );
}

test("today includes only the matching scheduled day", () => {
  const schedule: Schedule = { kind: "day", date: "2026-11-08" };
  assertTodaySchedule(schedule, "2026-11-07", false);
  assertTodaySchedule(schedule, "2026-11-08", true);
  assertTodaySchedule(schedule, "2026-11-09", false);
});

test("today includes both boundaries and the interior of a valid range", () => {
  const schedule: Schedule = {
    kind: "range",
    start: "2026-11-07",
    end: "2026-11-09",
  };
  assertTodaySchedule(schedule, "2026-11-06", false);
  assertTodaySchedule(schedule, "2026-11-07", true);
  assertTodaySchedule(schedule, "2026-11-08", true);
  assertTodaySchedule(schedule, "2026-11-09", true);
  assertTodaySchedule(schedule, "2026-11-10", false);
  assertTodaySchedule(
    { kind: "range", start: "2026-11-08", end: "2026-11-08" },
    "2026-11-08",
    true,
  );
});

test("today excludes ranges with invalid or reversed endpoints", () => {
  const day = "2026-11-08";
  const ranges = [
    { start: "", end: "2026-11-09" },
    { start: "2026-1-01", end: "2026-11-09" },
    { start: "2026-11-07", end: "2026-11-31" },
    { start: "2026-11-09", end: "2026-11-07" },
  ];
  for (const range of ranges)
    assertTodaySchedule({ kind: "range", ...range }, day, false);
});

test("today includes deadlines with valid dates regardless of when they fall", () => {
  const day = "2026-11-08";
  for (const date of [
    "2026-11-09",
    "2026-11-08",
    "2026-11-07",
    "2028-02-29",
    "1900-01-01",
    "9999-12-31",
  ])
    assertTodaySchedule({ kind: "deadline", date }, day, true);
});

test("today excludes deadlines with invalid dates", () => {
  for (const date of [
    "",
    "2026-2-01",
    "2026-02-29",
    "1899-12-31",
    "10000-01-01",
  ])
    assertTodaySchedule({ kind: "deadline", date }, "2026-11-08", false);
});

test("today includes recent and excludes unscheduled", () => {
  assertTodaySchedule({ kind: "recent" }, "2026-11-08", true);
  assertTodaySchedule({ kind: "unscheduled" }, "2026-11-08", false);
});

test("only pending tasks belong to today", () => {
  const schedule: Schedule = { kind: "recent" };
  for (const status of ["completed", "discarded", "unknown"])
    assert.equal(
      belongsToday({ status, schedule }, "2026-11-08"),
      false,
      status,
    );
});
