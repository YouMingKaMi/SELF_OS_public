import type { IDBPObjectStore, IDBPTransaction } from "idb";
import {
  maxBatchCommands, type BatchReceipt, type CommandBatch,
} from "../../../../packages/contracts/command-batch.ts";
import type { AnyEntity, Command, Data, EntityType } from "../../../../packages/contracts/entities.ts";
import type { SyncScope } from "../../../../packages/contracts/snapshot.ts";
import { applyPatch, hasFieldConflict, legacyPut } from "../../../../packages/contracts/edit.ts";
import { database, project, type Local, type Pending } from "./db.ts";
import { apply, type Change } from "./store.ts";
import { isLocalMode } from "./local-mode.ts";

export type LocalWrite = {
  type: EntityType;
  id: string;
  action: Command["action"];
  data?: Data;
  editBase?: Data;
  /** Compare the whole record when an existing editor supplied a version. */
  baseVersion?: number;
};

type WriteTransaction = IDBPTransaction<Local, ["confirmed", "pending", "meta"], "readwrite">;
const inOrder = (a: Pending, b: Pending) => a.sequence - b.sequence;
const stuck = (op: Pending) => op.state === "error" || op.state === "conflict";

async function append(tx: WriteTransaction, writes: LocalWrite[]) {
  const pending = tx.objectStore("pending");
  const confirmed = tx.objectStore("confirmed");
  const meta = tx.objectStore("meta");
  let sequence = Number((await meta.get("sequence")) ?? 0);
  const batchId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  const commands: Pending[] = [];
  for (const write of writes) {
    const earlier = (await pending.index("entityId").getAll(write.id)).sort(inOrder);
    if (earlier.some(stuck)) throw new Error("请先处理相关记录的同步异常");
    const current = project(await confirmed.get(write.id), earlier);
    const baseVersion = current?.version ?? 0;
    if (write.baseVersion !== undefined && write.baseVersion !== baseVersion)
      throw new Error("这条记录已更新，请重新打开后编辑");
    if (write.action === "patch" && (!current || current.deleted || current.type !== write.type ||
        (write.editBase && hasFieldConflict(write.editBase, current.data, write.data ?? {}))))
      throw new Error("这条记录已经变更，请重新打开后编辑");
    commands.push({
      operationId: commands.length ? crypto.randomUUID() : batchId,
      entityType: write.type,
      entityId: write.id,
      action: write.action,
      data: write.data,
      baseVersion,
      occurredAt,
      batchId,
      sequence: ++sequence,
      state: "queued",
    });
  }
  for (const command of commands) await pending.put(command);
  await meta.put(String(sequence), "sequence");
  return commands;
}

/** Commit device-only writes without an outbox or server cursor. */
export async function commitLocalWrites(writes: LocalWrite[]): Promise<void> {
  const db = await database;
  const tx = db.transaction("confirmed", "readwrite");
  const updated: AnyEntity[] = [];
  const updatedAt = new Date().toISOString();
  try {
    for (const write of writes) {
      const current = await tx.store.get(write.id);
      const version = current?.version ?? 0;
      if (write.baseVersion !== undefined && write.baseVersion !== version)
        throw new Error("这条记录已更新，请重新打开后编辑");
      if (write.action === "patch" && (!current || current.deleted || current.type !== write.type ||
          (write.editBase && hasFieldConflict(write.editBase, current.data, write.data ?? {})))) {
        if (writes.length > 1) throw new Error("这条记录已经变更，请重新打开后编辑");
        throw new Error(!current || current.deleted
          ? "这条记录已被移除，草稿仍保留。"
          : "另一台设备已修改相同字段，草稿仍保留。请先对照当前版本。");
      }
      if (current && current.type !== write.type)
        throw new Error("这条记录的类型与原记录不一致");
      const data = write.action === "patch"
        ? applyPatch(current?.data ?? {}, write.data ?? {})
        : write.action === "put" && write.data
          ? legacyPut(write.type, current?.data, write.data)
          : current?.data ?? {};
      const next = {
        id: write.id, type: write.type, version: version + 1,
        data, deleted: write.action === "delete", updatedAt,
      };
      await tx.store.put(next);
      updated.push(next);
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* IndexedDB may have aborted the transaction itself. */ }
    await tx.done.catch(() => {});
    throw error;
  }
  apply({ confirmed: updated });
}

