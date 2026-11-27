import { openDB, type DBSchema } from "idb";
import type {
  AnyEntity,
  Command,
} from "../../../../packages/contracts/entities.ts";
import { applyPatch, legacyPut } from "../../../../packages/contracts/edit.ts";

/** A local write waiting for the server. `sequence` is the device-local order. */
export type Pending = Command & {
  sequence: number;
  batchId?: string;
  state: "queued" | "sending" | "conflict" | "error";
  /** Server copy returned with a conflict. */
  server?: AnyEntity | null;
  error?: string;
  /** Local draft saved before the confirmed database was replaced. */
  recoveryDraft?: AnyEntity;
};

export interface Local extends DBSchema {
  /** Server-confirmed copies only. Local edits never touch this store. */
  confirmed: { key: string; value: AnyEntity; indexes: { type: string; typeDay: [string, string] } };
  pending: { key: string; value: Pending; indexes: { entityId: string; batchId: string; sequence: number } };
  meta: { key: string; value: string };
  snapshot: { key: string; value: AnyEntity };
}

// v2: one stream for every entity type (tasks included). v1 databases are left untouched.
export const database = openDB<Local>("council-next-v2", 5, {
  blocking(_current, _next, event) {
    (event.target as IDBDatabase).close();
  },
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (oldVersion === 0) {
      db.createObjectStore("confirmed", { keyPath: "id" }).createIndex("type", "type");
      db.createObjectStore("pending", { keyPath: "operationId" }).createIndex("entityId", "entityId");
      db.createObjectStore("meta");
    }
    if (oldVersion < 2) db.createObjectStore("snapshot", { keyPath: "id" });
    if (oldVersion < 3) {
      transaction.objectStore("confirmed").createIndex("typeDay", ["type", "data.day"]);
    }
    if (oldVersion < 4) transaction.objectStore("pending").createIndex("batchId", "batchId");
    if (oldVersion < 5) transaction.objectStore("pending").createIndex("sequence", "sequence");
  },
});

/** What the user sees for one entity: its confirmed copy with its own pending edits on top. */
export function project(
  confirmed: AnyEntity | undefined,
  operations: Pending[],
): AnyEntity | undefined {
  let entity = confirmed;
  if (operations.some((op) => op.recoveryDraft)) return confirmed;
  for (const op of operations)
    entity = {
      id: op.entityId,
      type: op.entityType,
      version: (entity?.version ?? 0) + 1,
      data: op.action === "patch"
        ? applyPatch(entity?.data ?? {}, op.data ?? {})
        : op.data ? legacyPut(op.entityType, entity?.data, op.data) : entity?.data ?? {},
      deleted: op.action === "delete",
      updatedAt: op.occurredAt,
    };
  return entity;
}
