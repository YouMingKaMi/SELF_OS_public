import assert from "node:assert/strict";
import { test } from "node:test";
import { solarOccurrence } from "../../modules/calendar/index.ts";
import { MemoryStore, SyncService } from "../../modules/kernel/server.ts";
import { composeRules } from "../../services/api/compose.ts";
import { client } from "../support.ts";

test("solar recurrences jump decades and preserve the original month-day anchor", () => {
  assert.equal(solarOccurrence("1950-01-01", "2026-11-18", "day", 1), "2026-11-18");
  assert.equal(solarOccurrence("2024-01-31", "2024-02-01", "month", 1), "2024-02-29");
  assert.equal(solarOccurrence("2024-01-31", "2024-03-01", "month", 1), "2024-03-31");
  assert.equal(solarOccurrence("2024-02-29", "2025-01-01", "year", 1), "2025-02-28");
  assert.equal(solarOccurrence("2024-02-29", "2028-01-01", "year", 1), "2028-02-29");
  assert.equal(solarOccurrence("2024-01-07", "2024-01-08", "week", 2), "2024-01-21");
  assert.equal(solarOccurrence("9999-12-31", "9999-12-31", "year", 1), "9999-12-31");
});

test("server rejects impossible lunar leap months and day thirty in a short month", async () => {
  const c = client(new SyncService(new MemoryStore(), composeRules()), "calendar-test");
  const lunar = { name: "例", calendar: "lunar", lunarMonth: 6, lunarDay: 1, leap: true, repeat: "yearly", intervalUnit: "year" } as const;
  await assert.rejects(c.create("importantDay", { ...lunar, lunarYear: 2026 }), /INVALID_LUNAR_DATE/);
  await assert.rejects(c.create("importantDay", { ...lunar, lunarYear: 2025, lunarDay: 30 }), /INVALID_LUNAR_DATE/);
  assert.equal((await c.create("importantDay", { ...lunar, lunarYear: 2025, lunarDay: 29 })).data.leap, true);
});