export async function queueBatch(writes: LocalWrite[]) {
  if (writes.length < 2 || writes.length > maxBatchCommands ||
      new Set(writes.map((write) => write.id.toLowerCase())).size !== writes.length)
    throw new Error("这次修改包含重复记录或记录数超限");
  if (isLocalMode()) return commitLocalWrites(writes);
  const db = await database;
  const tx = db.transaction(["confirmed", "pending", "meta"], "readwrite");
  try {
    const entries = await append(tx, writes);
    await tx.done;
    apply({ pendingDelta: { entries } });
  } catch (error) {
    try { tx.abort(); } catch { /* IndexedDB may have aborted the transaction itself. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}

/** A blocked member holds its other batch members and their later dependent writes. */
export async function claimWrite(pending: IDBPObjectStore<Local, ["pending"], "pending", "readwrite">) {
  const blocked = new Set<string>();
  const seen = new Set<string>();
  let remaining = false;
  for (let cursor = await pending.index("sequence").openCursor(); cursor; cursor = await cursor.continue()) {
    remaining = true;
    const op = cursor.value;
    if (!op.batchId) {
      if (stuck(op)) blocked.add(op.entityId);
      else if (!blocked.has(op.entityId)) return { group: [op], remaining };
      continue;
    }
    if (seen.has(op.batchId)) continue;
    seen.add(op.batchId);
    const group = (await pending.index("batchId").getAll(op.batchId)).sort(inOrder);
    if (group.length >= 2 && !group.some((member) => stuck(member) || blocked.has(member.entityId))) return { group, remaining };
    for (const member of group) blocked.add(member.entityId);
  }
  return { group: [], remaining };
}

export function makeBatch(members: Pending[], scope?: SyncScope): CommandBatch {
  return {
    operationId: members[0].batchId!,
    scope,
    commands: members.map(({ entityId, entityType, baseVersion, action, data, occurredAt }) =>
      ({ entityId, entityType, baseVersion, action, data, occurredAt })),
  };
}

export async function saveBatchResult(members: Pending[], receipt: BatchReceipt | { error: string }) {
  if ("outcome" in receipt) {
    const complete = receipt.outcome === "accepted"
      ? receipt.effects.length === members.length && members.every((member, index) =>
        receipt.effects[index]?.entity.id === member.entityId && receipt.effects[index]?.entity.type === member.entityType)
      : members.some((member) => member.entityId === receipt.entityId);
    if (!complete) throw new Error("INVALID_BATCH_RECEIPT");
  }
  const db = await database;
  const tx = db.transaction(["confirmed", "pending"], "readwrite");
  const confirmed = tx.objectStore("confirmed");
  const pending = tx.objectStore("pending");
  const change: Change = { confirmed: [] };
  const entries: Pending[] = [];
  const removed: string[] = [];
  for (const [index, member] of members.entries()) {
    if ("error" in receipt) {
      entries.push({ ...member, state: "error", error: receipt.error });
    } else if (receipt.outcome === "conflict") {
      entries.push(receipt.entityId === member.entityId
        ? { ...member, state: "conflict", server: receipt.current }
        : { ...member, state: "error", error: "同批修改包含冲突" });
    } else {
      const entity = receipt.effects[index].entity;
      const prior = await confirmed.get(entity.id);
      if (!prior || prior.version <= entity.version) {
        await confirmed.put(entity);
        change.confirmed!.push(entity);
      }
      await pending.delete(member.operationId);
      removed.push(member.operationId);
    }
  }
  for (const entry of entries) await pending.put(entry);
  change.pendingDelta = { entries, removed };
  await tx.done;
  apply(change);
}

/** A review decision adopts or retries the original local edits as a unit. */
export async function settleBatch(batchId: string, keepLocal: boolean): Promise<void> {
  const db = await database;
  const tx = db.transaction(["confirmed", "pending", "meta"], "readwrite");
  const confirmed = tx.objectStore("confirmed");
  const pending = tx.objectStore("pending");
  try {
    const members = (await pending.index("batchId").getAll(batchId)).sort(inOrder);
    if (!members.length || !members.some(stuck)) {
      await tx.done;
      return;
    }
    // A transfer's source subtraction was computed against the original body.
    if (keepLocal && members.length === 2 &&
        members.some((member) => member.entityType === "idea") &&
        members.some((member) => member.entityType === "journal"))
      throw new Error("TRANSFER_REQUIRES_RESELECTION");
    const change: Change = { confirmed: [], dropped: [] };
    for (const member of members) {
      if (member.state === "conflict") {
        const prior = await confirmed.get(member.entityId);
        if (member.server && (!prior || prior.version <= member.server.version)) {
          await confirmed.put(member.server);
          change.confirmed!.push(member.server);
        } else if (!member.server && (!prior || prior.version <= member.baseVersion)) {
          await confirmed.delete(member.entityId);
          change.dropped!.push({ type: member.entityType, id: member.entityId });
        }
      }
      await pending.delete(member.operationId);
    }
    if (keepLocal) {
      for (const member of members) {
        const related = await pending.index("entityId").getAll(member.entityId);
        if (related.some((op) => op.sequence > member.sequence))
          throw new Error("这批修改之后还有其他编辑。请保留服务器版本，再核对后续草稿");
      }
      await append(tx, members.map((member) => ({
        type: member.entityType, id: member.entityId,
        action: member.action, data: member.data,
      })));
    }
    change.pending = await pending.getAll();
    await tx.done;
    apply(change);
  } catch (error) {
    try { tx.abort(); } catch { /* IndexedDB may have aborted the transaction itself. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}
