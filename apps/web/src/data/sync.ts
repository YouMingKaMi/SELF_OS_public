/** Outbox + pull loop of the one sync protocol. One runner per browser (Web Locks), any number of tabs. */
import type {
  AnyEntity,
  Changes,
  Command,
  Data,
  EntityType,
  Receipt,
} from "../../../../packages/contracts/entities.ts";
import { hasFieldConflict } from "../../../../packages/contracts/edit.ts";
import type { BatchReceipt } from "../../../../packages/contracts/command-batch.ts";
import type { SyncScope } from "../../../../packages/contracts/snapshot.ts";
import { claimWrite, makeBatch, queueBatch, saveBatchResult, settleBatch, type LocalWrite } from "./command-batch.ts";
import { database, project, type Pending } from "./db.ts";
import { checkSyncScope, prepareSync, requireKnownType, ScopeChanged, UpgradeRequired } from "./recovery.ts";
import { apply, emit, ready, type Change } from "./store.ts";
import { planJournalTransfer, type TextSelection } from "./journal-transfer.ts";

export type SyncState =
  | "connecting"
  | "synced"
  | "offline"
  | "unauthorized"
  | "unreachable"
  | "upgrade"
  | "attention";
export type SyncStatus = { state: SyncState; message: string };
const messages: Record<SyncState, string> = {
  connecting: "正在同步",
  synced: "已同步",
  offline: "离线 · 已保存到本机",
  unauthorized: "需要重新授权 · 已保存到本机",
  unreachable: "服务器连接暂不可用",
  upgrade: "请更新 SELF OS 后继续同步 · 本机修改已保留",
  attention: "有记录需要处理",
};
let status: SyncStatus = { state: "connecting", message: "正在连接" };
export const statusSnapshot = () => status;
function setStatus(state: SyncState) {
  if (status.state === state && status.message === messages[state]) return;
  status = { state, message: messages[state] };
  emit(["status"]);
}

const stuck = (op: Pending) => op.state === "conflict" || op.state === "error";
const inOrder = (a: Pending, b: Pending) => a.sequence - b.sequence;
class Unauthorized extends Error {}
class Unreachable extends Error {}

/** Record a local write. Durable before it returns; the network is never awaited. */
export async function enqueue(
  type: EntityType,
  id: string,
  action: Command["action"],
  data?: Data,
  editBase?: Data,
) {
  const db = await database;
  const tx = db.transaction(["confirmed", "pending", "meta"], "readwrite");
  const earlier = (
    await tx.objectStore("pending").index("entityId").getAll(id)
  ).sort(inOrder);
  if (earlier.some(stuck)) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error("请先在设置中处理这条同步异常");
  }
  const current = project(await tx.objectStore("confirmed").get(id), earlier);
  if (action === "patch" && (!current || current.type !== type || current.deleted ||
    (editBase && hasFieldConflict(editBase, current.data, data ?? {})))) {
    await tx.done;
    throw new Error(!current || current.deleted
      ? "这条记录已被移除，草稿仍保留。"
      : "另一台设备已修改相同字段，草稿仍保留。请先对照当前版本。");
  }
  const sequence =
    Number((await tx.objectStore("meta").get("sequence")) ?? 0) + 1;
  await tx.objectStore("meta").put(String(sequence), "sequence");
  const operation: Pending = {
    operationId: crypto.randomUUID(),
    entityId: id,
    entityType: type,
    baseVersion: current?.version ?? 0,
    action,
    data,
    occurredAt: new Date().toISOString(),
    sequence,
    state: "queued",
  };
  await tx.objectStore("pending").put(operation);
  await tx.done;
  apply({ pendingDelta: { entries: [operation] } });
  void synchronize();
  return id;
}

/** Queue all edits before publishing the optimistic view or scheduling sync. */
export async function enqueueTogether(writes: LocalWrite[]) {
  await queueBatch(writes);
  void synchronize();
}

export async function transferJournalText(source: AnyEntity, selection?: TextSelection): Promise<string> {
  const id = crypto.randomUUID();
  await enqueueTogether(planJournalTransfer(source, id, selection));
  return id;
}

/** Withdraw the newest local edit of an entity, only while it has not been sent. */
export async function undoPending(id: string) {
  const db = await database;
  const tx = db.transaction("pending", "readwrite");
  const last = (await tx.store.index("entityId").getAll(id))
    .sort(inOrder)
    .at(-1);
  const removed: string[] = [];
  if (last?.state === "queued") {
    const group = last.batchId ? await tx.store.index("batchId").getAll(last.batchId) : [last];
    for (const member of group) {
      const related = await tx.store.index("entityId").getAll(member.entityId);
      if (member.state !== "queued" || related.some((op) => op.sequence > member.sequence)) {
        await tx.done;
        throw new Error("这批修改之后还有其他编辑，暂时无法撤销");
      }
    }
    for (const member of group) {
      await tx.store.delete(member.operationId);
      removed.push(member.operationId);
    }
  }
  await tx.done;
  if (removed.length) apply({ pendingDelta: { removed } });
}

