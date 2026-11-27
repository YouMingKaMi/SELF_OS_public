import { test } from "node:test";
import assert from "node:assert/strict";
import { treasury, treasuryTrend, formatDecimal, parseDecimal } from "../index.ts";

const row = (id: string, data: Record<string, unknown>, at = "") => ({ id, updatedAt: at || "2026-01-01T00:00:00Z", data });
const wallets = [
  row("cash", { name: "余额宝", category: "cny", currency: "CNY" }),
  row("tg", { name: "Wallet A", category: "crypto", currency: "CNY" }),
  row("ok", { name: "OKX", category: "crypto", currency: "CNY" }),
];
const assets = [row("btc", { name: "比特币", kind: "crypto", quoteId: "coingecko:bitcoin" })];
const e = (id: string, walletId: string, mode: string, quantity: string, at: string, extra = {}) =>
  row(id, { walletId, mode, quantity, at, ...extra });
const entries = [
  e("1", "cash", "set", "1000", "2026-01-01T00:00:00Z"),
  e("2", "tg", "set", "0.5", "2026-01-02T00:00:00Z", { assetId: "btc", unitPrice: "500000" }),
  e("3", "ok", "set", "0.25", "2026-01-03T00:00:00Z", { assetId: "btc" }),
  e("4", "tg", "delta", "-0.1", "2026-01-04T00:00:00Z", { assetId: "btc" }),
];

test("treasury: an asset totals its holdings across wallets and is valued at the live price", () => {
  const r = treasury({ wallets, assets, entries, live: { btc: "600000" } });
  assert.equal(formatDecimal(r.assets.btc.quantity), "0.65");
  assert.equal(formatDecimal(r.assets.btc.byWallet.tg), "0.4");
  assert.equal(formatDecimal(r.assets.btc.byWallet.ok), "0.25");
  assert.equal(r.assets.btc.value, 39_000_000n); // 0.65 × 600000 yuan, in cents
  assert.equal(r.wallets.tg.value, 24_000_000n);
  assert.equal(r.total, 39_000_000n + 100_000n);
  assert.ok(r.assets.btc.live);
});
test("treasury: without a quote the last recorded price values the asset; history uses recorded prices", () => {
  const r = treasury({ wallets, assets, entries });
  assert.equal(r.assets.btc.value, 32_500_000n);
  assert.equal(r.assets.btc.live, false);
  assert.deepEqual(r.points.map((p) => p.value), [100_000n, 25_100_000n, 37_600_000n, 32_600_000n]);
});
test("treasury: an asset with no price at all is counted as unknown, not as zero value", () => {
  const r = treasury({ wallets, assets, entries: entries.map((x) => ({ ...x, data: { ...x.data, unitPrice: undefined } })) });
  assert.equal(r.assets.btc.value, null);
  assert.equal(r.unknown, 1);
  assert.equal(r.total, 100_000n);
});

test("treasury: observed prices move history without changing holdings", () => {
  const prices = [
    { id: "p1", updatedAt: "2026-01-05T00:00:00Z", data: { assetId: "btc", at: "2026-01-05T00:00:00Z", price: "700000" } },
    { id: "p0", updatedAt: "2025-12-31T00:00:00Z", data: { assetId: "btc", at: "2025-12-31T00:00:00Z", price: "1" } },
  ];
  const r = treasury({ wallets, assets, entries, prices });
  assert.equal(formatDecimal(r.assets.btc.quantity), "0.65", "holdings unchanged");
  assert.equal(r.assets.btc.price, 700_000n * 1_000_000_000_000n, "last observation wins");
  assert.equal(r.points.at(-1)!.value, 100_000n + 45_500_000n, "a new point at the observed price");
  assert.equal(r.points.length, 6);
});

test("treasury: aggregate exact decimal values before rounding to cents", () => {
  const time = "2026-01-01T00:00:00Z";
  const result = treasury({
    wallets,
    assets,
    entries: [
      e("a", "tg", "set", "0.006", time, { assetId: "btc", unitPrice: "1" }),
      e("b", "ok", "set", "0.006", time, { assetId: "btc" }),
    ],
  });
  assert.equal(result.total, 1n);
  assert.equal(result.assets.btc.value, 1n);
  assert.equal(result.points.at(-1)?.value, 1n);
  assert.equal(formatDecimal(parseDecimal("0.123456789123")!, 12), "0.123456789123");
  assert.equal(formatDecimal(parseDecimal("0.000000000001")!, 12), "0.000000000001");
  for (const invalid of [" ", "1e21", "1e-9", "0000000000000000000", "0.0000000000001"]) {
    assert.equal(parseDecimal(invalid), null);
  }
});

test("treasury: unknown valuations leave gaps, while an explicit zero remains a known value", () => {
  const result = treasury({
    wallets,
    assets,
    entries: [
      e("a", "cash", "set", "2", "2026-01-01T23:00:00+08:00"),
      e("b", "tg", "set", "-0.5", "2026-01-01T15:30:00Z", { assetId: "btc" }),
    ],
    prices: [row("c", { at: "2026-01-02T00:00:00+08:00", assetId: "btc", price: "0" })],
    historyOf: { wallets: new Set(["cash"]), assets: new Set(["btc"]) },
  });
  assert.deepEqual(result.history.map((point) => point.value), [null, null, 200n]);
  assert.deepEqual(result.selected, { value: 200n, known: 2, unknown: 0 });
  const partial = treasury({
    wallets,
    assets,
    entries,
    historyOf: { wallets: new Set(["cash", "absent"]), assets: new Set() },
  });
  assert.deepEqual(partial.selected, { value: 100_000n, known: 1, unknown: 1 });
});

test("treasury: chart sampling retains the opening, extremes, missing intervals and latest value", () => {
  const origin = Date.parse("2026-01-01T00:00:00Z");
  const rows = Array.from({ length: 3_650 }, (_, i) => ({
    at: new Date(origin + i * 3_600_000 + 1_000).toISOString(),
    value: i === 1_112 ? -505n : i === 1_177 ? 80_000n : BigInt(i % 10),
    partial: i === 1_150 ? true as const : undefined,
  }));
  const from = new Date(origin + 30 * 3_600_000).toISOString();
  const sampled = treasuryTrend(rows, from, 64);
  assert.ok(sampled.length <= 64);
  assert.deepEqual(sampled[0], { at: from, value: 9n });
  assert.deepEqual(sampled.at(-1), { at: rows.at(-1)!.at, value: rows.at(-1)!.value });
  for (const [index, value] of [[1_112, -505n], [1_150, null], [1_177, 80_000n]] as const) {
    assert.ok(sampled.some((point) => point.at === rows[index].at && point.value === value));
  }
});
