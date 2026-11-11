import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compose } from "../../services/api/compose.ts";
import {
  migrate,
  purgeOwner,
  storageModel,
} from "../../modules/kernel/server.ts";
import { client } from "../support.ts";

// Real PostgreSQL (infra/compose.yaml). Each test uses its own owner and removes it afterwards.
const { pool, sync } = await compose(process.env.DATABASE_URL);
const owners: string[] = [];
function owner(label: string) {
  const id = label + "-" + randomUUID();
  owners.push(id);
  return id;
}
after(async () => {
  for (const id of owners) await purgeOwner(pool, id);
  await pool.end();
});

test("migrations are recorded once and the live database matches the entity schema", async () => {
  assert.deepEqual(await migrate(pool), []);
  const columns = (
    await pool.query(
      "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='council'",
    )
  ).rows;
  for (const [table, model] of Object.entries(storageModel()))
    for (const [quoted, definition] of Object.entries(model.columns)) {
      const column = columns.find(
        (c) => c.table_name === table && c.column_name === quoted.slice(1, -1),
      );
      assert.ok(column, `${table}.${quoted} is missing`);
      assert.equal(
        column.is_nullable === "NO",
        definition.includes("NOT NULL"),
        `${table}.${quoted} nullability`,
      );
      const type = definition.split(" NOT NULL")[0].split(" CHECK")[0];
      assert.equal(
        column.data_type,
        type === "timestamptz" ? "timestamp with time zone" : type,
      );
    }
});

test("typed storage round-trips every kind of field exactly", async () => {
  const c = client(sync, owner("types"));
  const wallet = await c.create("wallet", {
    name: "冷钱包",
    category: "crypto",
    currency: "USD",
    unitPrice: "64000.10",
  });
  const entry = await c.create("walletEntry", {
    walletId: wallet.id,
    mode: "delta",
    quantity: "-0.000000000001",
    at: "2026-11-07T08:00:00+08:00",
  });
  assert.deepEqual(entry.data, {
    walletId: wallet.id,
    mode: "delta",
    quantity: "-0.000000000001",
    at: "2026-11-07T00:00:00.000Z",
  });
  const expense = await c.create("expense", {
    title: "年费",
    day: "2026-11-07",
    amountMinor: "999999999999999999",
    mode: "fixed",
    startDay: "2026-11-07",
    endDay: "2027-11-06",
    necessary: true,
  });
  const lunar = await c.create("importantDay", {
    name: "生日",
    calendar: "lunar",
    lunarYear: 1990,
    lunarMonth: 4,
    lunarDay: 30,
    leap: true,
    repeat: "yearly",
    intervalUnit: "year",
    remindDays: 3,
  });
  const list = await c.create("checklist", {
    name: "出门",
    items: ["钥匙", "手机"],
  });
  const stored = new Map(
    (await sync.changes(c.owner)).changes.map((row) => [
      row.entity.id,
      row.entity,
    ]),
  );
  for (const entity of [wallet, entry, expense, lunar, list])
    assert.deepEqual(stored.get(entity.id), entity);
  const row = (
    await pool.query(
      "SELECT amount_minor, day, pg_typeof(amount_minor)::text AS t FROM expense_entries WHERE id=$1",
      [expense.id],
    )
  ).rows[0];
  assert.deepEqual(
    [row.amount_minor, row.day, row.t],
    ["999999999999999999", "2026-11-07", "bigint"],
  );
});

