import type { AnyEntity } from "../../../../packages/contracts/entities.ts";
import { recoveryKeys, type RecoveryMatch, type RecoveryProbe } from "../../../../packages/contracts/recovery.ts";
import type { SyncScope } from "../../../../packages/contracts/snapshot.ts";
import type { Pending } from "./db.ts";
import { makeBatch } from "./command-batch.ts";

function intents(operations: Pending[]) {
  const groups = new Map<string, Pending[]>();
  const membersByEntity = new Map<string, number>();
  for (const op of [...operations].sort((a, b) => a.sequence - b.sequence)) {
    const id = op.batchId ?? op.operationId;
    const group = groups.get(id);
    if (group) group.push(op);
    else groups.set(id, [op]);
    membersByEntity.set(op.entityId, (membersByEntity.get(op.entityId) ?? 0) + 1);
  }
  return { groups, membersByEntity };
}

function eligible(members: Pending[]) {
  return members.every((op) => op.state === "queued" || op.state === "sending") &&
    (!members[0].batchId || (members.length >= 2 && members[0].batchId === members[0].operationId));
}

function singleCreation(members: Pending[], count?: number) {
  const [op] = members;
  return !op.batchId && count === 1 && op.action === "put" && op.baseVersion === 0 &&
    Object.hasOwn(recoveryKeys, op.entityType);
}

export function recoveryProbes(operations: Pending[], scope?: SyncScope): RecoveryProbe[] {
  const { groups, membersByEntity } = intents(operations);
  const probes: RecoveryProbe[] = [];
  for (const [operationId, members] of groups) {
    if (!eligible(members)) continue;
    const anchor = members.at(-1)!;
    const creation = singleCreation(members, membersByEntity.get(anchor.entityId))
      ? anchor.data : undefined;
    const probe: RecoveryProbe = { operationId, entityType: anchor.entityType, entityId: anchor.entityId, creation };
    if (members.every((op) => op.state === "sending")) {
      if (anchor.batchId) probe.batch = makeBatch(members, scope);
      else {
        const { baseVersion, action, data, occurredAt } = anchor;
        probe.command = { operationId, entityId: anchor.entityId, entityType: anchor.entityType,
          baseVersion, action, data, occurredAt, scope };
      }
    }
    if (probe.batch || probe.command || creation) probes.push(probe);
  }
  return probes;
}

/** A recovered intent cannot skip an earlier unresolved edit to any of its entities. */
export async function settledOperations(
  operations: Pending[],
  matches: Map<string, RecoveryMatch>,
  staged: (id: string) => Promise<AnyEntity | undefined>,
) {
  const { groups, membersByEntity } = intents(operations);
  const settled = new Set<string>();
  const blocked = new Set<string>();
  for (const [id, members] of groups) {
    const result = matches.get(id);
    const anchor = members.at(-1)!;
    let verified = false;
    if (result && eligible(members) && !members.some((op) => blocked.has(op.entityId))) {
      if (result.kind === "receipt" && result.entityId === anchor.entityId &&
          members.every((op) => op.state === "sending")) {
        const records = await Promise.all(members.map((op) => staged(op.entityId)));
        verified = members.every((op, index) =>
          records[index]?.type === op.entityType && records[index]!.version > op.baseVersion);
      } else if (result.kind === "businessKey" && singleCreation(members, membersByEntity.get(anchor.entityId))) {
        const record = await staged(result.entityId);
        verified = record?.type === anchor.entityType && !record.deleted && record.version === result.version &&
          (result.entityId === anchor.entityId ||
            (!membersByEntity.has(result.entityId) && !await staged(anchor.entityId)));
      }
    }
    for (const op of members) {
      if (verified) settled.add(op.operationId);
      else blocked.add(op.entityId);
    }
  }
  return settled;
}
