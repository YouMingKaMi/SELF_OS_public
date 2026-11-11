import { test } from "node:test";
import assert from "node:assert/strict";
import { bookkeepingStart, dailyCost, freedom, whatIf } from "../index.ts";

const spend = (day: string, yuan: number, more = {}) => ({ data: { day, amountMinor: String(yuan * 100), mode: "immediate", ...more } });
const item = (startDay: string, endDay: string, yuan: number, more = {}) => ({
  data: { day: startDay, startDay, endDay, amountMinor: String(yuan * 100), mode: "estimated", ...more },
});

test("daily cost averages ordinary spending over every day since bookkeeping began", () => {
  const c = dailyCost([spend("2026-01-01", 100), spend("2026-01-10", 200), spend("2026-02-01", 999)], "2026-01-10");
  assert.equal(c.since, "2026-01-01");
  assert.equal(c.days, 10);
  assert.equal(c.total, 30_000);
  assert.equal(c.average, 3_000);
  assert.equal(c.today, 20_000);
  assert.equal(dailyCost([], "2026-01-10").average, 0);
  assert.equal(dailyCost([spend("2026-01-01", 100, { recoveryMinor: "4000" })], "2026-01-01").total, 6_000);
});
test("bookkeeping starts at the first ordinary expense, not at a back-filled purchase", () => {
  const all = [item("2024-06-01", "2027-06-01", 3650), spend("2026-10-01", 30)];
  assert.equal(bookkeepingStart(all, "2026-10-10"), "2026-10-01");
  assert.equal(dailyCost(all, "2026-10-10").days, 10);
  assert.equal(dailyCost(all, "2026-10-10", { since: "2026-10-06" }).days, 5);
});
test("an item bought before the start contributes only its daily share, on either basis", () => {
  // ¥1000 bought 2026-01-01, expected to last 1000 days; today is its 100th day; window is the last 10 days.
  const old = item("2026-01-01", "2028-09-26", 1000);
  const today = "2026-04-10";
  const current = dailyCost([old], today, { since: "2026-04-01", basis: "current" });
  const term = dailyCost([old], today, { since: "2026-04-01", basis: "term" });
  assert.equal(Math.round(current.average), 1000); // ¥1000 / 100 days used = ¥10 a day
  assert.equal(Math.round(term.average), 100); // ¥1000 / 1000 days planned = ¥1 a day
});
test("current basis: a purchase inside the window counts in full, like paying for it that day", () => {
  const phone = item("2026-04-03", "2029-04-03", 4658);
  const c = dailyCost([spend("2026-04-01", 0), phone], "2026-04-10", { basis: "current" });
  assert.equal(Math.round(c.total), 465_800);
  const t = dailyCost([spend("2026-04-01", 0), phone], "2026-04-10", { basis: "term" });
  assert.ok(t.total < 5_000, "term basis spreads it thin");
});
test("free days split into blue (held at the start) and gold (grown since)", () => {
  assert.deepEqual(freedom({ assets: 1_000_000n, startAssets: 600_000n, average: 10_000 }), { days: 100, blue: 60, gold: 40, volatile: 0 });
  assert.deepEqual(freedom({ assets: 500_000n, startAssets: 600_000n, average: 10_000 }), { days: 50, blue: 50, gold: 0, volatile: 0 });
  assert.equal(freedom({ assets: 1_000_000n, startAssets: 1_000_000n, average: 10_000, volatile: 255_000n }).volatile, 25);
  assert.equal(freedom({ assets: 1n, startAssets: 0n, average: 0 }).days, null);
});
test("spending costs more freedom than the same income buys", () => {
  const cost = dailyCost([spend("2026-01-01", 100 * 100)], "2026-04-10"); // 100 days, ¥100 a day
  const assets = 10_000_000n;
  assert.equal(freedom({ assets, startAssets: assets, average: cost.average }).days, 1000);
  assert.equal(whatIf(cost, assets, { income: 1_000_000n }).days, 1100);
  assert.equal(whatIf(cost, assets, { spend: 1_000_000n }).days, 500);
});

test("an item never costs more than its price: ended, sold, or used past its expected life", () => {
  const since = "2026-01-01";
  const total = (e: object, today: string, basis: "current" | "term") =>
    Math.round(dailyCost([e as never], today, { since, basis }).total);
  // Planned for 100 days, still in use on day 200.
  const overdue = item("2026-01-01", "2026-04-10", 1000);
  assert.equal(total(overdue, "2026-07-19", "term"), 100_000);
  assert.equal(total(overdue, "2026-07-19", "current"), 100_000);
  // Scrapped on day 50: the whole price sits in those 50 days, and nothing is added afterwards.
  const scrapped = item("2026-01-01", "2026-04-10", 1000, { endedDay: "2026-02-19" });
  for (const basis of ["current", "term"] as const) {
    assert.equal(total(scrapped, "2026-02-19", basis), 100_000);
    assert.equal(total(scrapped, "2026-12-31", basis), 100_000);
  }
  // Sold for ¥400 when it ended: only the ¥600 actually lost counts.
  const sold = item("2026-01-01", "2026-04-10", 1000, { endedDay: "2026-02-19", recoveryMinor: "40000" });
  assert.equal(total(sold, "2026-12-31", "current"), 60_000);
});
