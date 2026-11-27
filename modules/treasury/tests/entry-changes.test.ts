import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { treasury, formatDecimal } from "../index.ts";
import type { EntryChange } from "../index.ts";

type Row = { id: string; data: Record<string, unknown>; deleted?: boolean; version?: number; updatedAt?: string };
type Vector = {
  name: string;
  entries: Row[];
  prices?: Row[];
  until?: string;
  before?: string;
  historyOf?: { wallets: string[]; assets: string[] };
  // [previous, delta, after], exact decimal strings shared with Swift.
  expected: Record<string, [string | null, string | null, string]>;
  balances?: Record<string, string>;
  holdings?: Record<string, Record<string, string>>;
};
const vectors: { wallets: Row[]; assets: Row[]; cases: Vector[] } = JSON.parse(
  readFileSync(new URL("./entry-changes-vectors.json", import.meta.url), "utf8"),
);
const rows = (values: Row[]) => values.map((row) => ({
  ...row, version: row.version ?? 1, updatedAt: row.updatedAt ?? "2026-02-01T00:00:00Z",
}));
const exact = (value: bigint | null) => value === null ? null : formatDecimal(value, 12);
const tuple = (change: EntryChange) => [exact(change.previous), exact(change.delta), exact(change.after)];

for (const vector of vectors.cases) {
  test(`treasury entry changes: ${vector.name}`, () => {
    const result = treasury({
      wallets: rows(vectors.wallets), assets: rows(vectors.assets), entries: rows(vector.entries),
      prices: rows(vector.prices ?? []), until: vector.until,
      before: vector.before === undefined ? undefined : Date.parse(vector.before),
      historyOf: vector.historyOf && {
        wallets: new Set(vector.historyOf.wallets), assets: new Set(vector.historyOf.assets),
      },
    });
    assert.deepEqual(Object.fromEntries(Object.entries(result.entryChanges).map(
      ([id, change]) => [id, tuple(change)],
    )), vector.expected);
    for (const [id, quantity] of Object.entries(vector.balances ?? {})) {
      assert.equal(exact(result.wallets[id].quantity), quantity, `wallet ${id}`);
    }
    for (const [asset, holdings] of Object.entries(vector.holdings ?? {})) {
      assert.deepEqual(Object.fromEntries(Object.entries(result.assets[asset].byWallet).map(
        ([wallet, quantity]) => [wallet, exact(quantity)],
      )), holdings, `asset ${asset}`);
    }
  });
}