test("two devices editing the same version: exactly one wins, the other gets a conflict", async () => {
  const id = owner("race"),
    a = client(sync, id, "a"),
    b = client(sync, id, "b");
  const task = await a.create("task", {
    title: "模拟任务",
    status: "pending",
    scheduleKind: "recent",
  });
  const results = await Promise.all(
    [a, b].map((device, i) =>
      device.send(
        device.command("task", task.id, 1, { ...task.data, title: "by-" + i }),
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.outcome).sort(), [
    "accepted",
    "conflict",
  ]);
  const feed = await sync.changes(id);
  assert.deepEqual(
    feed.changes.map((row) => [row.revision, row.entity.version]),
    [["2", 2]],
  );
});

test("parallel writers get gap-free revisions in commit order; receipts survive retries", async () => {
  const id = owner("order"),
    c = client(sync, id);
  const commands = Array.from({ length: 12 }, (_, i) =>
    c.command("idea", randomUUID(), 0, {
      body: "想法 " + i,
      day: "2026-11-07",
      status: "pending",
    }),
  );
  const receipts = await Promise.all(
    commands.map((command) => c.send(command)),
  );
  assert.deepEqual(
    receipts
      .map((r) => (r.outcome === "accepted" ? Number(r.revision) : -1))
      .sort((x, y) => x - y),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    await Promise.all(commands.map((command) => c.send(command))),
    receipts,
  );
  await assert.rejects(
    c.send({ ...commands[0], data: { ...commands[0].data, body: "changed" } }),
    /OPERATION_REUSED/,
  );
  const pages = [];
  let cursor = "0";
  for (;;) {
    const page = await sync.changes(id, cursor, 5);
    pages.push(page.changes.length);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  assert.deepEqual([pages, cursor], [[5, 5, 2], "12"]);
});

test("the change feed stays one row per entity however often a long document is saved", async () => {
  const id = owner("compact"),
    c = client(sync, id);
  let doc = await c.create("document", {
    title: "长文",
    kind: "thought",
    body: "x".repeat(200000),
  });
  for (let i = 0; i < 5; i++)
    doc = await c.update(doc, { body: String(doc.data.body) + i });
  const heads = (
    await pool.query(
      "SELECT count(*)::int AS n FROM sync_heads WHERE owner_id=$1",
      [id],
    )
  ).rows[0].n;
  const receiptBytes = (
    await pool.query(
      "SELECT coalesce(sum(pg_column_size(r.*)),0)::int AS n FROM sync_receipts r WHERE owner_id=$1",
      [id],
    )
  ).rows[0].n;
  assert.equal(heads, 1);
  assert.ok(
    receiptBytes < 6 * 400,
    "receipts must not copy document bodies: " + receiptBytes,
  );
  const feed = await sync.changes(id);
  assert.deepEqual(
    [feed.changes.length, feed.changes[0].entity.version, feed.nextCursor],
    [1, 6, "6"],
  );
});

test("owners are isolated at every layer, including the database constraints", async () => {
  const mine = owner("mine"),
    theirs = owner("theirs");
  const a = client(sync, mine),
    b = client(sync, theirs);
  const domain = await a.create("domain", { name: "私有" });
  await assert.rejects(
    b.create("activity", { domainId: domain.id, name: "越权" }),
    /MISSING_REFERENCE:domainId/,
  );
  assert.equal((await sync.changes(theirs)).changes.length, 0);
  await assert.rejects(
    pool.query(
      "INSERT INTO practice_activities(owner_id,id,version,updated_at,domain_id,name) VALUES($1,$2,1,now(),$3,'x')",
      [theirs, randomUUID(), domain.id],
    ),
    /practice_activities_domain_id_fk/,
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO idea_entries(owner_id,id,version,updated_at,body,day,status) VALUES($1,$2,1,now(),'x','2026-11-07','bogus')",
      [mine, randomUUID()],
    ),
    /check/,
  );
});

test("a failed rule rolls the whole write back", async () => {
  const id = owner("rollback"),
    c = client(sync, id);
  const habit = await c.create("habit", {
    name: "阅读",
    kind: "binary",
    status: "active",
  });
  const rule = await c.create("habitRule", {
    habitId: habit.id,
    effectiveFrom: "2026-11-01",
  });
  await c.create("habitLog", {
    habitId: habit.id,
    ruleId: rule.id,
    day: "2026-11-07",
    value: 1,
  });
  const before = await sync.changes(id);
  await assert.rejects(
    c.update(rule, { target: 2 }),
    /INVALID_RULE_RECORDED_DATES/,
  );
  assert.deepEqual(await sync.changes(id), before);
});
