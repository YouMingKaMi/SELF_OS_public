import type {
  AnyEntity,
  Entity,
  EntityData,
  EntityType,
  Value,
} from "../../../packages/contracts/entities.ts";
import type { Snapshot, SnapshotPage, SyncScope, SyncState } from "../../../packages/contracts/snapshot.ts";

/** Live (not deleted) rows of one type matching every condition. */
export type Filter = {
  eq?: Record<string, Value>;
  /** Inclusive lower bound, e.g. `{ day: "2026-11-01" }`. */
  gte?: Record<string, Value>;
  lte?: Record<string, Value>;
};

/** What a business rule may ask about already-confirmed data. No SQL crosses this line. */
export type Reader = {
  /** Returns tombstones too; check `deleted`. */
  get<T extends EntityType>(type: T, id: string): Promise<Entity<T> | null>;
  count(type: EntityType, filter: Filter): Promise<number>;
  latest<T extends EntityType>(
    type: T,
    filter: Filter,
    field: keyof EntityData<T> & string,
  ): Promise<Entity<T> | null>;
};

/**
 * Rules a module attaches to one of its own entity types.
 * `validate` and `prepare` are pure; `check` may read through the port.
 * Rules signal failure by throwing `Error("CODE")` or `Error("CODE:field")`.
 */
export type EntityRule<T extends EntityType> = {
  /** Preserve live dependencies before tombstoning. A restore runs the ordinary write rules. */
  checkDelete?(current: Entity<T>, reader: Reader): Promise<void>;
  validate?(data: EntityData<T>): void;
  /** Derive server-owned fields (e.g. a completion instant) before saving. */
  prepare?(input: {
    data: EntityData<T>;
    current: Entity<T> | null;
    occurredAt: string;
  }): EntityData<T>;
  /** Resolve a reference from the owner's current records under the write lock. */
  resolve?(
    input: { data: EntityData<T>; current: Entity<T> | null },
    reader: Reader,
  ): Promise<EntityData<T>>;
  check?(
    input: {
      id: string;
      data: EntityData<T>;
      current: Entity<T> | null;
      /** Live targets of every `ref` field present in `data`, by field name. */
      refs: Record<string, AnyEntity>;
    },
    reader: Reader,
  ): Promise<void>;
};
export type Rules = { [T in EntityType]?: EntityRule<T> };

export type StoredReceipt = {
  hash: string;
  outcome: "accepted" | "conflict";
  entityType: EntityType;
  entityId: string;
  revision: string | null;
};

/** One serialised unit of work for one owner. Everything in it commits or nothing does. */
export type Transaction = Reader & {
  state(): Promise<SyncState>;
  receipt(device: string, operationId: string): Promise<StoredReceipt | null>;
  saveReceipt(
    device: string,
    operationId: string,
    receipt: StoredReceipt,
  ): Promise<void>;
  /** Upsert the row, advance the owner's revision and move the entity's change head. */
  save(entity: AnyEntity): Promise<string>;
};

export type Store = {
  /** Holds the owner's revision lock until commit, so revisions are issued in commit order. */
  transaction<R>(
    owner: string,
    work: (tx: Transaction) => Promise<R>,
  ): Promise<R>;
  changes(
    owner: string,
    cursor: string,
    limit: number,
    scope?: SyncScope,
  ): Promise<{ revision: string; entity: AnyEntity }[]>;
  snapshot(owner: string, scope: SyncScope): Promise<Snapshot>;
  snapshotPage(owner: string, id: string, after: string, limit: number): Promise<SnapshotPage>;
};
