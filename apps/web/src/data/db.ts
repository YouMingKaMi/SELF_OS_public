import { openDB, type DBSchema } from "idb";
import type {
  AnyEntity,
  Command,
} from "../../../../packages/contracts/entities.ts";

/** A local write waiting for the server. `sequence` is the device-local order. */
export type Pending = Command & {
  sequence: number;
  state: "queued" | "sending" | "conflict" | "error";
  /** Server copy returned with a conflict. */
  server?: AnyEntity | null;
  error?: string;
};

interface Local extends DBSchema {
  /** Server-confirmed copies only. Local edits never touch this store. */
  confirmed: { key: string; value: AnyEntity; indexes: { type: string } };
  pending: { key: string; value: Pending; indexes: { entityId: string } };
  meta: { key: string; value: string };
}

// v2: one stream for every entity type (tasks included). v1 databases are left untouched.
export const database = openDB<Local>("council-next-v2", 1, {
  upgrade(db) {
    db.createObjectStore("confirmed", { keyPath: "id" }).createIndex(
      "type",
      "type",
    );
    db.createObjectStore("pending", { keyPath: "operationId" }).createIndex(
      "entityId",
      "entityId",
    );
    db.createObjectStore("meta");
  },
});

/** What the user sees for one entity: its confirmed copy with its own pending edits on top. */
export function project(
  confirmed: AnyEntity | undefined,
  operations: Pending[],
): AnyEntity | undefined {
  let entity = confirmed;
  for (const op of operations)
    entity = {
      id: op.entityId,
      type: op.entityType,
      version: (entity?.version ?? 0) + 1,
      data: op.data ?? entity?.data ?? {},
      deleted: op.action === "delete",
      updatedAt: op.occurredAt,
    };
  return entity;
}
