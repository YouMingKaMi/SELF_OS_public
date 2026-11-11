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

export type Topic = EntityType | "pending" | "status";
type Loaded = { confirmed: Map<string, AnyEntity>; live: AnyEntity[] | null };

const EMPTY: AnyEntity[] = [];
const loaded = new Map<EntityType, Loaded>();
const loading = new Map<EntityType, Promise<void>>();
const listeners = new Map<Topic, Set<() => void>>();
const channel = new BroadcastChannel("council-next-v2");
let pending: Pending[] = [];

export function subscribe(topics: readonly Topic[], listener: () => void) {
  for (const topic of topics) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic)!.add(listener);
    if (topic !== "pending" && topic !== "status") void ensure(topic);
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

const byEntity = (id: string) =>
  pending
    .filter((op) => op.entityId === id)
    .sort((a, b) => a.sequence - b.sequence);

/** Load one type from disk once. Screens show their empty state until it resolves. */
export function ensure(type: EntityType) {
  let task = loading.get(type);
  if (!task) {
    task = (async () => {
      const rows = await (
        await database
      ).getAllFromIndex("confirmed", "type", type);
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
    for (const op of pending) if (op.entityType === type) ids.add(op.entityId);
    const live: AnyEntity[] = [];
    for (const id of ids) {
      const entity = project(state.confirmed.get(id), byEntity(id));
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
  const ids = new Set([
    ...confirmed.keys(),
    ...operations.map((op) => op.entityId),
  ]);
  return [...ids].flatMap((id) => {
    const entity = project(
      confirmed.get(id),
      operations
        .filter((op) => op.entityId === id)
        .sort((a, b) => a.sequence - b.sequence),
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
};
type Announcement = {
  confirmed: { type: EntityType; id: string }[];
  dropped: { type: EntityType; id: string }[];
  pending: boolean;
};

/** Fold a completed disk change into memory and tell exactly the affected subscribers. */
export function apply(change: Change, broadcast = true) {
  const topics = new Set<Topic>();
  if (change.pending) {
    for (const op of [...pending, ...change.pending]) topics.add(op.entityType);
    pending = change.pending;
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
    if (topic !== "pending" && topic !== "status") {
      const state = loaded.get(topic);
      if (state) state.live = null;
    }
  emit(topics);
  if (broadcast) {
    const message: Announcement = {
      confirmed: (change.confirmed ?? []).map(({ type, id }) => ({ type, id })),
      dropped: change.dropped ?? [],
      pending: !!change.pending,
    };
    channel.postMessage(message);
  }
}

// Another tab changed the disk: re-read only what it names, and only for types this tab has open.
channel.onmessage = async (event: MessageEvent<Announcement>) => {
  const db = await database;
  const confirmed: AnyEntity[] = [];
  for (const { type, id } of event.data.confirmed) {
    if (!loaded.has(type)) continue;
    const row = await db.get("confirmed", id);
    if (row) confirmed.push(row);
  }
  apply(
    {
      confirmed,
      dropped: event.data.dropped,
      pending: event.data.pending ? await db.getAll("pending") : undefined,
    },
    false,
  );
};

export const ready = (async () => {
  apply({ pending: await (await database).getAll("pending") }, false);
})();
