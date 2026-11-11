import { test } from "node:test";
import assert from "node:assert/strict";
import { daily, longTerm } from "../index.ts";

const item = (id: string, data: Record<string, unknown>) => ({ id, data: { amountMinor: "36500", ...data } });
const phone = item("phone", { mode: "estimated", startDay: "2026-03-01", endDay: "2029-02-28" });
const old = item("old", { mode: "estimated", startDay: "2025-01-01", endDay: "2027-01-01", endedDay: "2026-05-10" });
const member = item("member", { mode: "fixed", startDay: "2025-11-01", endDay: "2026-10-31" });
const later = item("later", { mode: "estimated", startDay: "2026-09-01", endDay: "2027-09-01" });
const once = item("once", { mode: "immediate", day: "2026-06-01" });
const all = [phone, old, member, later, once];
const asOf = "2026-11-11";
const ids = (list: { id: string }[]) => list.map((e) => e.id).sort();

test("long-term: a past month lists what was in use then, ended items included", () => {
  assert.deepEqual(ids(longTerm(all, "2026-05", asOf).shown), ["member", "old", "phone"]);
  assert.deepEqual(ids(longTerm(all, "2026-06", asOf).shown), ["member", "phone"], "ended in May is gone in June");
  assert.deepEqual(ids(longTerm(all, "2026-02", asOf).shown), ["member", "old"], "not bought yet");
});
test("long-term: the current month shows what is in use; everything ended is hidden", () => {
  const view = longTerm(all, "2026-11", asOf);
  assert.deepEqual(ids(view.shown), ["later", "phone"]);
  assert.deepEqual(ids(view.hidden), ["member", "old"]);
});
test("long-term: ended items keep fixed numbers; in-use items average up to today", () => {
  // Ended: same answer whatever today is.
  assert.deepEqual(daily(old, "2026-11-11", true), daily(old, "2027-06-01", true));
  // In use: current average shrinks as days pass.
  const a = daily(phone, "2026-06-01", true)!, b = daily(phone, "2026-11-11", true)!;
  assert.ok(Number(a.n) / Number(a.d) > Number(b.n) / Number(b.d));
});
