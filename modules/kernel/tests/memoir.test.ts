import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { schema } from "../../../packages/contracts/schema.ts";
import { client } from "../../../tests/support.ts";
import { normalize } from "../domain/normalize.ts";
import { MemoryStore, SyncService } from "../server.ts";

const title = "校运会接力";
const detail = "体育课练习交棒。\n\n比赛时跑第二棒。";

test("memoirs support all three periods with optional time, detail and order", async () => {
  const c = client(new SyncService(new MemoryStore(), {}), "owner");
  const payloads = [
    { period: "high_school", title, approxTime: "高二秋天", detail, order: 1.5 },
    { period: "middle_school", title, order: 0 },
    { period: "primary_and_below", title },
  ] as const;
  for (const payload of payloads) {
    const entry = await c.create("memoir", payload);
    assert.equal(entry.type, "memoir");
    assert.deepEqual(entry.data, payload);
  }
});

test("memoirs reject unknown or missing periods and empty titles", async () => {
  const sync = new SyncService(new MemoryStore(), {});
  const c = client(sync, "owner");
  const put = (period: string | undefined, heading: string) =>
    c.send(c.command("memoir", randomUUID(), 0, { period, title: heading }));

  await assert.rejects(put("university", title), /INVALID_FIELD:period/);
  await assert.rejects(put(undefined, title), /REQUIRED:period/);
  await assert.rejects(put("high_school", ""), /REQUIRED:title/);
  await assert.rejects(put("middle_school", "  \n"), /REQUIRED:title/);
  assert.deepEqual((await sync.changes(c.owner)).changes, []);
});

test("memoir text limits accept each maximum and reject one character more", () => {
  const data = {
    period: "primary_and_below",
    title: "字".repeat(400),
    approxTime: "字".repeat(80),
    detail: "字".repeat(1_000_000),
  };
  assert.deepEqual(normalize(schema.memoir, data), data);
  for (const field of ["title", "approxTime", "detail"] as const) {
    assert.throws(
      () => normalize(schema.memoir, { ...data, [field]: data[field] + "字" }),
      { message: "TOO_LONG:" + field },
    );
  }
});

test("patching memoir detail preserves the other fields in the v1 change feed", async () => {
  const sync = new SyncService(new MemoryStore(), {});
  const c = client(sync, "owner");
  const entry = await c.create("memoir", {
    period: "high_school", title, approxTime: "高二秋天", detail, order: 1.5,
  });
  const updatedDetail = detail + "\n赛后和同学合照。";
  const receipt = await c.send({
    ...c.command("memoir", entry.id, entry.version, { detail: updatedDetail }),
    action: "patch",
  });

  assert.equal(receipt.outcome, "accepted");
  assert.equal(receipt.entity.version, entry.version + 1);
  assert.deepEqual(receipt.entity.data, { ...entry.data, detail: updatedDetail });
  const changes = await sync.changes(c.owner, "1");
  assert.deepEqual(changes.changes, [{ revision: "2", entity: receipt.entity }]);
});
