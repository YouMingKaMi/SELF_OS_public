import { schema } from "../../../../packages/contracts/entities.ts";
import { recoveryPageSize, type RecoveryMatch, type RecoveryResponse } from "../../../../packages/contracts/recovery.ts";
import type {
  Snapshot,
  SnapshotPage,
  SyncScope,
  SyncState,
} from "../../../../packages/contracts/snapshot.ts";
import { database, project, type Pending } from "./db.ts";
import { replaceConfirmed } from "./store.ts";
import { recoveryProbes, settledOperations } from "./recovery-matches.ts";

type Request = (path: string, device: string, body?: unknown) => Promise<Response>;
const scopeErrors = new Set([
  "DATASET_MISMATCH",
  "GENERATION_MISMATCH",
  "CURSOR_AHEAD",
  "SYNC_UPGRADE_REQUIRED",
]);

export const recoveryReview = "服务器已从备份恢复，请核对恢复前的本机修改";
export class ScopeChanged extends Error {}
export class UpgradeRequired extends Error {}
export function requireKnownType(type: string) {
  if (!Object.hasOwn(schema, type)) throw new UpgradeRequired();
}
export function checkSyncScope(status: number, code: unknown) {
  if (status === 409 && typeof code === "string" && scopeErrors.has(code))
    throw new ScopeChanged();
}
function sameScope(left: SyncScope, right: SyncScope) {
  return left.datasetId === right.datasetId && left.generation === right.generation;
}
function validPosition(value: string) {
  return /^[0-9]{1,18}$/.test(value);
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  checkSyncScope(response.status, body.error);
  if (!response.ok) throw new Error("同步状态暂不可用");
  return body as T;
}

/** Negotiate scope before sending any outbox writes; older servers may omit this route. */
export async function prepareSync(request: Request, device: string): Promise<SyncScope | undefined> {
  const db = await database;
  const localScope = await db.get("meta", "scope");
  const response = await request("/v1/sync-state", device);
  if (response.status === 404 && !localScope) return undefined;
  const state = await read<SyncState>(response);
  const scope = { datasetId: state.datasetId, generation: state.generation };
  if (typeof scope.datasetId !== "string" || typeof scope.generation !== "string" ||
      !validPosition(state.watermark)) throw new Error("同步状态格式无效");
  const cursor = await db.get("meta", "cursor");
  const watermark = BigInt(state.watermark);
  const known: SyncScope | undefined = localScope ? JSON.parse(localScope) : undefined;
  const reviewPending = BigInt(cursor ?? "0") > watermark ||
    (known ? !sameScope(known, scope) : state.scopeRequired === true);
  const bootstrap = !localScope && cursor === undefined && watermark > 200n &&
    (await db.count("confirmed")) === 0;
  if (reviewPending || bootstrap) {
    await restore(request, device, scope, reviewPending, known);
  } else if (!localScope) {
    await db.put("meta", JSON.stringify(scope), "scope");
  }
  return scope;
}

/** A page is staged on disk. Failed or expired downloads leave the visible database as it was. */
async function restore(
  request: Request, device: string, scope: SyncScope, reviewPending: boolean, known?: SyncScope,
) {
  const db = await database;
  const snapshot = await read<Snapshot>(await request("/v1/snapshots", device, scope));
  if (!sameScope(scope, snapshot) || !validPosition(snapshot.watermark) ||
      !Number.isSafeInteger(snapshot.total) || snapshot.total < 0)
    throw new Error("恢复快照格式无效");

  await db.clear("snapshot");
  let position = "0";
  let total = 0;
  for (;;) {
    const page = await read<SnapshotPage>(await request(
      `/v1/snapshots/${encodeURIComponent(snapshot.snapshotId)}?after=${position}&limit=200`,
      device,
    ));
    total += page.records.length;
    if (!sameScope(scope, page) || page.snapshotId !== snapshot.snapshotId ||
        page.watermark !== snapshot.watermark || page.total !== snapshot.total ||
        total > snapshot.total || (page.nextPosition !== null && (
          page.records.length === 0 || page.nextPosition !== String(total))))
      throw new Error("恢复快照内容不完整");
    const write = db.transaction("snapshot", "readwrite");
    for (const record of page.records) {
      requireKnownType(record.type);
      await write.store.put(record);
    }
    await write.done;
    if (page.nextPosition === null) break;
    position = page.nextPosition;
  }
  if (total !== snapshot.total) throw new Error("恢复快照内容不完整");

  const matches = new Map<string, RecoveryMatch>();
  if (reviewPending && (!known || known.datasetId === scope.datasetId)) {
    const probes = recoveryProbes(await db.getAll("pending"), known);
    for (let i = 0; i < probes.length; i += recoveryPageSize) {
      try {
        const response = await request("/v1/recovery-matches", device, {
          scope, watermark: snapshot.watermark, probes: probes.slice(i, i + recoveryPageSize),
        });
        if (response.status === 413) continue;
        for (const match of (await read<RecoveryResponse>(response)).matches)
          matches.set(match.operationId, match);
      } catch (error) {
        if (error instanceof ScopeChanged) throw error;
        break; // Older APIs and transient failures leave unproved drafts for review.
      }
    }
  }
  const latest = await read<SyncState>(await request("/v1/sync-state", device));
  if (!sameScope(scope, latest)) throw new ScopeChanged();

  // Preserve full local drafts before swapping the confirmed dataset, atomically with its cursor.
  const replace = db.transaction(["confirmed", "snapshot", "pending", "meta"], "readwrite");
  const pending = replace.objectStore("pending");
  const confirmed = replace.objectStore("confirmed");
  const stage = replace.objectStore("snapshot");
  if (await stage.count() !== total) throw new Error("恢复快照包含重复记录");
  const oldOperations = reviewPending ? await pending.getAll() : [];
  const settled = matches.size ? await settledOperations(oldOperations, matches, (id) => stage.get(id)) : new Set<string>();
  const byEntity = new Map<string, Pending[]>();
  for (const op of oldOperations) {
    const list = byEntity.get(op.entityId) ?? [];
    list.push(op);
    byEntity.set(op.entityId, list);
  }
  for (const [id, ops] of byEntity) {
    ops.sort((a, b) => a.sequence - b.sequence);
    if (ops.some((op) => op.recoveryDraft)) continue;
    let previous = await confirmed.get(id);
    const remaining = ops.filter((op) => !settled.has(op.operationId));
    const first = remaining[0];
    for (const op of ops) {
      const recoveryDraft = project(previous, [op]);
      previous = recoveryDraft;
      if (settled.has(op.operationId)) {
        await pending.delete(op.operationId);
        continue;
      }
      await pending.put({
        ...op,
        state: "error",
        error: recoveryReview,
        server: undefined,
        recoveryDraft: op.batchId || op === first ? recoveryDraft : undefined,
      });
    }
    if (first && !remaining.some((op) => op.batchId) && previous)
      await pending.put({
        ...first, state: "error", error: recoveryReview, server: undefined,
        recoveryDraft: previous,
      });
  }
  await confirmed.clear();
  for (let row = await stage.openCursor(); row; row = await row.continue())
    await confirmed.put(row.value);
  await stage.clear();
  await replace.objectStore("meta").put(snapshot.watermark, "cursor");
  await replace.objectStore("meta").put(JSON.stringify(scope), "scope");
  await replace.done;
  await replaceConfirmed();
}