/** Resolve a conflict or rejected write: adopt the server copy, optionally re-apply the local one on top. */
export async function settle(id: string, keepLocal: boolean) {
  const db = await database;
  const tx = db.transaction(["confirmed", "pending", "meta"], "readwrite");
  const operations = (
    await tx.objectStore("pending").index("entityId").getAll(id)
  ).sort(inOrder);
  const failure = operations.find(stuck);
  if (!failure) {
    await tx.done;
    return;
  }
  if (failure.batchId) {
    await tx.done;
    await settleBatch(failure.batchId, keepLocal);
    void synchronize();
    return;
  }
  // Leave newer groups intact. They may need their own review after this decision.
  const nextBatch = operations.find((op) => !!op.batchId);
  const standalone = nextBatch ? operations.filter((op) => op.sequence < nextBatch.sequence) : operations;
  const confirmed = await tx.objectStore("confirmed").get(id);
  const draft = failure.recoveryDraft;
  const local = draft ?? project(confirmed, standalone);
  const change: Change = {};
  if (failure.state === "conflict") {
    if (failure.server) {
      await tx.objectStore("confirmed").put(failure.server);
      change.confirmed = [failure.server];
    } else {
      await tx.objectStore("confirmed").delete(id);
      change.dropped = [{ type: failure.entityType, id }];
    }
  }
  for (const op of standalone)
    await tx.objectStore("pending").delete(op.operationId);
  // Recovery review replaces the quarantined outbox entry with a newly authorized write.
  // Keep this atomic so a browser exit cannot lose the draft between deleting and re-enqueuing it.
  if (keepLocal && draft && (!draft.deleted || (confirmed && !confirmed.deleted))) {
    await tx.objectStore("pending").put({
      operationId: crypto.randomUUID(),
      entityId: id,
      entityType: draft.type,
      baseVersion: confirmed?.version ?? 0,
      action: draft.deleted ? "delete" : "put",
      data: draft.deleted ? undefined : draft.data,
      occurredAt: new Date().toISOString(),
      sequence: failure.sequence,
      state: "queued",
    });
  }
  change.pending = await tx.objectStore("pending").getAll();
  await tx.done;
  apply(change);
  if (draft) {
    if (keepLocal) void synchronize();
    return;
  }
  if (keepLocal && local)
    await enqueue(local.type, id, local.deleted ? "delete" : "put", local.data);
}

async function request(path: string, device: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      // The custom header marks a same-site request from this page (CSRF guard for the session cookie).
      headers: body
        ? {
            "content-type": "application/json",
            "x-device-id": device,
            "x-council-request": "1",
          }
        : { "x-council-request": "1" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Unreachable();
  }
  if (response.status === 401 || response.status === 403)
    throw new Unauthorized();
  return response;
}

/** Send the outbox in order. Returns whether anything is left waiting for the user. */
async function push(device: string, scope?: SyncScope) {
  const db = await database;
  for (;;) {
    const tx = db.transaction("pending", "readwrite");
    const { group, remaining } = await claimWrite(tx.store);
    if (!group.length) {
      await tx.done;
      return remaining;
    }
    const next = group[0];
    for (const op of group) await tx.store.put({ ...op, state: "sending" });
    await tx.done;
    if (next.batchId) {
      const response = await request("/v1/command-batches", device, makeBatch(group, scope));
      if (!response.ok && ![400, 409].includes(response.status)) throw new Unreachable();
      const body = await response.json();
      checkSyncScope(response.status, body.error);
      await saveBatchResult(group, response.ok ? body as BatchReceipt : {
        error: body.error ?? "无法保存这批修改",
      });
      continue;
    }
    const {
      sequence: _sequence,
      state: _state,
      server: _server,
      error: _error,
      recoveryDraft: _draft,
      batchId: _batch,
      ...command
    } = next;
    const response = await request("/v1/commands", device, { ...command, scope });
    if (!response.ok && response.status !== 400 && response.status !== 409)
      throw new Unreachable();
    const body = await response.json().catch(() => ({}));
    checkSyncScope(response.status, body.error);
    const save = db.transaction(["confirmed", "pending"], "readwrite");
    const change: Change = {};
    const outbox = save.objectStore("pending");
    if (!response.ok) {
      // The server understood and refused: keep the edit, show it, never retry it blindly.
      const failed: Pending = { ...next, state: "error", error: body.error };
      await outbox.put(failed);
      change.pendingDelta = { entries: [failed] };
    } else {
      const receipt = body as Receipt;
      if (receipt.outcome === "accepted") {
        const current = await save.objectStore("confirmed").get(next.entityId);
        if (!current || current.version <= receipt.entity.version) {
          await save.objectStore("confirmed").put(receipt.entity);
          change.confirmed = [receipt.entity];
        }
        await outbox.delete(next.operationId);
        change.pendingDelta = { removed: [next.operationId] };
      } else {
        const conflicted: Pending = { ...next, state: "conflict", server: receipt.current };
        await outbox.put(conflicted);
        change.pendingDelta = { entries: [conflicted] };
      }
    }
    await save.done;
    apply(change);
  }
}

