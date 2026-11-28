/** The data API for feature screens. Screens never touch IndexedDB or fetch. */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  AnyEntity,
  Data,
  Entity,
  EntityData,
  EntityType,
} from "../../../../packages/contracts/entities.ts";
import type { Pending } from "./db.ts";
import { pendingSnapshot, readAll, snapshot, subscribe } from "./store.ts";
import { enqueue, statusSnapshot, type SyncState as WorkspaceSyncState, type SyncStatus as WorkspaceSyncStatus } from "./sync.ts";
import { fieldPatch } from "../../../../packages/contracts/edit.ts";
import { useDatedEntities } from "./dated-entities.ts";

export type { AnyEntity, Data, Entity, EntityData, EntityType, Pending };
export { useDatedEntities };
export { isLocalMode } from "./local-mode.ts";
export { importWorkspaceBackup, parseWorkspaceImport } from "./import.ts";
export type { ImportResult, ImportStrategy, ParsedWorkspaceBackup } from "./import.ts";
export {
  enqueueTogether,
  transferJournalText,
  settle,
  undoPending,
  startSync,
  synchronize,
  pairDevice,
} from "./sync.ts";
export type { WorkspaceSyncState, WorkspaceSyncStatus };
export type SyncState = Exclude<WorkspaceSyncState, "local">;
export type SyncStatus = { state: SyncState; message: string };

const combined = new Map<string, { parts: AnyEntity[][]; all: AnyEntity[] }>();
/**
 * Live entities of the named types. The component re-renders only when one of
 * those types changes, and the returned array keeps its identity until then.
 */
export function useEntities<T extends EntityType>(
  type: T,
): { entities: Entity<T>[] };
/** Several types at once come back as generic records; narrow with `e.type`. */
export function useEntities(
  ...types: [EntityType, EntityType, ...EntityType[]]
): { entities: AnyEntity[] };
export function useEntities(...types: EntityType[]): {
  entities: AnyEntity[];
} {
  const key = types.join(",");
  const topics = useMemo(() => types, [key]);
  const entities = useSyncExternalStore(
    (listener) => subscribe(topics, listener),
    () => {
      if (topics.length === 1) return snapshot(topics[0]);
      const parts = topics.map(snapshot);
      const cached = combined.get(key);
      if (cached && cached.parts.every((part, i) => part === parts[i]))
        return cached.all;
      const all = parts.flat();
      combined.set(key, { parts, all });
      return all;
    },
  );
  return { entities };
}

/** Local writes not yet confirmed by the server. */
export function usePending(): Pending[] {
  return useSyncExternalStore(
    (listener) => subscribe(["pending"], listener),
    pendingSnapshot,
  );
}
// Existing views exhaustively handle the server states. Local-aware views opt in to the full status.
const localStatusForExistingViews: SyncStatus = { state: "synced", message: "仅本机" };
export function useSyncStatus(): SyncStatus;
export function useSyncStatus(includeLocal: true): WorkspaceSyncStatus;
export function useSyncStatus(includeLocal?: true): WorkspaceSyncStatus {
  const status = useSyncExternalStore(
    (listener) => subscribe(["status"], listener),
    statusSnapshot,
  );
  return !includeLocal && status.state === "local" ? localStatusForExistingViews : status;
}

/**
 * Every record on this device, tombstones included. Reads the whole local database:
 * only for search, export and the recycle bin, never for an ordinary screen.
 */
const emptyWorkspace: AnyEntity[] = [];
export function useEverything(enabled = true): AnyEntity[] {
  const [all, setAll] = useState<AnyEntity[]>(emptyWorkspace);
  useEffect(() => {
    if (!enabled) {
      setAll(emptyWorkspace);
      return;
    }
    let revision = 0;
    function refresh() {
      const request = ++revision;
      void readAll().then((rows) => { if (request === revision) setAll(rows); });
    }
    const unsubscribe = subscribe(["entities"], refresh);
    refresh();
    return () => {
      revision++;
      unsubscribe();
    };
  }, [enabled]);
  return enabled ? all : emptyWorkspace;
}

/** Create (no `existing`) or replace an entity. Returns its id once it is durable on this device. */
export function put<T extends EntityType>(
  type: T,
  data: EntityData<T> | Data,
  existing?: { id: string },
) {
  return enqueue(
    type,
    existing?.id ?? crypto.randomUUID(),
    "put",
    data as Data,
  );
}
export function remove(entity: { type: EntityType; id: string }) {
  return enqueue(entity.type, entity.id, "delete");
}

/** Persist only fields changed since this editor opened. */
export function saveEdit(type: EntityType, id: string, base: Data, edited: Data) {
  const patch = fieldPatch(base, edited);
  return Object.keys(patch).length
    ? enqueue(type, id, "patch", patch, base)
    : Promise.resolve(id);
}

/** Deterministic id for "one record per natural key" (a habit on a day, a budget for a month). */
export async function stableId(key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
export async function putKey<T extends EntityType>(
  type: T,
  key: string,
  data: EntityData<T> | Data,
) {
  return enqueue(type, await stableId(type + ":" + key), "put", data as Data);
}
