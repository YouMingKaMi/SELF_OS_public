import assert from "node:assert/strict";
import { test } from "node:test";
import { configuration, update, type Sample } from "../../infra/deploy/monitor.ts";

const limits = configuration({}).limits;
const healthy = (at: number): Sample => ({
  at,
  api: { status: 401, milliseconds: 12 },
  database: {
    databaseBytes: 1000, indexBytes: 10, receiptBytes: 50, snapshotBytes: 0,
    estimatedReceipts: 2, estimatedSyncHeads: 1, observedTupleReads: 32,
    activeLockWaits: 0, milliseconds: 25,
  },
  dataDisk: { usedPercent: 40, availableBytes: 5000 },
  backupDisk: { usedPercent: 50, availableBytes: 5000 },
  backup: { ageSeconds: 3600, archiveBytes: 101, durationSeconds: 10, restoreSeconds: 3 },
});

test("monitor cooldown suppresses repeats and emits recovery after a sustained breach", () => {
  const unresponsive = (at: number): Sample => ({
    ...healthy(at),
    api: { status: null, milliseconds: null },
  });
  const initial = update({ samples: [], active: {} }, unresponsive(1), limits);
  const alert = update(initial.history, unresponsive(901), limits);
  const suppressed = update(alert.history, unresponsive(1801), limits);
  const renewed = update(suppressed.history, unresponsive(4501), limits);
  const recovered = update(renewed.history, healthy(5401), limits);
  assert.deepEqual(initial.alerts, []);
  assert.deepEqual(alert.alerts, [{ state: "alert", name: "api_unavailable" }]);
  assert.deepEqual(suppressed.alerts, []);
  assert.deepEqual(renewed.alerts, alert.alerts);
  assert.deepEqual(recovered.alerts, [{ state: "recovered", name: "api_unavailable" }]);
  assert.deepEqual(recovered.history.latency.api, { samples: 1, p50Milliseconds: 12, p95Milliseconds: 12 });
});

test("monitor distinguishes a missing backup, stale backup, lock contention and disk capacity", () => {
  const sample = healthy(500_000);
  const sensitive = { ...limits, consecutive: 1 };
  const empty = { samples: [], active: {} };
  const missing = update(empty, { ...sample, backup: null }, sensitive);
  assert.deepEqual(missing.alerts, [{ state: "alert", name: "backup_missing" }]);
  const stale = update(missing.history, {
    ...sample,
    database: { ...sample.database!, activeLockWaits: 3 },
    backup: { ...sample.backup!, ageSeconds: 130_000 },
    backupDisk: { usedPercent: 90, availableBytes: 50 },
  }, sensitive);
  assert.deepEqual(stale.alerts, [
    { state: "alert", name: "database_lock_waits" },
    { state: "alert", name: "backup_disk_full" },
    { state: "alert", name: "backup_stale" },
    { state: "recovered", name: "backup_missing" },
  ]);
});

test("monitor state retains at most one week of normal samples and computes nearest-rank latency", () => {
  const now = 2_000_000;
  const day = 86400;
  const data = update({
    active: {},
    samples: [
      healthy(now - 8 * day),
      ...Array.from({ length: 800 }, (_, i) => ({
        ...healthy(now - 801 + i),
        api: { status: i === 799 ? 500 : 401, milliseconds: i + 20 },
      })),
    ],
  }, healthy(now), limits);
  assert.equal(data.history.samples.length, 672);
  assert.equal(data.history.latency.api.samples, 671);
  assert.equal(data.history.latency.api.p50Milliseconds, 483);
  assert.equal(data.history.latency.api.p95Milliseconds, 785);
  const pruned = update(data.history, healthy(now + 7 * day), limits);
  assert.equal(pruned.history.samples.length, 1);
});