async function pull(device: string, scope?: SyncScope) {
  const scopeQuery = scope ? "&" + new URLSearchParams(scope).toString() : "";
  const db = await database;
  for (;;) {
    const cursor = (await db.get("meta", "cursor")) ?? "0";
    const response = await request(
      `/v1/changes?cursor=${cursor}&limit=200${scopeQuery}`,
      device,
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      checkSyncScope(response.status, body.error);
      throw new Unreachable();
    }
    const result: Changes = await response.json();
    for (const { entity } of result.changes) requireKnownType(entity.type);
    // Applying the page and advancing the cursor are one transaction: a crash never skips a page.
    const tx = db.transaction(["confirmed", "meta"], "readwrite");
    const confirmed: AnyEntity[] = [];
    for (const { entity } of result.changes) {
      const current = await tx.objectStore("confirmed").get(entity.id);
      if (!current || current.version <= entity.version) {
        await tx.objectStore("confirmed").put(entity);
        confirmed.push(entity);
      }
    }
    await tx.objectStore("meta").put(result.nextCursor, "cursor");
    await tx.done;
    if (confirmed.length) apply({ confirmed });
    if (!result.hasMore) return;
  }
}

let running: Promise<void> | undefined;
let again = false;
export function synchronize(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const run = navigator.locks
    .request("council-next-v2-sync", async () => {
      await ready;
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      if (status.state !== "synced") setStatus("connecting");
      try {
        const db = await database;
        let device = await db.get("meta", "device");
        if (!device) {
          device = crypto.randomUUID();
          await db.put("meta", device, "device");
        }
        // A restore can begin after preflight. Refetch scope once and restart safely.
        for (let attempt = 0; ; attempt++) {
          try {
            const scope = await prepareSync(request, device);
            const blocked = await push(device, scope);
            await pull(device, scope);
            setStatus(blocked ? "attention" : "synced");
            break;
          } catch (error) {
            if (!(error instanceof ScopeChanged) || attempt > 0) throw error;
          }
        }
      } catch (error) {
        setStatus(
          error instanceof UpgradeRequired
            ? "upgrade"
            : error instanceof Unauthorized
            ? "unauthorized"
            : navigator.onLine
              ? "unreachable"
              : "offline",
        );
      }
    })
    .then(() => undefined)
    .finally(() => {
      running = undefined;
      if (again) {
        again = false;
        void synchronize();
      }
    });
  running = run;
  return run;
}

/** Exchange a one-time pairing code for this browser's session. The credential stays in an HttpOnly cookie. */
export async function pairDevice(code: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch("/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json", "x-council-request": "1" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return "连不上服务器，请检查网络";
  }
  if (response.status === 429) return "尝试太频繁，请稍后再试";
  if (!response.ok) return "连接码无效或已过期";
  failures = 0;
  void synchronize();
  connectEvents();
  return null;
}

// Retry after failure with exponential backoff and jitter; a success resets it.
let failures = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
function scheduleRetry() {
  clearTimeout(retry);
  if (status.state === "synced" || status.state === "attention") {
    failures = 0;
    return;
  }
  if (status.state === "unauthorized" || status.state === "upgrade") return;
  failures++;
  const delay = Math.min(60000, 1000 * 2 ** Math.min(failures, 6));
  retry = setTimeout(() => void synchronize().then(scheduleRetry), delay / 2 + Math.random() * (delay / 2));
}

// Server-sent hints: "something changed, pull now". The cursor pull stays the source of truth.
let events: EventSource | undefined;
function connectEvents() {
  if (events || typeof EventSource === "undefined") return;
  events = new EventSource("/v1/events");
  events.addEventListener("changed", () => void synchronize());
  events.addEventListener("ready", () => void synchronize().then(scheduleRetry));
  events.onerror = () => {
    // The browser reconnects by itself; a closed stream (e.g. 401) is reopened after the next good sync.
    if (events?.readyState === EventSource.CLOSED) {
      events = undefined;
      setTimeout(() => {
        if (status.state === "synced" || status.state === "attention") connectEvents();
      }, 30000);
    }
  };
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  void synchronize().then(() => {
    scheduleRetry();
    if (status.state !== "unauthorized") connectEvents();
  });
  // Slow safety net in case a hint was missed; the stream does the fast path.
  setInterval(() => void synchronize().then(scheduleRetry), 120000);
  window.addEventListener("online", () => {
    failures = 0;
    void synchronize().then(scheduleRetry);
  });
  window.addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void synchronize().then(scheduleRetry);
  });
}
