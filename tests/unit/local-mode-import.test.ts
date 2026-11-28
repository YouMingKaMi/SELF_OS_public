import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after, type TestContext } from "node:test";
import type { AnyEntity } from "../../packages/contracts/entities.ts";
import type { Pending } from "../../apps/web/src/data/db.ts";

type StoreName = "confirmed" | "pending" | "meta";
type Row = AnyEntity | Pending | string;
const stores = {
  confirmed: new Map<string, Row>(),
  pending: new Map<string, Row>(),
  meta: new Map<string, Row>(),
};
let rejectedPut: string | undefined;
const dbFixture = {
  async getAll(name: StoreName) {
    return structuredClone([...stores[name].values()]);
  },
  async getAllFromIndex(name: "confirmed", index: "type", value: string) {
    assert.equal(index, "type");
    return (await this.getAll(name)).filter((row) => (row as AnyEntity).type === value);
  },
  transaction(names: StoreName | StoreName[], mode: "readonly" | "readwrite") {
    const scope = typeof names === "string" ? [names] : names;
    const staged = new Map(scope.map((name) => [name, new Map(stores[name])]));
    let aborted = false;
    function objectStore(name: StoreName) {
      const rows = staged.get(name);
      if (!rows) throw new Error("store is outside the transaction scope");
      function canWrite() {
        assert.equal(mode, "readwrite");
        assert.equal(aborted, false);
      }
      return {
        async get(key: string) { return structuredClone(rows.get(key)); },
        async getKey(key: string) { return rows.has(key) ? key : undefined; },
        async getAll() { return structuredClone([...rows.values()]); },
        async put(row: Row, key?: string) {
          canWrite();
          const id = key ?? (name === "confirmed" ? (row as AnyEntity).id : (row as Pending).operationId);
          if (id === rejectedPut) throw new Error("fixture write failed");
          rows.set(id, structuredClone(row));
        },
        async delete(key: string) { canWrite(); rows.delete(key); },
        async clear() { canWrite(); rows.clear(); },
        index(index: string) {
          assert.equal(name, "pending");
          assert.equal(index, "entityId");
          return {
            async getAll(id: string) {
              return structuredClone([...rows.values()].filter((row) => (row as Pending).entityId === id));
            },
          };
        },
      };
    }
    return {
      objectStore,
      store: scope.length === 1 ? objectStore(scope[0]) : undefined,
      get done() {
        if (aborted) return Promise.reject(new Error("fixture transaction aborted"));
        if (mode === "readwrite") for (const [name, rows] of staged) stores[name] = rows;
        return Promise.resolve();
      },
      abort() { aborted = true; },
    };
  },
};

// Supply an isolated transaction adapter for Node, which has no IndexedDB.
const nativeChannel = globalThis.BroadcastChannel;
let storeChannel: BroadcastChannel | undefined;
after(() => storeChannel?.close());
class TestBroadcastChannel extends nativeChannel {
  constructor() {
    super(crypto.randomUUID());
    storeChannel = this;
  }
}
globalThis.BroadcastChannel = TestBroadcastChannel;
const fixtureKey = Symbol.for("selfos.test.local-mode.database");
Object.defineProperty(globalThis, fixtureKey, { value: dbFixture, configurable: true });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "idb" && context.parentURL?.endsWith("apps/web/src/data/db.ts")
      ? { shortCircuit: true, url: "data:text/javascript,export const openDB=async()=>globalThis[Symbol.for('selfos.test.local-mode.database')]" }
      : next(specifier, context);
  },
});
const { isLocalMode, setLocalModeOverrideForTest } = await import("../../apps/web/src/data/local-mode.ts");
const { importWorkspaceBackup, parseWorkspaceImport } = await import("../../apps/web/src/data/import.ts");
const { enqueue, enqueueTogether, pairDevice, startSync, statusSnapshot, synchronize } = await import("../../apps/web/src/data/sync.ts");
const { fetchQuotes, searchQuotes } = await import("../../apps/web/src/data/quotes.ts");
const { ensure, pendingSnapshot, ready, snapshot, subscribe } = await import("../../apps/web/src/data/store.ts");
const { isAndroidLocalMode } = await import("../../apps/web/src/ui/android-bridge.ts");
const { writeWorkspaceExport } = await import("../../apps/web/src/data/export.ts");
await ready;
hooks.deregister();
Reflect.deleteProperty(globalThis, fixtureKey);
globalThis.BroadcastChannel = nativeChannel;

