import { test } from "node:test";
import assert from "node:assert/strict";
import { timeSummary } from "../index.ts";
const session = (
  id: string,
  segments: string[],
  extra: Record<string, unknown> = {},
) => ({ id, data: { status: "finished", segments, ...extra } });
test("cross-midnight splits at business midnight and excludes cancelled time", () => {
  const s = timeSummary(
    [
      session("a", ["2026-11-06T15:50:00Z/2026-11-06T16:10:00Z"]),
      session("b", [], {
        status: "cancelled",
        day: "2026-11-07",
        elapsedSeconds: 100,
      }),
    ],
    0,
  );
  assert.deepEqual(s.daily, { "2026-11-06": 600, "2026-11-07": 600 });
});
test("total merges overlaps, manual durations remain separately reported", () => {
  const s = timeSummary(
    [
      session("a", ["2026-11-07T00:00:00Z/2026-11-07T01:00:00Z"]),
      session("b", ["2026-11-07T00:30:00Z/2026-11-07T01:30:00Z"]),
      session("c", [], {
        manual: true,
        day: "2026-11-07",
        elapsedSeconds: 600,
      }),
    ],
    0,
  );
  assert.equal(s.totalSeconds, 6000);
  assert.equal(s.overlapSeconds, 1800);
  assert.equal(s.manualSeconds, 600);
});
test("running session uses elapsed instants even while page was hidden", () => {
  assert.equal(
    timeSummary(
      [
        session("a", [], {
          status: "running",
          runningSince: "2026-11-07T00:00:00Z",
        }),
      ],
      Date.parse("2026-11-07T02:00:00Z"),
    ).totalSeconds,
    7200,
  );
});
test("DST day is a calendar day rather than fixed 24 hours", () => {
  const s = timeSummary(
    [session("a", ["2026-03-08T05:00:00Z/2026-03-09T04:00:00Z"])],
    0,
    "America/New_York",
  );
  assert.deepEqual(s.daily, { "2026-03-08": 23 * 3600 });
});
