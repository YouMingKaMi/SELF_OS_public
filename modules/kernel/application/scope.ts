import type { SyncScope, SyncState } from "../../../packages/contracts/snapshot.ts";

export function assertScope(current: SyncScope, received: SyncScope) {
  if (current.datasetId !== received.datasetId) throw new Error("DATASET_MISMATCH");
  if (current.generation !== received.generation) throw new Error("GENERATION_MISMATCH");
}

export function requireScope(current: SyncState, received?: SyncScope) {
  if (received) assertScope(current, received);
  else if (current.scopeRequired) throw new Error("SYNC_UPGRADE_REQUIRED");
}
