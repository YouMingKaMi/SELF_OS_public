/** Wire types of the one synchronisation protocol (v1). */
import type { EntityData, EntityType } from "./schema.ts";
import { syncScopeSchema, type SyncScope } from "./snapshot.ts";
export { entityTypes, schema, spec } from "./schema.ts";
export type { EntityData, EntityType } from "./schema.ts";

export type Value = string | number | boolean | string[];
/** Untyped payload, for code that handles every entity type generically. */
export type Data = Record<string, Value | null | undefined>;

export type Entity<T extends EntityType = EntityType> = {
  [K in T]: {
    id: string;
    type: K;
    version: number;
    data: EntityData<K>;
    deleted: boolean;
    updatedAt: string;
  };
}[T];
/** The same record seen without knowing its type. Every `Entity<T>` is one. */
export type AnyEntity = {
  id: string;
  type: EntityType;
  version: number;
  data: Data;
  deleted: boolean;
  updatedAt: string;
};

export type Command = {
  operationId: string;
  entityId: string;
  entityType: EntityType;
  /** Version the client edited; 0 creates. A mismatch is a conflict, never an overwrite. */
  baseVersion: number;
  /** A patch keeps omitted fields and clears fields sent as null. A put can create records. */
  action: "put" | "patch" | "delete";
  data?: Data;
  /** Freeze this scope when queuing a write. A recovered database rejects old scopes. */
  scope?: SyncScope;
  occurredAt: string;
};
export type Receipt =
  | { outcome: "accepted"; entity: AnyEntity; revision: string }
  | { outcome: "conflict"; current: AnyEntity | null };
export type Changes = {
  changes: { revision: string; entity: AnyEntity }[];
  nextCursor: string;
  /** More changes exist after `nextCursor`; keep pulling. */
  hasMore: boolean;
};

export const commandSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "operationId",
    "entityId",
    "entityType",
    "baseVersion",
    "action",
    "occurredAt",
  ],
  properties: {
    operationId: { type: "string", format: "uuid" },
    entityId: { type: "string", format: "uuid" },
    entityType: { type: "string", maxLength: 40 },
    baseVersion: { type: "integer", minimum: 0 },
    action: { enum: ["put", "patch", "delete"] },
    occurredAt: { type: "string", format: "date-time" },
    data: { type: "object", maxProperties: 40 },
    scope: syncScopeSchema,
  },
  allOf: [
    {
      if: { properties: { action: { enum: ["put", "patch"] } } },
      then: { required: ["data"] },
    },
  ],
} as const;
