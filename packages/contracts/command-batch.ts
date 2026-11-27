import { commandSchema, type AnyEntity, type Command, type Receipt } from "./entities.ts";
import { syncScopeSchema, type SyncScope } from "./snapshot.ts";

export const maxBatchCommands = 40;
export type BatchMember = Omit<Command, "operationId" | "scope">;
export type CommandBatch = {
  operationId: string;
  scope?: SyncScope;
  commands: BatchMember[];
};
export type BatchReceipt =
  | { outcome: "accepted"; effects: Extract<Receipt, { outcome: "accepted" }>[] }
  | { outcome: "conflict"; entityId: string; current: AnyEntity | null };

const { operationId, scope: _scope, ...memberProperties } = commandSchema.properties;
export const batchMemberSchema = {
  ...commandSchema,
  required: commandSchema.required.filter((field) => field !== "operationId"),
  properties: memberProperties,
} as const;
export const commandBatchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operationId", "commands"],
  properties: {
    operationId,
    scope: syncScopeSchema,
    commands: { type: "array", minItems: 2, maxItems: maxBatchCommands, items: batchMemberSchema },
  },
} as const;
