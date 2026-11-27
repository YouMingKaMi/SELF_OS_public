import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MemoryStore, SyncService } from "../../kernel/server.ts";
import { composeRules } from "../../../services/api/compose.ts";
import { client } from "../../../tests/support.ts";
import type { AnyEntity, Data } from "../../../packages/contracts/entities.ts";

const takenAt = "2026-11-26T10:00:00.000Z";
const verifiedAt = "2026-11-25T10:00:00.000Z";

function setup() {
  const sync = new SyncService(new MemoryStore(), composeRules());
  const c = client(sync, "storage-owner");
  const createBox = (name: string) => c.create("storageBox", { zone: "宿舍", name });
  const patch = async (record: AnyEntity, data: Data) => {
    const result = await c.send({ ...c.command(record.type, record.id, record.version, data), action: "patch" });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.entity.type, record.type);
    return result.entity;
  };
  return { sync, c, createBox, patch };
}

test("storage creates boxes and items, trims required names and syncs their fields", async () => {
  const { sync, c } = setup();
  const box = await c.create("storageBox", {
    zone: " 宿舍 ", name: " 抽屉\n", icon: "box", location: "书桌左侧", order: 1.5,
  });
  assert.deepEqual(box.data, {
    zone: "宿舍", name: "抽屉", icon: "box", location: "书桌左侧", order: 1.5,
  });
  const item = await c.create("storageItem", {
    name: " 耳机\t", status: "in_box", boxId: box.id, homeBoxId: box.id,
    quantity: 2, aliases: "蓝牙耳机", note: "附充电线", verifiedAt,
  });
  assert.deepEqual(item.data, {
    name: "耳机", status: "in_box", boxId: box.id, homeBoxId: box.id,
    quantity: 2, aliases: "蓝牙耳机", note: "附充电线", verifiedAt,
  });
  assert.deepEqual((await sync.changes(c.owner)).changes, [
    { revision: "1", entity: box },
    { revision: "2", entity: item },
  ]);
});

test("item icons trim built-in keys and composed emoji, and clear through patches", async () => {
  const { sync, c, patch } = setup();
  const item = await c.create("storageItem", { name: "耳机", status: "out", icon: " earphone\t" });
  assert.equal(item.data.icon, "earphone");

  const emoji = await patch(item, { icon: " 🧑‍💻\n" });
  assert.equal(emoji.data.icon, "🧑‍💻");
  const renamed = await patch(emoji, { name: "无线耳机" });
  assert.deepEqual(renamed.data, { name: "无线耳机", status: "out", icon: "🧑‍💻" });

  const cleared = await patch(renamed, { icon: null });
  assert.deepEqual(cleared.data, { name: "无线耳机", status: "out" });
  const reset = await patch(cleared, { icon: "earphone" });
  const blank = await patch(reset, { icon: " \t\n" });
  assert.deepEqual(blank.data, cleared.data);
  const empty = await c.create("storageItem", { name: "充电宝", status: "out", icon: "" });
  assert.deepEqual(empty.data, { name: "充电宝", status: "out" });
  const { changes } = await sync.changes(c.owner);
  assert.deepEqual(changes.find(({ entity }) => entity.id === item.id)?.entity, blank);
});

test("item icons enforce the text length limit on create and patch", async () => {
  const { c, patch } = setup();
  const limit = "a".repeat(40);
  const valid = await c.create("storageItem", { name: "耳机", status: "out", icon: limit });
  assert.equal(valid.data.icon, limit);
  await assert.rejects(c.create("storageItem", {
    name: "耳机", status: "out", icon: limit + "a",
  }), { message: "TOO_LONG:icon" });
  await assert.rejects(patch(valid, { icon: limit + "a" }), { message: "TOO_LONG:icon" });
});

test("in-box items require a current box and both references must be live and owner scoped", async () => {
  const { sync, c, createBox, patch } = setup();
  const box = await createBox("抽屉");
  const foreignBox = await client(sync, "other-owner").create("storageBox", { zone: "家里", name: "柜子" });
  const deletedBox = await createBox("空盒");
  await c.remove(deletedBox);

  await assert.rejects(c.create("storageItem", {
    name: "耳机", status: "in_box", homeBoxId: box.id,
  }), { message: "STORAGE_BOX_REQUIRED" });
  await assert.rejects(c.create("storageItem", {
    name: "耳机", status: "in_box", boxId: foreignBox.id,
  }), { message: "MISSING_REFERENCE:boxId" });
  await assert.rejects(c.create("storageItem", {
    name: "耳机", status: "out", homeBoxId: deletedBox.id,
  }), { message: "MISSING_REFERENCE:homeBoxId" });
  await assert.rejects(c.create("storageItem", {
    name: "耳机", status: "out", boxId: randomUUID(),
  }), { message: "MISSING_REFERENCE:boxId" });

  const item = await c.create("storageItem", { name: "耳机", status: "in_box", boxId: box.id });
  await assert.rejects(patch(item, { boxId: null }), { message: "STORAGE_BOX_REQUIRED" });
});

test("taking out, moving and returning an item preserve other fields and respect explicit timestamps", async () => {
  const { c, createBox, patch } = setup();
  const home = await createBox("抽屉");
  const other = await createBox("背包");
  const item = await c.create("storageItem", {
    name: "耳机", status: "in_box", boxId: home.id, homeBoxId: home.id,
    quantity: 1, aliases: "蓝牙耳机", note: "附充电线", verifiedAt,
  });

  const out = await patch(item, { status: "out", takenAt });
  assert.deepEqual(out.data, { ...item.data, status: "out", takenAt });
  const moved = await patch(out, { boxId: other.id });
  assert.deepEqual(moved.data, { ...out.data, boxId: other.id });
  const returned = await patch(moved, { status: "in_box", boxId: home.id, takenAt: null });
  assert.deepEqual(returned.data, item.data);
  const explicit = await patch(returned, { takenAt: "2026-11-26T18:00:00+08:00" });
  assert.deepEqual(explicit.data, { ...item.data, takenAt });
});

