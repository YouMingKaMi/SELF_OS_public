import type { AnyEntity } from "./entities.ts";

export type SyncScope = { datasetId: string; generation: string };
export type SyncState = SyncScope & { watermark: string; scopeRequired: boolean };
export type Snapshot = SyncScope & {
  watermark: string;
  snapshotId: string;
  total: number;
  expiresAt: string;
};
export type SnapshotPage = Snapshot & {
  records: AnyEntity[];
  /** Pass this position back as `after` to fetch the next page. */
  nextPosition: string | null;
};
export const syncScopeProperties = {
  datasetId: { type: "string", format: "uuid" },
  generation: { type: "string", format: "uuid" },
} as const;
export const syncScopeSchema = {
  type: "object",
  required: ["datasetId", "generation"],
  additionalProperties: false,
  properties: syncScopeProperties,
} as const;
