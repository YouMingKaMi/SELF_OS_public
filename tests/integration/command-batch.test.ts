import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { buildApp, developmentAuth } from "../../services/api/app.ts";
import { compose } from "../../services/api/compose.ts";
import { purgeOwner } from "../../modules/kernel/server.ts";
import type { BatchReceipt, CommandBatch } from "../../packages/contracts/command-batch.ts";
import { planJournalTransfer } from "../../apps/web/src/data/journal-transfer.ts";
import { client } from "../support.ts";

const { pool, sync } = await compose(process.env.DATABASE_URL);
const owner = "batch-" + randomUUID();
const app = buildApp(sync, developmentAuth("synthetic-batch", owner));
after(async () => {
  await app.close();
  await purgeOwner(pool, owner);
  await pool.end();
});

const headers = {
  authorization: "Bearer synthetic-batch",
  "x-device-id": "batch-device",
};

function habitBatch(): CommandBatch {
  const id = randomUUID();
  return {
    operationId: randomUUID(),
    commands: [
      { entityType: "habit", entityId: id, baseVersion: 0, action: "put",
        data: { name: "练习", status: "active", kind: "quantity" },
        occurredAt: "2026-11-18T12:00:00.000Z" },
      { entityType: "habitRule", entityId: randomUUID(), baseVersion: 0, action: "put",
        data: { habitId: id, effectiveFrom: "2026-11-18", kind: "quantity", target: 10 },
        occurredAt: "2026-11-18T12:00:00.000Z" },
    ],
  };
}

test("batch rolls back an invalid rule, records one receipt and two change heads, and replays after a later edit", async () => {
  const before = await sync.state(owner);
  const batch = habitBatch();
  batch.commands[1].data!.target = 0;
  const send = (payload: CommandBatch) => app.inject({
    method: "POST", url: "/v1/command-batches", headers, payload,
  });
  const rejected = await send(batch);
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal((await sync.state(owner)).watermark, before.watermark);
  const stored = () => pool.query(
    "SELECT * FROM sync_receipts WHERE owner_id=$1", [owner],
  );
  assert.equal((await stored()).rowCount, 0);

  batch.commands[1].data!.target = 10;
  const accepted = await send(batch);
  assert.equal(accepted.statusCode, 200, accepted.body);
  const receipt = accepted.json<BatchReceipt>();
  assert.equal(receipt.outcome, "accepted");
  assert.equal((await stored()).rowCount, 1);
  assert.deepEqual((await sync.changes(owner, before.watermark)).changes,
    receipt.effects.map(({ entity, revision }) => ({ entity, revision })));
  assert.deepEqual((await send(batch)).json(), receipt);

  const changed = await client(sync, owner).update(receipt.effects[0].entity, { name: "新名称" });
  const retry = (await send(batch)).json<BatchReceipt>();
  assert.equal(retry.outcome, "accepted");
  assert.deepEqual(retry.effects.map((effect) => effect.revision), receipt.effects.map((effect) => effect.revision));
  assert.deepEqual(retry.effects[0].entity, changed);
  assert.equal((await send({ ...batch, commands: [...batch.commands].reverse() })).statusCode, 409);
});

test("two devices editing the same definition cannot partially commit their paired rule", async () => {
  const initial = habitBatch();
  const created = await sync.executeBatch(owner, "creator", initial);
  assert.equal(created.outcome, "accepted");
  const edits = [habitBatch(), habitBatch()].map((batch, index) => {
    batch.commands[0] = {
      ...initial.commands[0], baseVersion: 1, data: { ...initial.commands[0].data, name: "名称 " + index },
    };
    batch.commands[1].data = {
      ...batch.commands[1].data!, habitId: initial.commands[0].entityId,
      effectiveFrom: "2026-11-19", target: index + 1,
    };
    return batch;
  });
  const before = (await sync.state(owner)).watermark;
  const results = await Promise.all(edits.map((batch, index) => sync.executeBatch(owner, "editor" + index, batch)));
  assert.deepEqual(results.map((receipt) => receipt.outcome).sort(), ["accepted", "conflict"]);
  const changed = (await sync.changes(owner, before)).changes;
  assert.equal(changed.length, 2);
  const loser = results.findIndex((receipt) => receipt.outcome === "conflict");
  assert.deepEqual(await sync.executeBatch(owner, "editor" + loser, edits[loser]), results[loser]);
  await assert.rejects(sync.executeBatch(owner, "editor" + loser, {
    ...edits[loser], commands: [...edits[loser].commands].reverse(),
  }), /OPERATION_REUSED/);
});

