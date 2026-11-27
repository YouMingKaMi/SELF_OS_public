import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { freedomTrend } from "../modules/finance/index.ts";
import { treasury, treasuryTrend } from "../modules/treasury/index.ts";

const row = (id, data) => ({ id, data, updatedAt: "" });
const start = Date.UTC(2016, 0, 1);
const day = (i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10);
const baseline = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice(11);
const repo = resolve(import.meta.dirname, "..");

function medianMs(operation) {
  operation();
  const times = Array.from({ length: 3 }, () => {
    const before = performance.now();
    operation();
    return performance.now() - before;
  });
  return Number(times.sort((a, b) => a - b)[1].toFixed(2));
}

async function legacyModules(folder) {
  if (!baseline) return {};
  const revision = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", baseline + "^{commit}"], {
    cwd: repo, encoding: "utf8",
  }).trim();
  const sources = [
    ["modules/finance/domain/freedom.ts", "finance/freedom.ts"],
    ["modules/finance/domain/ledger.ts", "finance/ledger.ts"],
    ["modules/treasury/domain/holdings.ts", "treasury/holdings.ts"],
  ];
  await Promise.all(["finance", "treasury"].map((path) => mkdir(join(folder, path))));
  await Promise.all(sources.map(([source, target]) => writeFile(join(folder, target),
    execFileSync("git", ["show", revision + ":" + source], { cwd: repo }))));
  return {
    legacyFreedom: (await import(pathToFileURL(join(folder, "finance/freedom.ts")).href)).freedomTrend,
    legacyTreasury: (await import(pathToFileURL(join(folder, "treasury/holdings.ts")).href)).treasury,
  };
}

const temporary = await mkdtemp(join(tmpdir(), "council-finance-bench-"));
try {
  const { legacyFreedom, legacyTreasury } = await legacyModules(temporary);
  console.log({ node: process.version, baseline, unit: "ms", measuredRuns: 3 });
  const dates = Array.from({ length: 3650 }, (_, i) => day(i));
  const options = {
    from: dates[0], to: dates.at(-1), today: dates.at(-1),
    since: dates[0], assetsToday: null, basis: "term",
  };
  for (const size of [1000, 10000, 36500]) {
    const expenses = Array.from({ length: size }, (_, i) => row(String(i), {
      day: dates[i % dates.length], amountMinor: "123", mode: "immediate",
    }));
    const run = () => freedomTrend(expenses, [], options);
    const old = legacyFreedom ? () => legacyFreedom(expenses, [], options) : undefined;
    const points = run();
    if (old) assert.deepEqual(points, old());
    console.log({ case: "freedom trend", size, points: points.length, before: old && medianMs(old), after: medianMs(run) });
  }

  const wallets = Array.from({ length: 100 }, (_, i) => row("w" + i, { category: "cny" }));
  const assets = Array.from({ length: 100 }, (_, i) => row("a" + i, { manualPrice: "2" }));
  for (const size of [3650, 36500]) {
    const entries = Array.from({ length: size }, (_, i) => row(String(i).padStart(6, "0"), {
      walletId: "w" + i % 100, assetId: "a" + i % 100,
      at: new Date(start + i * 8_640_000).toISOString(), mode: "set", quantity: String(i % 15),
    }));
    const input = { wallets, assets, entries };
    const run = () => treasury(input).points;
    const old = legacyTreasury ? () => legacyTreasury(input).points : undefined;
    if (old) assert.deepEqual(run(), old());
    console.log({ case: "treasury replay", size, before: old && medianMs(old), after: medianMs(run) });
  }

  for (const size of [3650, 36500, 365000]) {
    const points = Array.from({ length: size }, (_, i) => ({
      at: new Date(start + i * 8_640_000).toISOString(),
      value: BigInt(i === 729 ? 10_000 : i === 7_299 ? -10_000 : i % 50),
      ...(i % 720 === 211 ? { partial: true } : {}),
    }));
    const run = () => treasuryTrend(points, "");
    const sampled = run();
    assert.ok(sampled.length <= 400);
    assert.ok(sampled.some((point) => point.value === null));
    assert.ok(sampled.some((point) => point.value === 10_000n));
    if (size > 7_299) assert.ok(sampled.some((point) => point.value === -10_000n));
    console.log({ case: "treasury sampling", size, points: sampled.length, after: medianMs(run) });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
