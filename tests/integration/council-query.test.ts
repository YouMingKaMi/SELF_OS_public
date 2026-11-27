import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { purgeOwner, readOwnerSnapshot } from "../../modules/kernel/server.ts";
import { compose } from "../../services/api/compose.ts";
import { expandedSections } from "../../services/council-gemini/sections.ts";
import { createCouncilReader } from "../../services/council-query/postgres.ts";
import { readRecords, runTool, type Reader } from "../../services/council-query/query.ts";
import { client } from "../support.ts";

const { pool, sync } = await compose(process.env.DATABASE_URL);
const owner = "query-" + randomUUID();
const unrelated = "outside-query-" + randomUUID();
const read = createCouncilReader(pool, owner);
const original: Reader = (types, deleted) =>
  readOwnerSnapshot(pool, owner, types, deleted);

after(async () => {
  await purgeOwner(pool, owner);
  await purgeOwner(pool, unrelated);
  await pool.end();
});

test("server-side pages preserve the read contract across scopes, dates and timestamps", async () => {
  const c = client(sync, owner);
  await c.create("taskList", { name: "待办" });
  await c.create("task", {
    title: "活动范围",
    status: "pending",
    scheduleKind: "range",
    scheduleStart: "2026-11-10",
    scheduleEnd: "2026-11-20",
    createdAt: "2026-11-16T16:03:00Z",
  });
  const dated = await c.create("task", {
    title: "具体日期",
    status: "pending",
    scheduleKind: "day",
    scheduleDate: "2026-11-17",
  });
  const deleted = await c.create("task", {
    title: "旧任务",
    status: "pending",
    scheduleKind: "day",
    scheduleDate: "2026-11-17",
  });
  await c.remove(deleted);
  const habit = await c.create("habit", {
    name: "É图书",
    kind: "binary",
    status: "active",
  });
  await c.create("habitRule", {
    habitId: habit.id,
    effectiveFrom: "2026-10-01",
    weekdays: ["1", "3"],
  });
  await c.create("habitLog", {
    habitId: habit.id,
    day: "2026-11-17",
    value: 1,
  });
  await c.create("habitLog", {
    habitId: habit.id,
    day: "2026-10-20",
    value: 1,
  });
  await c.create("budget", { month: "2026-02", amountMinor: "9999" });
  await c.create("budget", { month: "0000-02", amountMinor: "9999" });
  await c.create("journal", { day: "2026-11-17", kind: "raw", body: "Key" });
  await c.create("journal", {
    day: "2026-11-16",
    kind: "chronicle",
    body: "记录索引验收",
  });
  await c.create("journal", {
    day: "2026-11-15",
    kind: "chronicle",
    body: "x".repeat(20000),
  });
  await c.create("document", {
    title: "月报",
    kind: "monthly",
    month: "2026-11",
    body: "x".repeat(15999) + "📆" + "x".repeat(4000),
  });
  await c.create("document", {
    title: "笔记",
    kind: "note",
    day: "2026-11-17",
    body: "x".repeat(14000) + "索引验收",
    tags: ["全文标签验收"],
  });
  await client(sync, unrelated).create("journal", {
    day: "2026-11-17",
    kind: "raw",
    body: "owner isolation",
  });
  await c.create("importantDay", {
    name: "当天",
    date: "2026-11-17",
    calendar: "solar",
    repeat: "once",
    intervalUnit: "day",
    remindDays: 0,
  });
  await c.create("importantDay", {
    name: "提前",
    date: "2026-11-17",
    calendar: "solar",
    repeat: "once",
    intervalUnit: "day",
    remindDays: 2,
  });
  const wallet = await c.create("wallet", {
    name: "合成钱包",
    category: "cny",
    currency: "CNY",
  });
  await c.create("walletEntry", {
    walletId: wallet.id,
    mode: "delta",
    quantity: "1.00000001",
    at: "2026-11-16T16:00:00Z",
  });

  const day = { start_date: "2026-11-17", end_date: "2026-11-17" };
  for (const args of [
    { section: "tasks", ...day, include_deleted: true },
    { section: "tasks", ...day, offset: 300 },
    { section: "tasks", ...day, ids: ["invalid-id", dated.id.toUpperCase()] },
    { section: "tasks", ...day, ids: [dated.id] },
    { section: "tasks", ...day, date_field: "createdAt" },
    { section: "habits", ...day, ids: [habit.id] },
    { section: "habits", ...day, query: " É " },
    { section: "habits", ...day, query: "1,3" },
    { section: "notes", query: "key", ...day },
    { section: "notes", query: "月报", ...day },
    { section: "notes", query: "全文标签验收" },
    { section: "notes", query: "索引验收", limit: 1 },
    { section: "chronicle_days", query: "索引验收" },
    { section: "notes", limit: 2 },
    { section: "notes", offset: 1 },
    { section: "notes", ...day, date_field: "period" },
    { section: "notes", date_field: "updatedAt" },
    { section: "chronicle", limit: 1 },
    { section: "chronicle_days" },
    { section: "reminders" },
    { section: "important_dates", date_field: "period", ...day },
    { section: "expense_budgets", end_date: "2026-02-28" },
    { section: "expense_budgets", start_date: "2026-02-28" },
    { section: "treasury_changes", ...day },
  ]) {
    const wanted = await runTool("council_read", args, original);
    assert.deepEqual(
      await runTool("council_read", args, read),
      wanted,
      JSON.stringify(args),
    );
  }
  const scoped = { reference_notes: ["document"] as const };
  for (const query of ["", "月报", "索引验收", "x"]) {
    const args = { section: "reference_notes", query };
    const result = await readRecords(args, read, scoped);
    assert.deepEqual(result, await readRecords(args, original, scoped));
    assert.equal(result.total, query === "月报" ? 0 : 1);
    assert.ok(result.records.every((row) => row.data.kind === "note"));
  }
  for (const args of [
    { section: "monthly_reports", date_field: "period", ...day },
    { section: "personal_thoughts" },
    { section: "raw_materials", query: "key", ...day },
  ]) {
    const result = await readRecords(args, read, expandedSections);
    assert.deepEqual(result, await readRecords(args, original, expandedSections));
    assert.equal(result.total, args.section === "personal_thoughts" ? 0 : 1);
  }
  const next = await runTool(
    "council_read",
    { section: "tasks", limit: 1 },
    read,
  );
  await c.update(dated, { title: "更新" });
  await assert.rejects(
    runTool(
      "council_read",
      { section: "tasks", revision: next.revision, offset: 1 },
      read,
    ),
    /已更新/,
  );
});

