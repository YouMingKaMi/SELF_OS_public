import pg from "pg";
import {
  schema,
  type AnyEntity,
  type Data,
  type EntityType,
} from "../../../packages/contracts/entities.ts";
import type { EntitySpec } from "../../../packages/contracts/fields.ts";
import type { Snapshot, SnapshotPage, SyncScope, SyncState } from "../../../packages/contracts/snapshot.ts";
import { assertScope, requireScope } from "../application/scope.ts";
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

export function createPool(
  connection:
    | string
    | Pick<pg.PoolConfig, "host" | "database" | "user"> = defaultDatabaseUrl,
) {
  return new pg.Pool({
    ...(typeof connection === "string"
      ? { connectionString: connection }
      : connection),
    types,
    options: `-c search_path=${databaseSchema}`,
  });
}

type Queryable = Pick<pg.PoolClient, "query">;
const specOf = (type: EntityType): EntitySpec => schema[type];

export function fromRow(type: EntityType, row: Record<string, unknown>): AnyEntity {
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

type ClockRow = { dataset_id: string; generation: string; revision: string; scope_required: boolean };
const clockFields = "dataset_id,generation,revision,scope_required";
type SnapshotRow = {
  id: string; dataset_id: string; generation: string;
  watermark: string; total: number; expires_at: Date;
};
const timestampJson = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The bulk copy uses the same field kinds as fromRow, keeping money and decimal values as strings. */
function snapshotEntity(type: EntityType, spec: EntitySpec) {
  const pairs = Object.entries(spec.fields).flatMap(([key, field]) => {
    const column = columnName(key);
    return [
      `'${key}'`,
      field.kind === "timestamp" ? timestampJson(column)
        : field.kind === "money" || field.kind === "decimal" ? `${column}::text`
          : column,
    ];
  });
  return `jsonb_build_object(
    'id',id,'type','${type}','version',version,'deleted',deleted,'updatedAt',${timestampJson("updated_at")},
    'data',jsonb_strip_nulls(jsonb_build_object(${pairs.join(",")})))`;
}

function clockState(row: ClockRow): SyncState {
  return {
    datasetId: row.dataset_id, generation: row.generation, watermark: row.revision,
    scopeRequired: row.scope_required,
  };
}

async function readClock(db: Queryable, owner: string): Promise<SyncState | undefined> {
  const result = await db.query<ClockRow>(
    `SELECT ${clockFields} FROM sync_clock WHERE owner_id=$1`, [owner],
  );
  const row = result.rows[0];
  return row ? clockState(row) : undefined;
}

function snapshotHeader(row: SnapshotRow): Snapshot {
  return {
    snapshotId: row.id, datasetId: row.dataset_id, generation: row.generation,
    watermark: row.watermark, total: row.total, expiresAt: row.expires_at.toISOString(),
  };
}

export async function readOwnerSnapshot(
  pool: pg.Pool,
  owner: string,
  types: readonly EntityType[],
  includeDeleted = false,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout = '5s'");
    const clock = await db.query<{ revision: string }>(
      "SELECT revision FROM sync_clock WHERE owner_id=$1",
      [owner],
    );
    const revision = Number(clock.rows[0]?.revision);
    if (!Number.isSafeInteger(revision))
      throw new Error("Unavailable owner revision");
    const rows: AnyEntity[] = [];
    for (const type of types) {
      const result = await db.query(
        `SELECT * FROM ${specOf(type).table} WHERE owner_id=$1${includeDeleted ? "" : " AND NOT deleted"}`,
        [owner],
      );
      rows.push(...result.rows.map((row) => fromRow(type, row)));
    }
    await db.query("COMMIT");
    return { revision, rows };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

class PostgresTransaction implements Transaction {
  private db: Queryable;
  private owner: string;
  private clock: ClockRow;
  constructor(db: Queryable, owner: string, clock: ClockRow) {
    this.db = db;
    this.owner = owner;
    this.clock = clock;
  }
  async state() {
    return clockState(this.clock);
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
  private filter(type: EntityType, filter: Filter) {
    const spec = specOf(type);
    const values: unknown[] = [this.owner];
    const where = ["owner_id=$1", "NOT deleted"];
    for (const [operator, conditions] of [
      ["=", filter.eq],
      [">=", filter.gte],
      ["<=", filter.lte],
    ] as const)
      for (const [key, value] of Object.entries(conditions ?? {})) {
        if (!spec.fields[key]) throw new Error("UNKNOWN_FIELD:" + key);
        values.push(value);
        where.push(`${columnName(key)}${operator}$${values.length}`);
      }
    return { spec, where, values };
  }
  async count(type: EntityType, filter: Filter) {
    const { spec, where, values } = this.filter(type, filter);
    const row = (
      await this.db.query(
        `SELECT count(*) AS n FROM ${spec.table} WHERE ${where.join(" AND ")}`,
        values,
      )
    ).rows[0];
    return Number(row.n);
  }
  async latest(type: EntityType, filter: Filter, field: string) {
    const { spec, where, values } = this.filter(type, filter);
    if (!Object.hasOwn(spec.fields, field)) throw new Error("UNKNOWN_FIELD:" + field);
    const column = columnName(field);
    where.push(`${column} IS NOT NULL`);
    const row = (
      await this.db.query(
        `SELECT * FROM ${spec.table} WHERE ${where.join(" AND ")}
         ORDER BY ${column} DESC, updated_at DESC, version DESC, id ASC LIMIT 1`,
        values,
      )
    ).rows[0];
    return row ? (fromRow(type, row) as never) : null;
  }
  async receipt(device: string, operationId: string) {
    const row = (
      await this.db.query(
        `SELECT hash,outcome,entity_type,entity_id,revision
           FROM sync_receipts WHERE owner_id=$1 AND device_id=$2 AND operation_id=$3
         UNION ALL
         SELECT hash,outcome,entity_type,entity_id,revision
           FROM sync_receipts_archive WHERE owner_id=$1 AND device_id=$2 AND operation_id=$3
         LIMIT 1`,
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
    const head = await this.db.query(
      "INSERT INTO sync_heads(owner_id,entity_id,entity_type,revision) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,entity_id) DO UPDATE SET revision=EXCLUDED.revision WHERE sync_heads.entity_type=EXCLUDED.entity_type",
      [this.owner, entity.id, entity.type, revision],
    );
    if (head.rowCount !== 1) throw new Error("ENTITY_TYPE_COLLISION");
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
  for (const table of ["sync_receipts", "sync_receipts_archive", "sync_heads", "sync_clock", "identity_devices", "identity_pairings"])
    await pool.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
}

/** Start a new generation after restoring a backup, before clients reconnect. */
export async function rotateRestoredGeneration(pool: pg.Pool) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const changed = await db.query("UPDATE sync_clock SET generation=gen_random_uuid(),scope_required=true");
    await db.query("DELETE FROM sync_snapshots");
    await db.query("COMMIT");
    return changed.rowCount ?? 0;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
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
      const clock = await db.query<ClockRow>(
        `SELECT ${clockFields} FROM sync_clock WHERE owner_id=$1 FOR NO KEY UPDATE`,
        [owner],
      );
      const result = await work(new PostgresTransaction(db, owner, clock.rows[0]));
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async changes(owner: string, cursor: string, limit: number, scope?: SyncScope) {
    const db = await this.pool.connect();
    try {
      // One snapshot, so every head is read together with the row it points at.
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await readClock(db, owner);
      if (state) {
        requireScope(state, scope);
        if (scope && BigInt(cursor) > BigInt(state.watermark)) throw new Error("CURSOR_AHEAD");
      } else if (scope) {
        throw new Error("DATASET_MISMATCH");
      }
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

  async snapshot(owner: string, scope: SyncScope): Promise<Snapshot> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await db.query("SET LOCAL statement_timeout='30s'");
      // Never wait for another snapshot while holding an old repeatable-read view.
      const guard = await db.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('council-snapshot'), hashtext($1)) AS locked", [owner],
      );
      if (!guard.rows[0].locked) throw new Error("SNAPSHOT_BUSY");
      const state = await readClock(db, owner);
      if (!state) throw new Error("DATASET_MISMATCH");
      assertScope(state, scope);

      const existing = await db.query<SnapshotRow>(
        "SELECT * FROM sync_snapshots WHERE owner_id=$1 AND expires_at>now() AND generation=$2",
        [owner, state.generation],
      );
      if (existing.rows[0]) {
        await db.query("COMMIT");
        return snapshotHeader(existing.rows[0]);
      }
      await db.query("DELETE FROM sync_snapshots WHERE owner_id=$1", [owner]);
      const created = await db.query<SnapshotRow>(`
        INSERT INTO sync_snapshots(owner_id,id,dataset_id,generation,watermark,expires_at)
        VALUES($1,gen_random_uuid(),$2,$3,$4,now()+interval '30 minutes')
        RETURNING *`, [owner, scope.datasetId, scope.generation, state.watermark]);
      const row = created.rows[0];
      let total = 0;
      for (const [type, spec] of Object.entries(schema)) {
        const copy = await db.query(`
          INSERT INTO sync_snapshot_rows (snapshot_id,position,entity)
          SELECT $2,row_number() OVER (ORDER BY id)+$3::bigint,${snapshotEntity(type as EntityType, spec)}
          FROM ${spec.table} WHERE owner_id=$1`, [owner, row.id, total]);
        total += copy.rowCount ?? 0;
      }
      await db.query("UPDATE sync_snapshots SET total=$2 WHERE id=$1", [row.id, total]);
      await db.query("COMMIT");
      return snapshotHeader({ ...row, total });
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  async snapshotPage(owner: string, id: string, after: string, limit: number): Promise<SnapshotPage> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const found = await db.query<SnapshotRow>(`
        SELECT s.* FROM sync_snapshots s JOIN sync_clock c ON s.owner_id=c.owner_id
        WHERE s.owner_id=$1 AND s.id=$2 AND s.expires_at>now()
          AND s.dataset_id=c.dataset_id AND s.generation=c.generation`, [owner, id]);
      const header = found.rows[0];
      if (!header) throw new Error("SNAPSHOT_EXPIRED");
      if (BigInt(after) > BigInt(header.total)) throw new Error("CURSOR_AHEAD");
      // Size-gate pages as well as row count. An unusually large single row still makes progress.
      const rows = await db.query<{ entity: AnyEntity; position: string }>(`
        SELECT entity,position FROM (
          SELECT entity,position,sum(octet_length(entity::text)) OVER (ORDER BY position) AS bytes
          FROM (SELECT entity,position FROM sync_snapshot_rows WHERE snapshot_id=$1 AND position>$2
                ORDER BY position LIMIT $3) page
        ) sized WHERE bytes<=1048576 OR position=$2::bigint+1 ORDER BY position`, [id, after, limit]);
      await db.query("COMMIT");
      const last = rows.rows.at(-1)?.position ?? after;
      return {
        ...snapshotHeader(header), records: rows.rows.map((row) => row.entity),
        nextPosition: BigInt(last) < BigInt(header.total) ? last : null,
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
