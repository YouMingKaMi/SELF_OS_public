import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnyEntity } from "../../packages/contracts/entities.ts";
import { runTool } from "../../services/council-query/query.ts";

function row(
  type: AnyEntity["type"],
  id: string,
  data: AnyEntity["data"],
): AnyEntity {
  return {
    type,
    id,
    data,
    version: 1,
    deleted: false,
    updatedAt: "2026-11-17T00:01:00Z",
  };
}

test("the original purchase month owns proceeds, and a current-month total stops today", async () => {
  const rows = [
    row("expense", "sale", {
      day: "2026-10-05",
      amountMinor: "23000",
      recoveryMinor: "4200",
      recoveryDay: "2026-11-04",
      categoryId: "parent",
      subcategoryId: "child",
      necessary: true,
    }),
    row("expense", "other", { day: "2026-11-04", amountMinor: "1000" }),
    row("expense", "future", { day: "2026-11-18", amountMinor: "2000" }),
    row("category", "child", { parentId: "parent", name: "用品" }),
  ];
  const reader = async () => ({ revision: 12, rows });
  const october = await runTool(
    "council_expenses_summary",
    { month: "2026-10", category_id: "parent", necessity: "necessary" },
    reader,
    "2026-11-17",
  );
  const november = await runTool(
    "council_expenses_summary",
    { month: "2026-11" },
    reader,
    "2026-11-17",
  );
  assert.ok("netMinor" in october && "netMinor" in november);
  assert.equal(october.netMinor, "18800");
  assert.equal(october.recoveryMinor, "4200");
  assert.equal(november.netMinor, "1000");
  assert.equal(november.days, 17);
  assert.equal(november.averageDailyYuan, "0.59");
});

test("notes include raw material and monthly reports, range filters and revision keep pagination stable", async () => {
  const rows = [
    row("journal", "chronicle", {
      day: "2026-11-03",
      kind: "chronicle",
      body: "chronicle",
    }),
    row("journal", "raw", { day: "2026-11-03", kind: "raw", body: "raw" }),
    row("document", "monthly", {
      month: "2026-11",
      kind: "monthly",
      body: "monthly",
    }),
  ];
  const reader = async () => ({ revision: 12, rows });
  const notes = await runTool(
    "council_read",
    { section: "notes", limit: 1 },
    reader,
  );
  assert.ok("records" in notes);
  assert.equal(notes.total, 2);
  assert.equal(notes.nextOffset, 1);
  const month = await runTool(
    "council_read",
    {
      section: "notes",
      date_field: "period",
      start_date: "2026-11-17",
      end_date: "2026-11-17",
      revision: 12,
    },
    reader,
  );
  assert.ok("records" in month);
  assert.equal(month.records?.[0]?.id, "monthly");
  await assert.rejects(
    runTool("council_read", { section: "notes", revision: 11 }, reader),
    /已更新/,
  );
});

test("habit date range constrains logs while preserving the historical rule", async () => {
  const reader = async () => ({
    revision: 1,
    rows: [
      row("habit", "h", { name: "阅读" }),
      row("habitRule", "r", { habitId: "h", effectiveFrom: "2026-02-01" }),
      row("habitLog", "old", { habitId: "h", day: "2026-02-01" }),
      row("habitLog", "today", { habitId: "h", day: "2026-11-17" }),
    ],
  });
  const result = await runTool(
    "council_read",
    { section: "habits", ids: ["h"], start_date: "2026-11-01" },
    reader,
  );
  assert.ok("records" in result);
  assert.deepEqual(
    result.records?.map((row) => row.id),
    ["today", "h", "r"],
  );
});