const earlier = "2026-01-01T00:00:00.000Z";
const later = "2026-02-01T00:00:00.000Z";
const record = (type: AnyEntity["type"], id: string, data: AnyEntity["data"]): AnyEntity => ({
  type, id, data, version: 1, updatedAt: earlier, deleted: false,
});
const task = (id: string, version = 1, updatedAt = earlier): AnyEntity => ({
  id, version, updatedAt, type: "task", deleted: false,
  data: { title: "备份事项", status: "pending", scheduleKind: "unscheduled" },
});
const format = (entities: unknown[]) => ({ format: "personal-council-next", version: 1, exportedAt: later, entities });
const backupOf = (...entities: AnyEntity[]) => parseWorkspaceImport(JSON.stringify(format(entities)));

function local(t: TestContext) {
  for (const table of Object.values(stores)) table.clear();
  setLocalModeOverrideForTest(true);
  t.after(() => { setLocalModeOverrideForTest(null); rejectedPut = undefined; });
}

function remote(t: TestContext) {
  local(t);
  setLocalModeOverrideForTest(false);
  t.mock.method(globalThis, "fetch", () => assert.fail("offline remote import must only enqueue"));
}

function queuedWrites(): Pending[] {
  return (Array.from(stores.pending.values()) as Pending[]).sort((a, b) => a.sequence - b.sequence);
}

test("local mode is detected by the bundled origin, native bridge or explicit override", (t) => {
  const origin = Object.getOwnPropertyDescriptor(globalThis, "location");
  const window = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (origin) Object.defineProperty(globalThis, "location", origin);
    else Reflect.deleteProperty(globalThis, "location");
    if (window) Object.defineProperty(globalThis, "window", window);
    else Reflect.deleteProperty(globalThis, "window");
    setLocalModeOverrideForTest(null);
  });
  assert.equal(isLocalMode(), false);
  Object.defineProperty(globalThis, "location", { configurable: true, value: { hostname: "appassets.androidplatform.net" } });
  assert.equal(isLocalMode(), true);
  setLocalModeOverrideForTest(false);
  assert.equal(isLocalMode(), false);
  setLocalModeOverrideForTest(null);
  Reflect.deleteProperty(globalThis, "location");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { SelfOSAndroid: { isLocalMode: () => true } } });
  assert.equal(isLocalMode(), true);
  assert.equal(isAndroidLocalMode(), true);
});

test("v1 parser keeps the newest valid record per ID and strips unknown fields", () => {
  const tombstone = { ...task("deleted"), deleted: true, data: {} };
  const clean = { ...task("duplicate", 2, later), data: { ...task("x").data, title: "最新" } };
  const parsed = parseWorkspaceImport(JSON.stringify(format([
    task("duplicate", 99, earlier), task("duplicate", 1, later),
    { ...clean, updatedAt: "2026-02-01T08:00:00+08:00", data: { ...clean.data, unknown: {} } },
    tombstone,
    { ...task("unknown"), type: "madeUp" },
    task("bad-date", 1, "2026-02-30T00:00:00Z"),
    { ...task("bad-version"), version: undefined },
    { ...task("missing-title"), data: { status: "pending", scheduleKind: "unscheduled" } },
    { ...task("bad-field"), data: { ...clean.data, prerequisiteIds: [42] } },
    { ...task("bad-data"), data: [] },
    { ...task("bad-deleted"), deleted: "false" },
  ])));
  assert.equal(parsed.exportedAt, later);
  assert.equal(parsed.liveCount, 1);
  assert.equal(parsed.deletedCount, 1);
  assert.equal(parsed.skippedInvalid, 7);
  assert.deepEqual(parsed.byType, { task: 2 });
  assert.deepEqual(parsed.entities, [{ ...clean, updatedAt: "2026-02-01T08:00:00+08:00" }, tombstone]);
});

test("v1 parser rejects malformed envelopes, nonempty invalid backups, and oversize UTF-8 text", () => {
  for (const envelope of [
    { ...format([]), format: "other" }, { ...format([]), version: 2 },
    { ...format([]), exportedAt: "yesterday" }, { ...format([]), entities: {} },
  ]) {
    assert.throws(() => parseWorkspaceImport(JSON.stringify(envelope)), /备份格式无效/);
  }
  assert.throws(() => parseWorkspaceImport("{"), /有效的 JSON/);
  for (const invalid of [
    { ...task("a"), data: { ...task("a").data, title: " " } },
    { ...task("a"), data: { ...task("a").data, status: "unknown" } },
    { ...task("a"), id: "x".repeat(129) },
    { ...task("a"), version: -1 },
  ]) {
    assert.throws(() => parseWorkspaceImport(JSON.stringify(format([invalid]))), /没有可导入的有效记录/);
  }
  assert.deepEqual(backupOf().entities, []);
  assert.throws(() => parseWorkspaceImport("界".repeat(Math.floor(64 * 1024 * 1024 / 3) + 1)), /超过 64 MiB/);
});

