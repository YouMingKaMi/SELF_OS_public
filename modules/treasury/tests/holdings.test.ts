import { test } from "node:test";
import assert from "node:assert/strict";
import { treasury, formatDecimal } from "../index.ts";

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
