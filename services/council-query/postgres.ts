import type pg from "pg";
import {
  schema,
  type AnyEntity,
  type EntityType,
} from "../../packages/contracts/entities.ts";
import type { EntitySpec } from "../../packages/contracts/fields.ts";
import {
  columnName,
  fromRow,
  readOwnerSnapshot,
} from "../../modules/kernel/server.ts";
import {
  documentKindBySection,
  filterRecords,
  InvalidQuery,
  timezone,
  type Reader,
  type ReadRecords,
} from "./query.ts";

const specOf = (type: EntityType): EntitySpec => schema[type];

type Day = { sql: string; kind: "date" | "text"; nullable: boolean };
const date = (sql: string, nullable = true): Day => ({
  sql,
  kind: "date",
  nullable,
});
const text = (sql: string, nullable = true): Day => ({
  sql,
  kind: "text",
  nullable,
});
const missingDay = text("NULL::text");
const localDay = (column: string, nullable: boolean) =>
  text(
    `to_char(${column} AT TIME ZONE '${timezone}', 'FMYYYY-MM-DD')`,
    nullable,
  );

function dateSpan(type: EntityType, field: ReadRecords["field"]): [Day, Day] {
  const { fields } = specOf(type);
  if (field === "updatedAt") {
    const day = localDay("updated_at", false);
    return [day, day];
  }
  if (field === "createdAt") {
    const day = fields.createdAt ? localDay("created_at", true) : missingDay;
    return [day, day];
  }
  if (field === "period" || type === "budget") {
    if (!fields.month) return [missingDay, missingDay];
    // Date.UTC treats year 00..99 as 1900..1999 when finding the last day.
    const year = "substring(month, 1, 4)::integer";
    const end = `extract(day FROM make_date(CASE WHEN ${year} < 100 THEN ${year} + 1900 ELSE ${year} END,
      substring(month, 6, 2)::integer, 1) + interval '1 month -1 day')::integer`;
    return [
      text("month || '-01'", !fields.month.required),
      text(`month || '-' || ${end}`, !fields.month.required),
    ];
  }
  if (type === "task") {
    const rangeDay = (column: string) =>
      date(
        `CASE WHEN schedule_kind='range' THEN ${column} ELSE schedule_date END`,
      );
    return [rangeDay("schedule_start"), rangeDay("schedule_end")];
  }
  const key = ["day", "date", "scheduleDate", "at"].find((key) => fields[key]);
  if (!key) return [missingDay, missingDay];
  const column = columnName(key);
  const day =
    fields[key].kind === "timestamp"
      ? localDay(column, !fields[key].required)
      : date(column, !fields[key].required);
  return [day, day];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function recordScopes(request: ReadRecords, owner: string, indexedQuery = false) {
  const values: (string | string[] | number)[] = [owner];
  const bind = (value: (typeof values)[number]) => "$" + values.push(value);
  const rangeApplies = (type: EntityType) =>
    (request.start || request.end) &&
    (request.section !== "habits" || type === "habitLog");
  // A PostgreSQL UUID is returned as lowercase canonical text. Other input still
  // counts as a requested filter, but cannot match a stored ID by exact equality.
  const ids = request.ids.filter((id) => uuid.test(id));
  const idParam = ids.length ? bind(ids) + "::uuid[]" : "";
  const someRange = request.types.some(rangeApplies);
  const start = request.start && someRange ? bind(request.start) : "";
  const end = request.end && someRange ? bind(request.end) : "";
  const needle = indexedQuery ? bind("%" + request.query + "%") : "";

  const scopes = request.types.map((type) => {
    const where = ["owner_id=$1"];
    if (!request.includeDeleted) where.push("NOT deleted");
    if (request.section === "raw_materials" || (request.section === "notes" && type === "journal"))
      where.push("kind='raw'");
    if (Object.hasOwn(documentKindBySection, request.section))
      where.push("kind=" + bind(documentKindBySection[request.section]));
    if (request.section === "chronicle" || request.section === "chronicle_days")
      where.push("kind='chronicle'");
    if (request.section === "reminders") where.push("remind_days>0");
    if (needle) {
      const fields = type === "document" ? ["title", "body", "council.search_tags(tags)"] : ["body"];
      where.push("(" + fields.map((field) => `${field} LIKE ${needle}`).join(" OR ") + ")");
    }
    if (request.ids.length) {
      if (!idParam) where.push("FALSE");
      else if (request.section === "habits" && specOf(type).fields.habitId)
        where.push(`(id=ANY(${idParam}) OR habit_id=ANY(${idParam}))`);
      else where.push(`id=ANY(${idParam})`);
    }

    const [first, last] = dateSpan(type, request.field);
    const from = `FROM ${specOf(type).table} WHERE ${where.join(" AND ")}`;
    const firstKey = `(${first.sql})::text COLLATE "C"`;
    if (!rangeApplies(type))
      return { type, from, firstKey, range: "TRUE", missing: "FALSE" };

    const nullable = [
      ...new Set(
        [first, last].filter((day) => day.nullable).map((day) => day.sql),
      ),
    ];
    const range = nullable.map((sql) => `(${sql}) IS NOT NULL`);
    const missing =
      nullable.map((sql) => `(${sql}) IS NULL`).join(" OR ") || "FALSE";
    const compare = (day: Day, op: string, param: string) =>
      day.kind === "date"
        ? `(${day.sql}) ${op} ${param}::text::date`
        : `(${day.sql}) COLLATE "C" ${op} ${param}::text`;
    if (start) range.push(compare(last, ">=", start));
    if (end) range.push(compare(first, "<=", end));
    return { type, from, firstKey, range: range.join(" AND "), missing };
  });
  return { scopes, values };
}

async function readRecordPage(
  db: pg.PoolClient,
  revision: number,
  request: ReadRecords,
  owner: string,
) {
  if (request.revision !== undefined && request.revision !== revision)
    throw new InvalidQuery("同步资料已更新，请从第一页重新查询");

  // Han-only terms have identical literal substring semantics in both engines.
  // For other terms, retain the existing case folding and value conversion.
  const indexedQuery = /^\p{Script=Han}+$/u.test(request.query) &&
    request.types.every((type) => type === "document" || type === "journal");
  if (request.query && !indexedQuery) {
    // JS String() and Unicode lowercasing define the existing substring search.
    // Keep undated candidates here so the counter is computed after that search.
    const rows: AnyEntity[] = [];
    for (const type of request.types) {
      const {
        scopes: [scope],
        values,
      } = recordScopes({ ...request, types: [type] }, owner);
      const result = await db.query(
        `SELECT * ${scope.from} AND ((${scope.range}) OR (${scope.missing}))`,
        values,
      );
      rows.push(...result.rows.map((row) => fromRow(scope.type, row)));
    }
    return filterRecords({ revision, rows }, request);
  }

  const { scopes, values } = recordScopes(request, owner, indexedQuery);
  const counts = scopes.flatMap((scope) => [
    `SELECT count(*) AS total, 0::bigint AS missing ${scope.from} AND (${scope.range})`,
    `SELECT 0::bigint AS total, count(*) AS missing ${scope.from} AND (${scope.missing})`,
  ]);
  const result = await db.query<{ total: string; missing: string }>(
    `SELECT sum(total) AS total, sum(missing) AS missing
     FROM (${counts.join(" UNION ALL ")}) counts`,
    values,
  );
  const total = Number(result.rows[0].total);
  const excludedUndated = Number(result.rows[0].missing);
  if (request.offset >= total)
    return { revision, total, excludedUndated, rows: [] };

  // Find page IDs using narrow rows before loading any documents or notes.
  const candidates = scopes.map(
    (scope) =>
      `SELECT id, '${scope.type}' AS type, ${scope.firstKey} AS day,
            date_trunc('milliseconds', updated_at) AS updated
     ${scope.from} AND (${scope.range})`,
  );
  const page = await db.query<{ id: string; type: EntityType }>(
    `SELECT id, type FROM (${candidates.join(" UNION ALL ")}) candidates
     ORDER BY day DESC NULLS LAST, updated DESC, id ASC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, request.limit, request.offset],
  );
  const byId = new Map<string, AnyEntity>();
  for (const scope of scopes) {
    const ids = page.rows
      .filter((row) => row.type === scope.type)
      .map((row) => row.id);
    if (!ids.length) continue;
    const columns =
      request.section === "chronicle_days"
        ? "id, version, deleted, updated_at, day, complete"
        : "*";
    const result = await db.query(
      `SELECT ${columns} FROM ${specOf(scope.type).table} WHERE owner_id=$1 AND id=ANY($2::uuid[])`,
      [owner, ids],
    );
    for (const row of result.rows) byId.set(row.id, fromRow(scope.type, row));
  }
  const rows = page.rows.map(({ id }) => {
    const row = byId.get(id);
    if (!row) throw new Error("Unavailable Council page record");
    return row;
  });
  return { revision, total, excludedUndated, rows };
}

export function createCouncilReader(pool: pg.Pool, owner: string): Reader {
  async function snapshot<T>(
    run: (db: pg.PoolClient, revision: number) => Promise<T>,
  ) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await db.query("SET LOCAL statement_timeout = '5s'");
      await db.query("SET LOCAL DateStyle = ISO");
      const clock = await db.query<{ revision: string }>(
        "SELECT revision FROM sync_clock WHERE owner_id=$1",
        [owner],
      );
      const revision = Number(clock.rows[0]?.revision);
      if (!Number.isSafeInteger(revision))
        throw new Error("Unavailable owner revision");
      const result = await run(db, revision);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  const read: Reader = (types, includeDeleted) =>
    readOwnerSnapshot(pool, owner, types, includeDeleted);
  read.records = (request) =>
    snapshot((db, revision) => readRecordPage(db, revision, request, owner));
  read.expenses = (start, end) =>
    snapshot(async (db, revision) => {
      const entries = await db.query(
        "SELECT * FROM expense_entries WHERE owner_id=$1 AND NOT deleted AND day BETWEEN $2 AND $3",
        [owner, start, end],
      );
      const categories = await db.query(
        "SELECT * FROM expense_categories WHERE owner_id=$1 AND NOT deleted",
        [owner],
      );
      return {
        revision,
        rows: [
          ...entries.rows.map((row) => fromRow("expense", row)),
          ...categories.rows.map((row) => fromRow("category", row)),
        ],
      };
    });
  return read;
}
