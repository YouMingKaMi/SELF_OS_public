import pg from "pg";
import {
  schema,
  type AnyEntity,
  type Data,
  type EntityType,
} from "../../../packages/contracts/entities.ts";
import type { EntitySpec } from "../../../packages/contracts/fields.ts";
import type {
  Filter,
  Store,
  StoredReceipt,
  Transaction,
} from "../application/ports.ts";
import { columnName } from "./ddl.ts";

export const databaseSchema = "council";
export const defaultDatabaseUrl =
  "postgres://council:local-development-only@127.0.0.1:55439/council_next";

/** Calendar days stay strings end to end; they are never instants. */
const types = {
  getTypeParser: (oid: number, format?: string) =>
    oid === 1082
      ? (value: string) => value
      : pg.types.getTypeParser(oid, format as "text"),
} as pg.CustomTypesConfig;

export function createPool(connectionString = defaultDatabaseUrl) {
  return new pg.Pool({
    connectionString,
    types,
    options: `-c search_path=${databaseSchema}`,
  });
}

type Queryable = Pick<pg.PoolClient, "query">;
const specOf = (type: EntityType): EntitySpec => schema[type];

function fromRow(type: EntityType, row: Record<string, unknown>): AnyEntity {
  const data: Data = {};
  for (const [key, f] of Object.entries(specOf(type).fields)) {
    const value = row[columnName(key).slice(1, -1)];
    if (value === null || value === undefined) continue;
    data[key] =
      f.kind === "timestamp"
        ? (value as Date).toISOString()
        : f.kind === "money" || f.kind === "decimal"
          ? String(value)
          : (value as Data[string]);
  }
  return {
    id: String(row.id),
    type,
    version: Number(row.version),
    deleted: Boolean(row.deleted),
    updatedAt: (row.updated_at as Date).toISOString(),
    data,
  };
}

class PostgresTransaction implements Transaction {
  private db: Queryable;
  private owner: string;
  constructor(db: Queryable, owner: string) {
    this.db = db;
    this.owner = owner;
  }
  async get(type: EntityType, id: string) {
    const row = (
      await this.db.query(
        `SELECT * FROM ${specOf(type).table} WHERE owner_id=$1 AND id=$2`,
        [this.owner, id],
      )
    ).rows[0];
    return row ? (fromRow(type, row) as never) : null;
  }
  async count(type: EntityType, filter: Filter) {
    const spec = specOf(type);
    const values: unknown[] = [this.owner];
    const where = ["owner_id=$1", "NOT deleted"];
    for (const [operator, conditions] of [
      ["=", filter.eq],
      [">=", filter.gte],
    ] as const)
      for (const [key, value] of Object.entries(conditions ?? {})) {
        if (!spec.fields[key]) throw new Error("UNKNOWN_FIELD:" + key);
        values.push(value);
        where.push(`${columnName(key)}${operator}$${values.length}`);
      }
    const row = (
      await this.db.query(
        `SELECT count(*) AS n FROM ${spec.table} WHERE ${where.join(" AND ")}`,
        values,
      )
    ).rows[0];
    return Number(row.n);
  }
  async receipt(device: string, operationId: string) {
    const row = (
      await this.db.query(
        "SELECT hash,outcome,entity_type,entity_id,revision FROM sync_receipts WHERE owner_id=$1 AND device_id=$2 AND operation_id=$3",
        [this.owner, device, operationId],
      )
    ).rows[0];
    return row
      ? ({
          hash: row.hash,
          outcome: row.outcome,
          entityType: row.entity_type,
          entityId: row.entity_id,
          revision: row.revision,
        } as StoredReceipt)
      : null;
  }
  async saveReceipt(device: string, operationId: string, r: StoredReceipt) {
    await this.db.query(
      "INSERT INTO sync_receipts(owner_id,device_id,operation_id,hash,outcome,entity_type,entity_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        this.owner,
        device,
        operationId,
        r.hash,
        r.outcome,
        r.entityType,
        r.entityId,
        r.revision,
      ],
    );
  }
  async save(entity: AnyEntity) {
    const spec = specOf(entity.type);
    const keys = Object.keys(spec.fields);
    const columns = [
      "owner_id",
      "id",
      "version",
      "deleted",
      "updated_at",
      ...keys.map(columnName),
    ];
    const values = [
      this.owner,
      entity.id,
      entity.version,
      entity.deleted,
      entity.updatedAt,
      ...keys.map((key) => {
        const value = entity.data[key];
        return value === undefined || value === null
          ? null
          : Array.isArray(value)
            ? JSON.stringify(value)
            : value;
      }),
    ];
    await this.db.query(
      `INSERT INTO ${spec.table}(${columns.join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(owner_id,id) DO UPDATE SET ${columns
        .slice(2)
        .map((c) => `${c}=EXCLUDED.${c}`)
        .join(",")}`,
      values,
    );
    const revision: string = (
      await this.db.query(
        "UPDATE sync_clock SET revision=revision+1 WHERE owner_id=$1 RETURNING revision",
        [this.owner],
      )
    ).rows[0].revision;
    await this.db.query(
      "INSERT INTO sync_heads(owner_id,entity_id,entity_type,revision) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,entity_id) DO UPDATE SET revision=EXCLUDED.revision",
      [this.owner, entity.id, entity.type, revision],
    );
    return revision;
  }
}

/**
 * Development and test helper: remove one owner completely.
 * Children go before parents, so repeat until the foreign keys let every table empty.
 */
export async function purgeOwner(pool: pg.Pool, owner: string) {
  const tables = Object.values(schema).map((spec) => spec.table);
  for (let pass = 0, blocked = true; blocked; pass++) {
    if (pass > tables.length) throw new Error("Could not purge " + owner);
    blocked = false;
    for (const table of tables)
      await pool
        .query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner])
        .catch(() => (blocked = true));
  }
  for (const table of ["sync_receipts", "sync_heads", "sync_clock", "identity_devices", "identity_pairings"])
    await pool.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
}

export class PostgresStore implements Store {
  private pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  async transaction<R>(owner: string, work: (tx: Transaction) => Promise<R>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO sync_clock(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
        [owner],
      );
      // Serialises this owner's writers; held until COMMIT so readers never see a gap.
      await db.query(
        "SELECT revision FROM sync_clock WHERE owner_id=$1 FOR UPDATE",
        [owner],
      );
      const result = await work(new PostgresTransaction(db, owner));
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async changes(owner: string, cursor: string, limit: number) {
    const db = await this.pool.connect();
    try {
      // One snapshot, so every head is read together with the row it points at.
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const heads = (
        await db.query(
          "SELECT entity_id,entity_type,revision FROM sync_heads WHERE owner_id=$1 AND revision>$2 ORDER BY revision LIMIT $3",
          [owner, cursor, limit],
        )
      ).rows as {
        entity_id: string;
        entity_type: EntityType;
        revision: string;
      }[];
      const byType = new Map<EntityType, string[]>();
      for (const head of heads)
        byType.set(head.entity_type, [
          ...(byType.get(head.entity_type) ?? []),
          head.entity_id,
        ]);
      const entities = new Map<string, AnyEntity>();
      for (const [type, ids] of byType)
        for (const row of (
          await db.query(
            `SELECT * FROM ${specOf(type).table} WHERE owner_id=$1 AND id=ANY($2::uuid[])`,
            [owner, ids],
          )
        ).rows)
          entities.set(String(row.id), fromRow(type, row));
      await db.query("COMMIT");
      return heads.map((head) => ({
        revision: head.revision,
        entity: entities.get(head.entity_id)!,
      }));
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
