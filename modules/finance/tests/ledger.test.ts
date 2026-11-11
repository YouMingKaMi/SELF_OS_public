import { test } from "node:test";
import assert from "node:assert/strict";
import { daily, usage, round, add, net } from "../index.ts";
const expense = (data: Record<string, unknown>) => ({
  data: {
    day: "2026-11-01",
    amountMinor: "10000",
    mode: "estimated",
    startDay: "2026-11-01",
    endDay: "2026-11-10",
    ...data,
  },
});
test("current average changes estimates only, fixed terms keep full term", () => {
  assert.equal(round(daily(expense({}), "2026-11-02", true)!), 5000n);
  assert.equal(
    round(daily(expense({ mode: "fixed" }), "2026-11-02", true)!),
    1000n,
  );
});
test("resale reduces original net and ends cost at actual final day", () => {
  const e = expense({
    endedDay: "2026-11-02",
    recoveryMinor: "2000",
    recoveryDay: "2026-11-05",
  });
  assert.equal(net(e), 8000n);
  assert.equal(round(daily(e, "2026-11-07")!), 4000n);
  assert.equal(round(usage(e, "2026-11-05", "2026-11-07")), 0n);
});
test("fractional daily costs sum exactly before final rounding and do not repeat purchase", () => {
  const e = expense({ amountMinor: "100", endDay: "2026-11-03" });
  const sum = ["2026-11-01", "2026-11-02", "2026-11-03"].reduce(
    (n, day) => add(n, usage(e, day, "2026-11-03")),
    { n: 0n, d: 1n },
  );
  assert.equal(round(sum), 100n);
  assert.equal(round(usage(e, "2026-11-01", "2026-11-03")), 33n);
});
test("unknown or not-started costs remain absent, refunds may exceed purchase", () => {
  assert.equal(daily(expense({}), "2026-10-31"), null);
  assert.equal(net(expense({ recoveryMinor: "20000" })), -10000n);
});
