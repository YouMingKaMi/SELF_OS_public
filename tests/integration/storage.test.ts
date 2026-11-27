import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { purgeOwner } from "../../modules/kernel/server.ts";
import type { BatchMember, CommandBatch } from "../../packages/contracts/command-batch.ts";
import { compose } from "../../services/api/compose.ts";
import { client } from "../support.ts";

test("storage box deletion uses live PostgreSQL references and rolls back a failed batch", async (t) => {
  const { pool, sync } = await compose(process.env.DATABASE_URL);
  const owner = "storage-" + randomUUID();
  t.after(async () => {
    try {
      await purgeOwner(pool, owner);
    } finally {
      await pool.end();
    }
  });

  const c = client(sync, owner);
  const box = await c.create("storageBox", { zone: "宿舍", name: "抽屉" });
  const item = await c.create("storageItem", {
    name: "耳机", status: "out", boxId: box.id, homeBoxId: box.id,
    takenAt: "2026-11-26T10:00:00.000Z", quantity: 2,
  });
  const before = (await sync.changes(owner)).nextCursor;
  const occurredAt = "2026-11-26T11:00:00.000Z";
  const remove: BatchMember = {
    entityType: box.type, entityId: box.id, baseVersion: box.version, action: "delete", occurredAt,
  };
  const patch: BatchMember = {
    entityType: item.type, entityId: item.id, baseVersion: item.version, action: "patch",
    data: { boxId: null }, occurredAt,
  };
  const batch: CommandBatch = { operationId: randomUUID(), commands: [patch, remove] };

  await assert.rejects(sync.executeBatch(owner, "device", batch), {
    message: "STORAGE_BOX_NOT_EMPTY",
  });
  assert.deepEqual((await sync.changes(owner, before)).changes, []);

  const result = await sync.executeBatch(owner, "device", {
    ...batch,
    commands: [{ ...patch, data: { boxId: null, homeBoxId: null } }, remove],
  });
  assert.equal(result.outcome, "accepted");
  const changes = result.effects.map(({ entity, revision }) => ({ entity, revision }));
  assert.equal(changes[0].entity.id, item.id);
  assert.deepEqual(changes[0].entity.data, {
    name: "耳机", status: "out", takenAt: item.data.takenAt, quantity: 2,
  });
  assert.equal(changes[1].entity.id, box.id);
  assert.equal(changes[1].entity.deleted, true);
  assert.deepEqual((await sync.changes(owner, before)).changes, changes);
});
