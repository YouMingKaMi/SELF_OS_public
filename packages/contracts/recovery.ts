import { commandSchema, type Command, type Data, type EntityType } from "./entities.ts";
import { commandBatchSchema, type CommandBatch } from "./command-batch.ts";
import { syncScopeSchema, type SyncScope } from "./snapshot.ts";

export const recoveryPageSize = 10;
export const recoveryKeys = {
  budget: ["month"],
  metricLog: ["metricId", "day"],
  habitLog: ["habitId", "day"],
  checklistRun: ["checklistId", "day"],
} as const;

export type RecoveryProbe = {
  operationId: string;
  entityType: EntityType;
  entityId: string;
  command?: Command;
  batch?: CommandBatch;
  /** Only for a standalone creation with no other local edits of the entity. */
  creation?: Data;
};

export type RecoveryRequest = {
  scope: SyncScope;
  watermark: string;
  probes: RecoveryProbe[];
};

export type RecoveryMatch =
  | { operationId: string; kind: "receipt"; entityId: string }
  | { operationId: string; kind: "businessKey"; entityId: string; version: number };

export type RecoveryResponse = { matches: RecoveryMatch[] };

const id = { type: "string", format: "uuid" } as const;
export const recoveryRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scope", "watermark", "probes"],
  properties: {
    scope: syncScopeSchema,
    watermark: { type: "string", pattern: "^[0-9]{1,18}$" },
    probes: {
      type: "array", minItems: 1, maxItems: recoveryPageSize,
      items: {
        type: "object", additionalProperties: false,
        required: ["operationId", "entityType", "entityId"],
        properties: {
          operationId: id,
          entityType: { type: "string", maxLength: 40 },
          entityId: id,
          command: commandSchema,
          batch: commandBatchSchema,
          creation: { type: "object", maxProperties: 10 },
        },
      },
    },
  },
} as const;

export const recoveryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array", maxItems: recoveryPageSize,
      items: {
        type: "object", additionalProperties: false,
        required: ["operationId", "kind", "entityId"],
        properties: {
          operationId: id,
          kind: { enum: ["receipt", "businessKey"] },
          entityId: id,
          version: { type: "integer", minimum: 1 },
        },
        if: { properties: { kind: { const: "businessKey" } } },
        then: { required: ["version"] },
      },
    },
  },
} as const;
