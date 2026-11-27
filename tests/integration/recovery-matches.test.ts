import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { purgeOwner, rotateRestoredGeneration } from "../../modules/kernel/server.ts";
import type { CommandBatch } from "../../packages/contracts/command-batch.ts";
import type { RecoveryProbe, RecoveryResponse } from "../../packages/contracts/recovery.ts";
import { buildApp, developmentAuth } from "../../services/api/app.ts";
import { compose } from "../../services/api/compose.ts";
import { client } from "../support.ts";

test("recovery matches only this device's intact receipts and exact unique creations in the snapshot", async () => {
  const { sync, pool } = await compose(process.env.DATABASE_URL);
  const owner = "recovery-" + randomUUID();
  const app = buildApp(sync, developmentAuth("test-recovery", owner));
  try {
    const c = client(sync, owner, "phone");
    const command = c.command("idea", randomUUID(), 0, {
      body: "received before restore", status: "pending", day: "2026-11-22",
    });
    const single = await c.send(command);
    assert.equal(single.outcome, "accepted");
    const batchId = randomUUID();
    const batch: CommandBatch = {
      operationId: batchId,
      commands: [1, 2].map((number) => ({
        entityId: randomUUID(), entityType: "idea", action: "put", baseVersion: 0,
        occurredAt: command.occurredAt,
        data: { body: "batch " + number, status: "pending", day: "2026-11-22" },
      })),
    };
    assert.equal((await sync.executeBatch(owner, "phone", batch)).outcome, "accepted");
    const budget = await c.create("budget", { month: "2026-11", amountMinor: "3200" });

    await rotateRestoredGeneration(pool);
    const { datasetId, generation, watermark } = await sync.state(owner);
    const scope = { datasetId, generation };
    const singleProbe: RecoveryProbe = { operationId: command.operationId, entityType: "idea",
      entityId: command.entityId, command };
    const batchProbe: RecoveryProbe = { operationId: batchId, entityType: "idea",
      entityId: batch.commands[1].entityId, batch };
    const creation: RecoveryProbe = { operationId: randomUUID(), entityType: "budget",
      entityId: randomUUID(), creation: { month: "2026-11", amountMinor: "3200" } };
    const submit = async (device: string, probes: RecoveryProbe[], at = watermark) => {
      const response = await app.inject({ method: "POST", url: "/v1/recovery-matches",
        headers: { authorization: "Bearer test-recovery", "x-device-id": device },
        payload: { scope, watermark: at, probes } });
      assert.equal(response.statusCode, 200, response.body);
      return response.json<RecoveryResponse>().matches;
    };
    assert.deepEqual(await submit("phone", [singleProbe, batchProbe, creation]), [
      { operationId: singleProbe.operationId, kind: "receipt", entityId: singleProbe.entityId },
      { operationId: batchId, kind: "receipt", entityId: batchProbe.entityId },
      { operationId: creation.operationId, kind: "businessKey", entityId: budget.id, version: 1 },
    ]);
    assert.deepEqual(await submit("other phone", [singleProbe, batchProbe]), []);
    assert.deepEqual(await submit("phone", [
      { ...singleProbe, command: { ...command, data: { ...command.data, body: "different edit" } } },
      { ...batchProbe, batch: { ...batch, commands: [...batch.commands].reverse() } },
      { ...creation, creation: { ...creation.creation, amountMinor: "3201" } },
    ]), []);
    assert.deepEqual(await submit("phone", [singleProbe, batchProbe, creation], "0"), []);
    assert.equal((await sync.state(owner)).watermark, watermark);
  } finally {
    await app.close();
    await purgeOwner(pool, owner);
    await pool.end();
  }
});