test("box deletion blocks either live reference and succeeds after clearing references", async () => {
  const { sync, c, createBox, patch } = setup();
  const current = await createBox("背包");
  const home = await createBox("抽屉");
  const item = await c.create("storageItem", {
    name: "耳机", status: "out", boxId: current.id, homeBoxId: home.id, takenAt,
  });
  const before = (await sync.changes(c.owner)).nextCursor;
  await assert.rejects(c.remove(current), { message: "STORAGE_BOX_NOT_EMPTY" });
  await assert.rejects(c.remove(home), { message: "STORAGE_BOX_NOT_EMPTY" });
  assert.deepEqual((await sync.changes(c.owner, before)).changes, []);

  const cleared = await patch(item, { boxId: null, homeBoxId: null });
  assert.deepEqual(cleared.data, { name: "耳机", status: "out", takenAt });
  assert.equal((await c.remove(current)).deleted, true);
  assert.equal((await c.remove(home)).deleted, true);
});

test("deleted items do not block box deletion", async () => {
  const { c, createBox } = setup();
  const box = await createBox("抽屉");
  const item = await c.create("storageItem", {
    name: "耳机", status: "in_box", boxId: box.id, homeBoxId: box.id,
  });

  assert.equal((await c.remove(item)).deleted, true);
  assert.equal((await c.remove(box)).deleted, true);
});

test("subboxes accept items and patches preserve, replace or clear their parent", async () => {
  const { sync, c, createBox, patch } = setup();
  const parent = await createBox("背包");
  const otherParent = await createBox("行李箱");
  const child = await c.create("storageBox", { zone: "宿舍", name: " 前袋 ", parentId: parent.id });
  const item = await c.create("storageItem", {
    name: "耳机", status: "in_box", boxId: child.id, homeBoxId: child.id,
  });
  assert.deepEqual(child.data, { zone: "宿舍", name: "前袋", parentId: parent.id });
  assert.equal(item.data.boxId, child.id);
  assert.equal(item.data.homeBoxId, child.id);
  const { changes } = await sync.changes(c.owner);
  assert.deepEqual(changes.find(({ entity }) => entity.id === child.id)?.entity, child);

  const renamed = await patch(child, { name: "小袋" });
  assert.equal(renamed.data.parentId, parent.id);
  const moved = await patch(renamed, { parentId: otherParent.id });
  assert.equal(moved.data.parentId, otherParent.id);
  const detached = await patch(moved, { parentId: null });
  assert.deepEqual(detached.data, { zone: "宿舍", name: "小袋" });
});

test("subbox parent changes reject self and multi-level cycles without writing changes", async () => {
  const { sync, c, createBox, patch } = setup();
  const root = await createBox("书架");
  const child = await c.create("storageBox", { zone: "宿舍", name: "上层", parentId: root.id });
  const leaf = await c.create("storageBox", { zone: "宿舍", name: "收纳盒", parentId: child.id });
  const before = (await sync.changes(c.owner)).nextCursor;

  await assert.rejects(patch(root, { parentId: root.id }), { message: "STORAGE_BOX_CYCLE" });
  await assert.rejects(patch(root, { parentId: leaf.id }), { message: "STORAGE_BOX_CYCLE" });
  assert.deepEqual((await sync.changes(c.owner, before)).changes, []);
});

test("subbox parents must be live and owner scoped on creation and restore", async () => {
  const { sync, c, createBox } = setup();
  const parent = await createBox("书架");
  const child = await c.create("storageBox", { zone: "宿舍", name: "上层", parentId: parent.id });
  const foreign = await client(sync, "other-owner").create("storageBox", { zone: "家里", name: "衣柜" });
  const tombstone = await c.remove(child);

  await assert.rejects(c.send(c.command("storageBox", child.id, tombstone.version, {
    ...child.data, parentId: child.id,
  })), { message: "STORAGE_BOX_CYCLE" });
  const restored = await c.update<"storageBox">(tombstone, {});
  assert.equal(restored.deleted, false);
  assert.equal(restored.data.parentId, parent.id);

  const deletedChild = await c.remove(restored);
  await c.remove(parent);
  for (const parentId of [randomUUID(), parent.id, foreign.id]) {
    await assert.rejects(c.create("storageBox", { zone: "宿舍", name: "抽屉", parentId }), {
      message: "MISSING_REFERENCE:parentId",
    });
  }
  await assert.rejects(c.send(c.command("storageBox", child.id, deletedChild.version, child.data)), {
    message: "MISSING_REFERENCE:parentId",
  });
});

test("box deletion blocks live subboxes and succeeds when they are deleted", async () => {
  const { c, createBox } = setup();
  const parent = await createBox("背包");
  const child = await c.create("storageBox", { zone: "宿舍", name: "前袋", parentId: parent.id });
  const item = await c.create("storageItem", { name: "耳机", status: "in_box", boxId: child.id });

  await assert.rejects(c.remove(parent), { message: "STORAGE_BOX_NOT_EMPTY" });
  await assert.rejects(c.remove(child), { message: "STORAGE_BOX_NOT_EMPTY" });
  await c.remove(item);
  assert.equal((await c.remove(child)).deleted, true);
  assert.equal((await c.remove(parent)).deleted, true);
});