test("local replace clears outbox and sync metadata atomically and refreshes loaded records", async (t) => {
  local(t);
  const original = task("original");
  stores.confirmed.set(original.id, original);
  stores.pending.set("pending", {
    operationId: "pending", entityId: original.id, entityType: "task", action: "delete",
    state: "queued", baseVersion: 1, occurredAt: earlier, sequence: 1,
  });
  stores.meta.set("cursor", "42");
  stores.meta.set("scope", "old");
  stores.meta.set("device", "test-device");
  await ensure("task");
  assert.deepEqual(snapshot("task"), [original]);

  const next = task("new", 0);
  const tombstone = { ...task("trash"), deleted: true };
  rejectedPut = tombstone.id;
  await assert.rejects(importWorkspaceBackup(backupOf(next, tombstone), "replace"), /fixture write failed/);
  assert.deepEqual([...stores.confirmed.keys()], [original.id]);
  assert.equal(stores.pending.size, 1);
  assert.equal(stores.meta.get("cursor"), "42");
  rejectedPut = undefined;
  assert.deepEqual(await importWorkspaceBackup(backupOf(next, tombstone), "replace"),
    { imported: 2, updated: 0, skipped: 0, mode: "local" });
  assert.deepEqual([...stores.confirmed.values()], [{ ...next, version: 1 }, tombstone]);
  assert.deepEqual(snapshot("task"), [{ ...next, version: 1 }]);
  assert.deepEqual(pendingSnapshot(), []);
  assert.equal(stores.pending.size, 0);
  assert.deepEqual([...stores.meta], [["device", "test-device"]]);

  const chunks: string[] = [];
  await writeWorkspaceExport((chunk) => { chunks.push(chunk); });
  assert.deepEqual(parseWorkspaceImport(chunks.join("")).entities, [{ ...next, version: 1 }, tombstone]);
});

test("local merge compares timestamps then versions and keeps tombstones", async (t) => {
  local(t);
  await importWorkspaceBackup(backupOf(task("later-date", 7), task("same-date", 2), task("older-date", 1, later)), "replace");
  const added = task("added", 0);
  const deleted = { ...task("later-date", 1, later), deleted: true };
  const tie = task("same-date", 5, "2026-01-01T08:00:00+08:00");
  const imported = backupOf(added, deleted, tie, task("older-date", 99));
  assert.deepEqual(await importWorkspaceBackup(imported, "merge"),
    { imported: 1, updated: 2, skipped: 1, mode: "local" });
  assert.deepEqual(stores.confirmed.get(added.id), added);
  assert.deepEqual(stores.confirmed.get(deleted.id), { ...deleted, version: 8 });
  assert.deepEqual(stores.confirmed.get(tie.id), tie);
  assert.equal(stores.pending.size, 0);
  assert.deepEqual(await importWorkspaceBackup(imported, "merge"),
    { imported: 0, updated: 0, skipped: 4, mode: "local" });
});

test("remote import rejects replacement and merges through the regular queue", async (t) => {
  remote(t);
  const existing = task("same");
  const change = task("change");
  const deleted = { ...task("tombstone"), deleted: true };
  stores.confirmed.set(existing.id, existing);
  stores.confirmed.set(change.id, change);
  stores.confirmed.set(deleted.id, deleted);
  const currentPending = { ...task("already-queued"), data: { ...task("x").data, title: "队列里" } };
  await enqueue("task", currentPending.id, "put", currentPending.data);
  const changed = { ...change, deleted: true };
  const input = backupOf(task("new"), { ...existing, updatedAt: later, version: 6 },
    changed, deleted, { ...task("missing-tombstone"), deleted: true }, currentPending);
  await assert.rejects(importWorkspaceBackup(input, "replace"), /连接服务器模式下仅支持合并导入/);
  assert.deepEqual(await importWorkspaceBackup(input, "merge"),
    { imported: 1, updated: 1, skipped: 4, mode: "remote" });
  assert.deepEqual([...stores.confirmed.values()], [existing, change, deleted]);
  assert.deepEqual(queuedWrites().map(({ entityId, action }) => [entityId, action]),
    [["already-queued", "put"], ["new", "put"], ["change", "delete"]]);
  assert.deepEqual(await importWorkspaceBackup(input, "merge"),
    { imported: 0, updated: 0, skipped: 6, mode: "remote" });
  await synchronize();
});

