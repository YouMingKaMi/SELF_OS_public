import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryStore, SyncService } from "../server.ts";
import { client } from "../../../tests/support.ts";

// Protocol behaviour without any business rules; database guarantees are in tests/integration.
const service = () => new SyncService(new MemoryStore(), {});

test("a retried operation replays its receipt; the same id with another payload is refused", async () => {
  const sync = service(),
    c = client(sync, "owner");
  const command = c.command("idea", randomUUID(), 0, {
    body: "想法",
    day: "2026-11-07",
    status: "pending",
  });
  const first = await c.send(command);
  assert.deepEqual(await c.send(command), first);
  await assert.rejects(
    c.send({ ...command, data: { ...command.data, body: "改了" } }),
    /OPERATION_REUSED/,
  );
  assert.equal((await sync.changes("owner")).changes.length, 1);
});
test("a stale base version is a conflict carrying the server copy, never an overwrite", async () => {
  const sync = service(),
    c = client(sync, "owner");
  const idea = await c.create("idea", {
    body: "a",
    day: "2026-11-07",
    status: "pending",
  });
  await c.update(idea, { body: "b" });
  const stale = c.command("idea", idea.id, 1, {
    ...idea.data,
    body: "offline",
  });
  const receipt = await c.send(stale);
  assert.equal(receipt.outcome, "conflict");
  assert.equal(
    receipt.outcome === "conflict" && receipt.current?.data.body,
    "b",
  );
  assert.deepEqual(await c.send(stale), receipt);
});
test("delete leaves a versioned tombstone that can be restored", async () => {
  const sync = service(),
    c = client(sync, "owner");
  const idea = await c.create("idea", {
    body: "a",
    day: "2026-11-07",
    status: "pending",
  });
  const gone = await c.remove(idea);
  assert.deepEqual(
    [gone.deleted, gone.version, gone.data.body],
    [true, 2, "a"],
  );
  assert.equal((await c.update(gone, {})).deleted, false);
  await assert.rejects(c.send(c.command("idea", randomUUID(), 0)), /NOT_FOUND/);
});
test("the change feed lists each entity once at its latest state, pages by cursor, and is per owner", async () => {
  const sync = service(),
    c = client(sync, "owner");
  let first = await c.create("idea", {
    body: "1",
    day: "2026-11-07",
    status: "pending",
  });
  const second = await c.create("idea", {
    body: "2",
    day: "2026-11-07",
    status: "pending",
  });
  first = await c.update(first, { body: "1b" });
  const page = await sync.changes("owner", "0", 1);
  assert.deepEqual(
    [page.changes[0].entity.id, page.hasMore, page.nextCursor],
    [second.id, true, "2"],
  );
  const rest = await sync.changes("owner", page.nextCursor, 1);
  assert.deepEqual(
    [rest.changes[0].entity.data.body, rest.hasMore, rest.nextCursor],
    ["1b", false, "3"],
  );
  assert.deepEqual(await sync.changes("owner", rest.nextCursor), {
    changes: [],
    nextCursor: "3",
    hasMore: false,
  });
  assert.equal((await sync.changes("someone-else")).changes.length, 0);
});
test("references must point at a live record of the same owner", async () => {
  const sync = service(),
    mine = client(sync, "owner"),
    theirs = client(sync, "other");
  const domain = await mine.create("domain", { name: "AI" });
  await assert.rejects(
    theirs.create("activity", { domainId: domain.id, name: "x" }),
    /MISSING_REFERENCE:domainId/,
  );
  await mine.remove(domain);
  await assert.rejects(
    mine.create("activity", { domainId: domain.id, name: "x" }),
    /MISSING_REFERENCE:domainId/,
  );
});
test("a rejected write changes nothing", async () => {
  const sync = service(),
    c = client(sync, "owner");
  await assert.rejects(
    c.create("idea", { body: "", day: "2026-11-07", status: "pending" }),
    /REQUIRED:body/,
  );
  await assert.rejects(
    c.send({
      ...c.command("idea", randomUUID(), 0, {}),
      entityType: "nope" as never,
    }),
    /INVALID_ENTITY/,
  );
  assert.equal((await sync.changes("owner")).changes.length, 0);
});
