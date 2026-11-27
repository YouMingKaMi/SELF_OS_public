import { syncScopeProperties, syncScopeSchema } from "../packages/contracts/snapshot.ts";
import { recoveryRequestSchema, recoveryResponseSchema } from "../packages/contracts/recovery.ts";

const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const response = (name: string, description: string) => ({
  description,
  content: { "application/json": { schema: ref(name) } },
});
const authenticated = {
  security: [{ devBearer: [] }],
};
const syncState = {
  ...syncScopeSchema,
  required: [...syncScopeSchema.required, "watermark", "scopeRequired"],
  properties: { ...syncScopeProperties, watermark: { type: "string" }, scopeRequired: { type: "boolean" } },
};
const snapshot = {
  ...syncScopeSchema,
  required: [...syncScopeSchema.required, "watermark", "snapshotId", "total", "expiresAt"],
  properties: {
    ...syncScopeProperties,
    watermark: { type: "string" },
    snapshotId: { type: "string", format: "uuid" },
    total: { type: "integer", minimum: 0 },
    expiresAt: { type: "string", format: "date-time" },
  },
};
const sessionError = { 401: response("Error", "Missing or wrong credential.") };
export const snapshotSchemas = {
  RecoveryRequest: recoveryRequestSchema,
  RecoveryResponse: recoveryResponseSchema,
  SyncScope: syncScopeSchema,
  SyncState: syncState,
  Snapshot: snapshot,
  SnapshotPage: {
    ...snapshot,
    required: [...snapshot.required, "records", "nextPosition"],
    properties: {
      ...snapshot.properties,
      records: { type: "array", items: ref("Entity") },
      nextPosition: { type: ["string", "null"] },
    },
  },
};
export const snapshotPaths = {
  "/v1/recovery-matches": {
    post: {
      ...authenticated,
      operationId: "reconcileRecovery",
      requestBody: { required: true, content: { "application/json": { schema: ref("RecoveryRequest") } } },
      responses: {
        200: response("RecoveryResponse", "Read-only receipt and exact business-key matches."),
        400: response("Error", "Invalid recovery probe."),
        409: response("Error", "Scope mismatch or watermark is ahead of the restored database."),
        ...sessionError,
      },
    },
  },
  "/v1/sync-state": {
    get: {
      ...authenticated,
      operationId: "readSyncState",
      responses: {
        200: response("SyncState", "Current identity and latest revision of this account."),
        ...sessionError,
      },
    },
  },
  "/v1/snapshots": {
    post: {
      ...authenticated,
      operationId: "createSyncSnapshot",
      requestBody: { required: true, content: { "application/json": { schema: ref("SyncScope") } } },
      responses: {
        200: response("Snapshot", "Persistent snapshot of this account at one revision."),
        409: response("Error", "Scope mismatch or a snapshot is being created."),
        ...sessionError,
      },
    },
  },
  "/v1/snapshots/{id}": {
    get: {
      ...authenticated,
      operationId: "readSyncSnapshotPage",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "after", in: "query", schema: { type: "string", pattern: "^[0-9]{1,15}$" } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
      ],
      responses: {
        200: response("SnapshotPage", "Ordered snapshot page and an opaque continuation position."),
        409: response("Error", "Snapshot expired or position is ahead of the snapshot."),
        ...sessionError,
      },
    },
  },
} as const;
