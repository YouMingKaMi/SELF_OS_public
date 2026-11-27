/**
 * In-memory read model over IndexedDB.
 *  - A type is read from disk the first time a screen asks for it, never before.
 *  - A write touches exactly one entity; only subscribers of that type are told.
 *  - Snapshots keep their identity until their type changes, so React can skip work.
 * IndexedDB stays the truth; other tabs announce what they changed and we re-read just that.
 */
import type {
  AnyEntity,
  EntityType,
} from "../../../../packages/contracts/entities.ts";
import { database, project, type Pending } from "./db.ts";

export type Topic = EntityType | "pending" | "status" | "entities";
type Loaded = { confirmed: Map<string, AnyEntity>; live: AnyEntity[] | null };

const EMPTY: AnyEntity[] = [];
const loaded = new Map<EntityType, Loaded>();
const loading = new Map<EntityType, Promise<void>>();
const listeners = new Map<Topic, Set<() => void>>();
const channel = new BroadcastChannel("council-next-v2");
let pending: Pending[] = [];
let pendingByEntity = new Map<string, Pending[]>();
let pendingIdsByType = new Map<EntityType, Set<string>>();

function isEntityType(topic: Topic): topic is EntityType {
  return topic !== "pending" && topic !== "status" && topic !== "entities";
}

export function subscribe(topics: readonly Topic[], listener: () => void, loadWholeType = true) {
  for (const topic of topics) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic)!.add(listener);
    if (loadWholeType && isEntityType(topic)) void ensure(topic);
  }
  return () => {
    for (const topic of topics) listeners.get(topic)?.delete(listener);
  };
}
export function emit(topics: Iterable<Topic>) {
  const called = new Set<() => void>();
  for (const topic of topics)
    for (const listener of listeners.get(topic) ?? [])
      if (!called.has(listener)) {
        called.add(listener);
        listener();
      }
}

export function indexPending(operations: readonly Pending[]) {
  const byId = new Map<string, Pending[]>();
  for (const op of operations) {
    const list = byId.get(op.entityId);
    if (list) list.push(op);
    else byId.set(op.entityId, [op]);
  }
  for (const list of byId.values()) list.sort((a, b) => a.sequence - b.sequence);
  return byId;
}

/** Load one type from disk once. Screens show their empty state until it resolves. */
export function ensure(type: EntityType) {
  let task = loading.get(type);
  if (!task) {
    task = (async () => {
      const rows = await (
        await database
      ).getAllFromIndex("confirmed", "type", type);
      if (loading.get(type) !== task) return;
      loaded.set(type, {
        confirmed: new Map(rows.map((row) => [row.id, row])),
        live: null,
      });
      emit([type]);
    })();
    loading.set(type, task);
  }
  return task;
}

/** Live (not deleted) entities of one type, pending edits applied. Stable until the type changes. */
export function snapshot(type: EntityType): AnyEntity[] {
  const state = loaded.get(type);
  if (!state) return EMPTY;
  if (!state.live) {
    const ids = new Set(state.confirmed.keys());
    for (const id of pendingIdsByType.get(type) ?? []) ids.add(id);
    const live: AnyEntity[] = [];
    for (const id of ids) {
      const entity = project(state.confirmed.get(id), pendingByEntity.get(id) ?? []);
      if (entity && !entity.deleted) live.push(entity);
    }
    state.live = live;
  }
  return state.live;
}
export const pendingSnapshot = () => pending;

/** Everything on this device, tombstones included. For search, export and the recycle bin only. */
export async function readAll(): Promise<AnyEntity[]> {
  const db = await database;
  const tx = db.transaction(["confirmed", "pending"], "readonly");
  const [rows, operations] = await Promise.all([
    tx.objectStore("confirmed").getAll(),
    tx.objectStore("pending").getAll(),
  ]);
  await tx.done;
  const confirmed = new Map(rows.map((row) => [row.id, row]));
  const byEntity = indexPending(operations);
  const ids = new Set([
    ...confirmed.keys(),
    ...byEntity.keys(),
  ]);
  return [...ids].flatMap((id) => {
    const entity = project(
      confirmed.get(id),
      byEntity.get(id) ?? [],
    );
    return entity ? [entity] : [];
  });
}

