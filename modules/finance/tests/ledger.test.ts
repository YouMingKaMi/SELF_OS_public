import { test } from "node:test";
import assert from "node:assert/strict";
import { daily, usage, round, add, net, monthlyUsage } from "../index.ts";
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

test("fixed periods use the earlier of the contract boundary and the actual end", () => {
  const late = expense({ mode: "fixed", endedDay: "2026-11-20" });
  const early = expense({ mode: "fixed", endedDay: "2026-11-05", recoveryMinor: "12000" });
  for (const current of [false, true]) {
    assert.equal(round(usage(late, "2026-11-10", "2026-11-22", current)), 1000n);
    assert.equal(round(usage(late, "2026-11-11", "2026-11-22", current)), 0n);
    assert.equal(round(usage(early, "2026-11-05", "2026-11-22", current)), -200n);
    assert.equal(round(usage(early, "2026-11-06", "2026-11-22", current)), 0n);
  }
  const estimated = expense({});
  assert.equal(round(usage(estimated, "2026-11-11", "2026-11-22")), 1000n);
});

test("monthly event sweep matches day-by-day fractions across periods and refunds", () => {
  const days = Array.from({ length: 30 }, (_, i) => "2026-11-" + String(i + 1).padStart(2, "0"));
  const entries = [
    expense({ mode: "immediate", amountMinor: "9007199254740993" }),
    expense({ mode: "immediate", day: "2026-11-05", amountMinor: "-2" }),
    expense({ mode: "immediate", day: "2026-11-24", amountMinor: "800" }),
    expense({ startDay: "2026-10-10", endDay: "2026-11-08", amountMinor: "10" }),
    expense({ mode: "fixed", endDay: "2026-11-08", endedDay: "2026-11-15", recoveryMinor: "10500" }),
  ];
  const zero = { n: 0n, d: 1n };
  for (const current of [false, true]) {
    const asOf = "2026-11-22";
    const reference = days.slice(0, 22).map((day) => ({
      day,
      value: entries.reduce((sum, entry) => add(sum, usage(entry, day, asOf, current)), zero),
    }));
    const result = monthlyUsage(entries, days, asOf, current);
    assert.deepEqual(result.days, reference);
    assert.deepEqual(result.total, reference.reduce((sum, row) => add(sum, row.value), zero));
  }
});
