import { randomUUID } from "node:crypto";
import type {
  AnyEntity,
  EntityType,
} from "../../../packages/contracts/entities.ts";
import type { Snapshot, SyncScope } from "../../../packages/contracts/snapshot.ts";
import { assertScope } from "../application/scope.ts";
import type {
  Filter,
  Store,
  StoredReceipt,
  Transaction,
} from "../application/ports.ts";

type OwnerState = {
  revision: number;
  scope: SyncScope;
  entities: Map<string, AnyEntity>;
  heads: Map<string, number>;
  receipts: Map<string, StoredReceipt>;
};
const matches = (e: AnyEntity, type: EntityType, filter: Filter) =>
  e.type === type &&
  !e.deleted &&
  Object.entries(filter.eq ?? {}).every(([key, value]) => e.data[key] === value) &&
  Object.entries(filter.gte ?? {}).every(([key, value]) => e.data[key] != null && e.data[key]! >= value) &&
  Object.entries(filter.lte ?? {}).every(([key, value]) => e.data[key] != null && e.data[key]! <= value);

/**
 * Test double for the Store port: same contract as PostgreSQL (serial per owner,
 * all-or-nothing), no durability. Used by fast rule/protocol tests only; database
 * behaviour is proven separately against real PostgreSQL.
 */
export class MemoryStore implements Store {
  private owners = new Map<string, OwnerState>();
  private queue: Promise<unknown> = Promise.resolve();
  private snapshots = new Map<string, { snapshot: Snapshot; records: AnyEntity[] }>();
  private state(owner: string) {
    let state = this.owners.get(owner);
    if (!state)
      this.owners.set(
        owner,
        (state = {
          revision: 0,
          scope: { datasetId: randomUUID(), generation: randomUUID() },
          entities: new Map(),
          heads: new Map(),
          receipts: new Map(),
        }),
      );
    return state;
  }
  transaction<R>(owner: string, work: (tx: Transaction) => Promise<R>) {
    const run = async () => {
      const live = this.state(owner);
      const draft: OwnerState = {
        revision: live.revision,
        scope: live.scope,
        entities: new Map(live.entities),
        heads: new Map(live.heads),
        receipts: new Map(live.receipts),
      };
      const tx: Transaction = {
        async state() {
          return { ...draft.scope, watermark: String(draft.revision), scopeRequired: false };
        },
        async get(type: EntityType, id: string) {
          const entity = draft.entities.get(id);
          return entity?.type === type
            ? (structuredClone(entity) as never)
            : null;
        },
        async count(type: EntityType, filter: Filter) {
          return [...draft.entities.values()].filter((e) => matches(e, type, filter)).length;
        },
        async latest(type: EntityType, filter: Filter, field: string) {
          const row = [...draft.entities.values()]
            .filter((e) => matches(e, type, filter) && e.data[field] != null)
            .sort((a, b) => {
              const left = a.data[field]!;
              const right = b.data[field]!;
              return (left === right ? 0 : left > right ? -1 : 1) ||
                Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
                b.version - a.version || a.id.localeCompare(b.id);
            })[0];
          return row ? (structuredClone(row) as never) : null;
        },
        async receipt(device, operationId) {
          return draft.receipts.get(device + "/" + operationId) ?? null;
        },
        async saveReceipt(device, operationId, receipt) {
          draft.receipts.set(device + "/" + operationId, receipt);
        },
        async save(entity) {
          const previous = draft.entities.get(entity.id);
          if (previous && previous.type !== entity.type)
            throw new Error("ENTITY_TYPE_COLLISION");
          draft.entities.set(entity.id, structuredClone(entity));
          draft.heads.set(entity.id, ++draft.revision);
          return String(draft.revision);
        },
      };
      const result = await work(tx);
      this.owners.set(owner, draft);
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
  async changes(owner: string, cursor: string, limit: number, scope?: SyncScope) {
    const state = this.state(owner);
    if (scope) {
      assertScope(state.scope, scope);
      if (BigInt(cursor) > BigInt(state.revision)) throw new Error("CURSOR_AHEAD");
    }
    return [...state.heads]
      .filter(([, revision]) => revision > Number(cursor))
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([id, revision]) => ({
        revision: String(revision),
        entity: structuredClone(state.entities.get(id)!),
      }));
  }

  async snapshot(owner: string, scope: SyncScope): Promise<Snapshot> {
    const state = this.state(owner);
    assertScope(state.scope, scope);
    const existing = this.snapshots.get(owner);
    if (existing && Date.parse(existing.snapshot.expiresAt) > Date.now())
      return existing.snapshot;
    const records = [...state.entities.values()].map((entity) => structuredClone(entity));
    const snapshot = {
      ...state.scope,
      snapshotId: randomUUID(),
      watermark: String(state.revision),
      total: records.length,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    this.snapshots.set(owner, { snapshot, records });
    return snapshot;
  }

  async snapshotPage(owner: string, id: string, after: string, limit: number) {
    const data = this.snapshots.get(owner);
    if (!data || data.snapshot.snapshotId !== id || Date.parse(data.snapshot.expiresAt) <= Date.now())
      throw new Error("SNAPSHOT_EXPIRED");
    const position = Number(after);
    if (position > data.snapshot.total) throw new Error("CURSOR_AHEAD");
    const records = data.records.slice(position, position + limit);
    const next = position + records.length;
    return {
      ...data.snapshot, records: structuredClone(records),
      nextPosition: next < data.snapshot.total ? String(next) : null,
    };
  }
}
