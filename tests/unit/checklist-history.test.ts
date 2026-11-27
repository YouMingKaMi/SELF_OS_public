import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore, SyncService } from "../../modules/kernel/server.ts";
import { runFields, runState } from "../../modules/tasks/index.ts";
import { composeRules } from "../../services/api/compose.ts";
import { client } from "../support.ts";

test("checklist items can share a name, and an active day's names and order stay frozen", async () => {
  const c = client(
    new SyncService(new MemoryStore(), composeRules()),
    "checklist",
  );
  const template = await c.create("checklist", {
    name: "出门",
    items: ["钥匙", "钥匙", "手机"],
    itemIds: ["office", "home", "phone"],
  });
  const start = runState(template.data);
  const run = await c.create("checklistRun", {
    checklistId: template.id,
    day: "2026-11-18",
    ...runFields(start.items, new Set(["office"]), new Set()),
  });
  assert.deepEqual(run.data.checkedItemIds, ["office"]);
  assert.deepEqual(run.data.checked, ["钥匙"]);

  const updated = await c.update(template, {
    items: ["手机", "公寓钥匙", "钥匙"],
    itemIds: ["phone", "home", "office"],
  });
  const existing = runState(updated.data, run.data);
  assert.deepEqual(existing.items, start.items);
  assert.equal(existing.checked.has("home"), false);
  const reset = await c.update(
    run,
    runFields(existing.items, new Set(), existing.ambiguous),
  );
  assert.deepEqual(reset.data.checkedItemIds, []);
  assert.deepEqual(reset.data.itemLabels, ["钥匙", "钥匙", "手机"]);
  const next = await c.create("checklistRun", {
    checklistId: template.id,
    day: "2026-11-19",
    checked: ["公寓钥匙"],
  });
  assert.deepEqual(next.data.itemLabels, ["手机", "公寓钥匙", "钥匙"]);
  assert.deepEqual(next.data.checkedItemIds, ["home"]);
});

test("legacy ambiguous selections are preserved without selecting every same-name item", async () => {
  const c = client(
    new SyncService(new MemoryStore(), composeRules()),
    "legacy-checklist",
  );
  const template = await c.create("checklist", {
    name: "出门",
    items: ["钥匙", "钥匙", "手机"],
  });
  const run = await c.create("checklistRun", {
    checklistId: template.id,
    day: "2026-01-01",
    checked: ["钥匙", "手机", "已删除"],
  });
  assert.deepEqual(run.data.ambiguousChecked, ["钥匙", "已删除"]);
  assert.deepEqual(run.data.checkedItemIds, [template.data.itemIds?.[2]]);
  assert.deepEqual(run.data.itemLabels, template.data.items);
  await assert.rejects(
    c.create("checklistRun", {
      checklistId: template.id,
      day: "2026-01-01",
      checked: [],
    }),
    /DUPLICATE_CHECKLIST_RUN/,
  );
});
