import type {
  AnyEntity,
  EntityType,
} from "../../../packages/contracts/entities.ts";
import type {
  Filter,
  Store,
  StoredReceipt,
  Transaction,
} from "../application/ports.ts";

type OwnerState = {
  revision: number;
  entities: Map<string, AnyEntity>;
  heads: Map<string, number>;
  receipts: Map<string, StoredReceipt>;
};

/**
 * Test double for the Store port: same contract as PostgreSQL (serial per owner,
 * all-or-nothing), no durability. Used by fast rule/protocol tests only; database
 * behaviour is proven separately against real PostgreSQL.
 */
export class MemoryStore implements Store {
  private owners = new Map<string, OwnerState>();
  private queue: Promise<unknown> = Promise.resolve();
  private state(owner: string) {
    let state = this.owners.get(owner);
    if (!state)
      this.owners.set(
        owner,
        (state = {
          revision: 0,
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
        entities: new Map(live.entities),
        heads: new Map(live.heads),
        receipts: new Map(live.receipts),
      };
      const tx: Transaction = {
        async get(type: EntityType, id: string) {
          const entity = draft.entities.get(id);
          return entity?.type === type
            ? (structuredClone(entity) as never)
            : null;
        },
        async count(type: EntityType, filter: Filter) {
          return [...draft.entities.values()].filter(
            (e) =>
              e.type === type &&
              !e.deleted &&
              Object.entries(filter.eq ?? {}).every(
                ([k, v]) => e.data[k] === v,
              ) &&
              Object.entries(filter.gte ?? {}).every(
                ([k, v]) => e.data[k] != null && e.data[k]! >= v,
              ),
          ).length;
        },
        async receipt(device, operationId) {
          return draft.receipts.get(device + "/" + operationId) ?? null;
        },
        async saveReceipt(device, operationId, receipt) {
          draft.receipts.set(device + "/" + operationId, receipt);
        },
        async save(entity) {
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
  async changes(owner: string, cursor: string, limit: number) {
    const state = this.state(owner);
    return [...state.heads]
      .filter(([, revision]) => revision > Number(cursor))
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([id, revision]) => ({
        revision: String(revision),
        entity: structuredClone(state.entities.get(id)!),
      }));
  }
}