test("remote import queues references before their dependents from a child-first backup", async (t) => {
  remote(t);
  const rows = [
    record("domain", "practice-4", { name: "领域" }),
    record("activity", "practice-3", { name: "子领域", domainId: "practice-4" }),
    record("problem", "practice-2", { title: "主问题", status: "pending", domainId: "practice-4", activityId: "practice-3" }),
    record("solution", "practice-1", { title: "方案", status: "pending", problemId: "practice-2" }),
    record("category", "money-3", { name: "父科目" }),
    record("category", "money-2", { name: "子科目", parentId: "money-3" }),
    record("expense", "money-1", {
      title: "花销", mode: "immediate", amountMinor: "100", day: "2026-01-01", categoryId: "money-3", subcategoryId: "money-2",
    }),
    record("storageBox", "storage-3", { name: "父箱", zone: "家" }),
    record("storageBox", "storage-2", { name: "子箱", zone: "家", parentId: "storage-3" }),
    record("storageItem", "storage-1", { name: "物品", status: "in_box", boxId: "storage-2", homeBoxId: "storage-2" }),
    record("habit", "habit-3", { name: "习惯", kind: "binary", status: "active" }),
    record("habitRule", "habit-2", { habitId: "habit-3", effectiveFrom: "2026-01-01" }),
    record("habitLog", "habit-1", { habitId: "habit-3", ruleId: "habit-2", day: "2026-01-01" }),
    record("wallet", "wallet-3", { name: "钱包", category: "stock", currency: "CNY" }),
    record("asset", "wallet-2", { name: "股票", kind: "stock" }),
    record("walletEntry", "wallet-1", { walletId: "wallet-3", assetId: "wallet-2", mode: "set", quantity: "1", at: earlier }),
    record("checklist", "checklist-2", { name: "清单" }),
    record("checklistRun", "checklist-1", { checklistId: "checklist-2", day: "2026-01-01" }),
    record("metric", "metric-2", { name: "指标" }),
    record("metricLog", "metric-1", { metricId: "metric-2", day: "2026-01-01", value: 1 }),
    task("task-2"),
    { ...task("task-1"), data: { ...task("task-1").data, prerequisiteIds: ["task-2"] } },
    record("achievement", "achievement-2", { title: "前置成就", scope: "lifetime" }),
    record("achievement", "achievement-1", { title: "后续成就", scope: "lifetime", prevIds: ["achievement-2"] }),
  ];
  const input = backupOf(...rows.toReversed());
  assert.deepEqual(await importWorkspaceBackup(input, "merge"),
    { imported: rows.length, updated: 0, skipped: 0, mode: "remote" });
  const queue = queuedWrites();
  assert.equal(queue.length, rows.length);
  assert.ok(queue.every(({ action }) => action === "put"));
  const position = new Map(queue.map(({ entityId, sequence }) => [entityId, sequence]));
  for (const chain of [
    ["practice-4", "practice-3", "practice-2", "practice-1"],
    ["money-3", "money-2", "money-1"],
    ["storage-3", "storage-2", "storage-1"],
    ["habit-3", "habit-2", "habit-1"],
    ["wallet-3", "wallet-1"],
    ["wallet-2", "wallet-1"],
    ["checklist-2", "checklist-1"],
    ["metric-2", "metric-1"],
    ["task-2", "task-1"],
    ["achievement-2", "achievement-1"],
  ]) {
    for (let index = 1; index < chain.length; index++) {
      const parent = chain[index - 1];
      const child = chain[index];
      assert.ok(position.get(parent)! < position.get(child)!, `${parent} must precede ${child}`);
    }
  }
  await synchronize();
});

test("remote import queues deletes after puts and uses current links to delete children first", async (t) => {
  remote(t);
  const parent = record("storageBox", "box-a", { name: "父箱", zone: "家" });
  const child = record("storageBox", "box-b", { name: "子箱", zone: "家", parentId: parent.id });
  const item = record("storageItem", "box-c", { name: "物品", status: "in_box", boxId: child.id });
  for (const entity of [parent, child, item]) stores.confirmed.set(entity.id, entity);
  const tombstones = [parent, child, item].map((entity) => ({ ...entity, deleted: true, data: {} }));
  assert.deepEqual(await importWorkspaceBackup(backupOf(...tombstones, task("new-task")), "merge"),
    { imported: 1, updated: 3, skipped: 0, mode: "remote" });
  assert.deepEqual(queuedWrites().map(({ entityId, action }) => [entityId, action]), [
    ["new-task", "put"], [item.id, "delete"], [child.id, "delete"], [parent.id, "delete"],
  ]);
  await synchronize();
});