test("monthly SQL scope retains the current-month cutoff, refunds and exact grouping", async () => {
  const c = client(sync, owner);
  const category = await c.create("category", { name: "合成分类" });
  const child = await c.create("category", {
    name: "合成子分类",
    parentId: category.id,
  });
  await c.create("expense", {
    title: "有退回的十月花销",
    day: "2026-10-02",
    categoryId: category.id,
    subcategoryId: child.id,
    mode: "immediate",
    amountMinor: "999999999999999989",
    recoveryMinor: "123",
    recoveryDay: "2026-11-16",
    necessary: true,
  });
  await c.create("expense", {
    title: "未来花销",
    day: "2026-11-18",
    mode: "immediate",
    amountMinor: "10",
  });
  await c.create("expense", {
    title: "今日花销",
    day: "2026-11-17",
    mode: "immediate",
    amountMinor: "10",
    necessary: false,
  });
  for (const args of [
    { month: "2026-10", category_id: category.id, necessity: "necessary" },
    { month: "2026-11", necessity: "optional" },
    { month: "2026-11", necessity: "undecided" },
    { month: "2026-12" },
  ]) {
    const want = await runTool(
      "council_expenses_summary",
      args,
      original,
      "2026-11-17",
    );
    assert.deepEqual(
      await runTool("council_expenses_summary", args, read, "2026-11-17"),
      want,
    );
  }
});