test("a transfer preserves the original day and a competing transfer cannot duplicate the excerpt", async () => {
  const idea = await client(sync, owner).create("idea", { body: "录音 😀想法", day: "2026-10-31", status: "pending" });
  const batch = (): CommandBatch => ({
    operationId: randomUUID(),
    commands: planJournalTransfer(idea, randomUUID(), { start: 3, end: 7 })
      .map((write) => ({
        entityId: write.id, entityType: write.type, baseVersion: write.baseVersion!,
        action: write.action, data: write.data, occurredAt: "2026-11-25T10:00:00Z",
      })),
  });
  const intents = [batch(), batch()];
  const before = (await sync.state(owner)).watermark;
  const receipts = await Promise.all(intents.map((intent, index) => sync.executeBatch(owner, "transfer-" + index, intent)));
  assert.deepEqual(receipts.map((receipt) => receipt.outcome).sort(), ["accepted", "conflict"]);
  const effects = (await sync.changes(owner, before)).changes.map(({ entity }) => entity);
  assert.equal(effects.length, 2);
  assert.equal(effects.find((entity) => entity.type === "idea")?.data.body, "录音 ");
  assert.deepEqual(effects.find((entity) => entity.type === "journal")?.data,
    { body: "😀想法", day: "2026-10-31", kind: "raw", complete: false });
  const winner = receipts.findIndex((receipt) => receipt.outcome === "accepted");
  assert.deepEqual(await sync.executeBatch(owner, "transfer-" + winner, intents[winner]), receipts[winner]);
});

test("retention archives only aged receipts from revoked devices and preserves idempotency", async () => {
  const revoked = randomUUID();
  const active = randomUUID();
  await pool.query(
    `INSERT INTO identity_devices (id,owner_id,name,kind,secret_hash,revoked_at)
     VALUES ($1,$3,'revoked','phone','synthetic',now() - interval '181 days'),
            ($2,$3,'active','phone','synthetic',NULL)`,
    [revoked, active, owner],
  );
  const original = habitBatch();
  const accepted = await sync.executeBatch(owner, revoked, original);
  const activeBatch = habitBatch();
  await sync.executeBatch(owner, active, activeBatch);
  const fresh = habitBatch();
  await sync.executeBatch(owner, revoked, fresh);
  await pool.query(
    `UPDATE sync_receipts SET created_at=now() - interval '181 days'
     WHERE owner_id=$1 AND operation_id IN ($2,$3)`,
    [owner, original.operationId, activeBatch.operationId],
  );

  const runRetention = (mode: string) => promisify(execFile)(
    process.execPath, ["scripts/sync-receipt-retention.mjs", mode],
  );
  const archived = async () => (await pool.query(
    "SELECT operation_id FROM sync_receipts_archive WHERE owner_id=$1",
    [owner],
  )).rows.map((row) => row.operation_id);

  const preview = JSON.parse((await runRetention("preview")).stdout);
  assert.equal(Number(preview.eligible), 1);
  assert.deepEqual(await archived(), []);
  await runRetention("archive");
  await runRetention("archive");
  assert.deepEqual(await archived(), [original.operationId]);
  const watermark = (await sync.state(owner)).watermark;
  assert.deepEqual(await sync.executeBatch(owner, revoked, original), accepted);
  await assert.rejects(sync.executeBatch(owner, revoked, {
    ...original, commands: [...original.commands].reverse(),
  }), /OPERATION_REUSED/);
  assert.equal((await sync.state(owner)).watermark, watermark);
  await runRetention("recover");
  assert.deepEqual(await archived(), []);
  assert.deepEqual(await sync.executeBatch(owner, revoked, original), accepted);
});

test("competing task dependency edits cannot commit a cycle or an unrelated sibling in the losing batch", async () => {
  const c = client(sync, owner);
  const first = await c.create("task", { title: "甲", status: "pending", scheduleKind: "unscheduled" });
  const second = await c.create("task", { title: "乙", status: "pending", scheduleKind: "unscheduled" });
  const before = (await sync.state(owner)).watermark;
  const batches = [first, second].map((row, i): CommandBatch => ({
    operationId: randomUUID(),
    commands: [
      {
        entityType: "idea", entityId: randomUUID(), baseVersion: 0, action: "put",
        occurredAt: "2026-11-18T12:00:00.000Z", data: { body: "同批", day: "2026-11-18", status: "pending" },
      },
      {
        entityType: "task", entityId: row.id, baseVersion: row.version, action: "patch",
        occurredAt: "2026-11-18T12:00:00.000Z", data: { prerequisiteIds: [i ? first.id : second.id] },
      },
    ],
  }));
  const results = await Promise.allSettled(batches.map((batch, i) => sync.executeBatch(owner, "task-" + i, batch)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(String(results.find((result) => result.status === "rejected")?.reason), /TASK_DEPENDENCY_CYCLE/);
  assert.equal((await sync.changes(owner, before)).changes.length, 2);
});

test("referenced habit rules and nonempty task lists cannot be deleted", async () => {
  const c = client(sync, owner);
  const created = await sync.executeBatch(owner, "history", habitBatch());
  assert.equal(created.outcome, "accepted");
  const [{ entity: habit }, { entity: rule }] = created.effects;
  await c.create("habitLog", { habitId: habit.id, day: "2026-11-18", value: 1 });
  await assert.rejects(c.remove(rule), /HABIT_RULE_HAS_HISTORY/);
  await assert.rejects(c.remove(habit), /HABIT_HAS_HISTORY/);
  const list = await c.create("taskList", { name: "项目" });
  await c.create("task", { title: "子项", status: "pending", scheduleKind: "unscheduled", listId: list.id });
  await assert.rejects(c.remove(list), /TASK_LIST_NOT_EMPTY/);
});