test("remote import breaks a cyclic ordering constraint deterministically and preserves all payloads", async (t) => {
  remote(t);
  const parent = record("category", "cycle-b", { name: "父科目", defaultChildId: "cycle-a" });
  const child = record("category", "cycle-a", { name: "子科目", parentId: parent.id });
  const expense = record("expense", "cycle-c", {
    title: "花销", mode: "immediate", amountMinor: "100", day: "2026-01-01", categoryId: parent.id, subcategoryId: child.id,
  });
  for (const input of [[expense, child, parent], [parent, child, expense]]) {
    stores.pending.clear();
    assert.deepEqual(await importWorkspaceBackup(backupOf(...input), "merge"),
      { imported: 3, updated: 0, skipped: 0, mode: "remote" });
    assert.deepEqual(queuedWrites().map(({ entityId, data }) => [entityId, data]),
      [parent, child, expense].map(({ id, data }) => [id, data]));
    await synchronize();
  }
});

test("local single and batch writes publish confirmed records only after commit", async (t) => {
  local(t);
  await importWorkspaceBackup(backupOf(), "replace");
  await ensure("task");
  const snapshots: AnyEntity[][] = [];
  t.after(subscribe(["task"], () => { snapshots.push(snapshot("task")); }));
  const first = task("first");
  const second = task("second");

  assert.equal(await enqueue(first.type, first.id, "put", first.data), first.id);
  await enqueue("task", first.id, "patch", { title: "编辑", note: "暂存" }, first.data);
  await assert.rejects(enqueue("task", first.id, "patch", { title: "冲突" }, first.data), /相同字段/);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.at(-1)?.[0].version, 2);

  const firstWrite = { type: first.type, id: first.id, action: "patch" as const, data: { note: null }, baseVersion: 2 };
  const secondWrite = { type: second.type, id: second.id, action: "put" as const, data: second.data };
  await assert.rejects(enqueueTogether([firstWrite]), /记录数超限/);
  await assert.rejects(enqueueTogether([firstWrite, { ...secondWrite, id: "FIRST" }]), /重复记录/);
  await assert.rejects(enqueueTogether([secondWrite, { ...firstWrite, baseVersion: 1 }]), /记录已更新/);
  await assert.rejects(enqueueTogether([secondWrite, { ...firstWrite, editBase: first.data }]), /记录已经变更/);
  assert.equal(stores.confirmed.has(second.id), false);
  assert.equal(snapshots.length, 2);

  await enqueueTogether([firstWrite, secondWrite]);
  assert.deepEqual(snapshots.at(-1)?.map(({ id, version }) => [id, version]), [["first", 3], ["second", 1]]);
  assert.equal((stores.confirmed.get(first.id) as AnyEntity).data.note, undefined);
  await enqueue("task", first.id, "delete");
  assert.equal((stores.confirmed.get(first.id) as AnyEntity).deleted, true);
  await assert.rejects(enqueue("task", first.id, "patch", { title: "已删除" }), /已被移除/);
  assert.deepEqual(snapshots.at(-1)?.map(({ id }) => id), ["second"]);
  assert.equal(stores.pending.size, 0);
  assert.equal(stores.meta.has("sequence"), false);
  assert.deepEqual(pendingSnapshot(), []);
});

test("local sync and quotes do not start any network or polling", async (t) => {
  local(t);
  t.mock.method(globalThis, "fetch", () => assert.fail("local mode requested the network"));
  t.mock.method(globalThis, "setInterval", () => assert.fail("local mode started polling"));
  t.mock.method(navigator.locks, "request", () => assert.fail("local mode started server sync"));
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true, value: class { constructor() { assert.fail("local mode started SSE"); } },
  });
  t.after(() => { Reflect.deleteProperty(globalThis, "EventSource"); });
  startSync();
  assert.deepEqual(statusSnapshot(), { state: "local", message: "仅本机" });
  await synchronize();
  assert.deepEqual(statusSnapshot(), { state: "local", message: "仅本机" });
  assert.match(await pairDevice("synthetic-code") ?? "", /无需配对/);
  assert.deepEqual(await fetchQuotes(["asset-a", "asset-b", "asset-a"]), { quotes: {}, missing: ["asset-a", "asset-b"] });
  await assert.rejects(searchQuotes("A", "crypto"), /仅本机模式暂不支持在线搜索行情/);
});