export type Change = {
  /** Confirmed copies written to disk in this step. */
  confirmed?: AnyEntity[];
  /** Confirmed copies removed from disk (conflict resolved to "does not exist"). */
  dropped?: { type: EntityType; id: string }[];
  /** The outbox as it now is on disk, when this step changed it. */
  pending?: Pending[];
  /** Durable changes by operation for routine writes and acknowledgements. */
  pendingDelta?: { entries?: Pending[]; removed?: string[] };
};
type Announcement = {
  confirmed: { type: EntityType; id: string }[];
  dropped: { type: EntityType; id: string }[];
  pending: boolean;
  pendingIds?: string[];
  replaced?: boolean;
};

/** Fold a completed disk change into memory and tell exactly the affected subscribers. */
export function apply(change: Change, broadcast = true) {
  const topics = new Set<Topic>();
  const delta = change.pendingDelta;
  let next = change.pending;
  if (delta) {
    const byOperation = new Map(pending.map((op) => [op.operationId, op]));
    for (const id of delta.removed ?? []) byOperation.delete(id);
    for (const op of delta.entries ?? []) byOperation.set(op.operationId, op);
    next = [...byOperation.values()];
  }
  if (next) {
    const old = new Map(pending.map((op) => [op.operationId, op.entityType]));
    pendingIdsByType = new Map();
    for (const op of next) {
      if (!old.delete(op.operationId)) topics.add(op.entityType);
      let ids = pendingIdsByType.get(op.entityType);
      if (!ids) pendingIdsByType.set(op.entityType, (ids = new Set()));
      ids.add(op.entityId);
    }
    for (const type of old.values()) topics.add(type);
    pending = next;
    pendingByEntity = indexPending(pending);
    topics.add("pending");
  }
  for (const entity of change.confirmed ?? []) {
    const state = loaded.get(entity.type);
    const current = state?.confirmed.get(entity.id);
    if (state && (!current || current.version <= entity.version))
      state.confirmed.set(entity.id, entity);
    topics.add(entity.type);
  }
  for (const { type, id } of change.dropped ?? []) {
    loaded.get(type)?.confirmed.delete(id);
    topics.add(type);
  }
  for (const topic of topics)
    if (isEntityType(topic)) {
      const state = loaded.get(topic);
      if (state) state.live = null;
    }
  if ([...topics].some(isEntityType)) topics.add("entities");
  emit(topics);
  if (broadcast) {
    const message: Announcement = {
      confirmed: (change.confirmed ?? []).map(({ type, id }) => ({ type, id })),
      dropped: change.dropped ?? [],
      pending: !!change.pending,
      pendingIds: delta && [...(delta.entries ?? []).map((op) => op.operationId), ...(delta.removed ?? [])],
    };
    channel.postMessage(message);
  }
}

/** A restored stream invalidates every loaded confirmed copy, including deleted rows. */
export async function replaceConfirmed(broadcast = true) {
  const types = [...loading.keys()];
  loading.clear();
  loaded.clear();
  apply({ pending: await (await database).getAll("pending") }, false);
  emit(["entities", ...[...listeners.keys()].filter(isEntityType).filter((type) => !types.includes(type))]);
  await Promise.all(types.map(ensure));
  if (broadcast)
    channel.postMessage({ replaced: true } satisfies Pick<Announcement, "replaced">);
}

// Another tab changed the disk: re-read only what it names, and only for types this tab has open.
channel.onmessage = async (event: MessageEvent<Announcement>) => {
  if (event.data.replaced) {
    await replaceConfirmed(false);
    return;
  }
  const db = await database;
  const confirmed: AnyEntity[] = [];
  for (const { type, id } of event.data.confirmed) {
    if (!loaded.has(type) && !listeners.get(type)?.size && !listeners.get("entities")?.size) continue;
    const row = await db.get("confirmed", id);
    if (row) confirmed.push(row);
  }
  const ids = event.data.pendingIds ?? [];
  const entries = await Promise.all(ids.map((id) => db.get("pending", id)));
  apply(
    {
      confirmed,
      dropped: event.data.dropped,
      pending: event.data.pending ? await db.getAll("pending") : undefined,
      pendingDelta: ids.length ? {
        entries: entries.filter((op): op is Pending => op !== undefined),
        removed: ids.filter((_, i) => !entries[i]),
      } : undefined,
    },
    false,
  );
};

export const ready = (async () => {
  apply({ pending: await (await database).getAll("pending") }, false);
})();
