import { schema } from "../../../packages/contracts/schema.ts";
import {
  snake,
  type EntitySpec,
  type FieldSpec,
} from "../../../packages/contracts/fields.ts";

/** Storage model derived from the entity schema; the migration lock file is its JSON form. */
export type TableModel = {
  columns: Record<string, string>;
  foreignKeys: Record<string, string>;
  indexes: Record<string, string>;
};
export type StorageModel = Record<string, TableModel>;

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

function column(name: string, f: FieldSpec): string {
  const type = {
    string: "text",
    enum: "text",
    day: "date",
    month: "text",
    timestamp: "timestamptz",
    money: "bigint",
    decimal: "numeric",
    integer: "integer",
    number: "double precision",
    boolean: "boolean",
    ref: "uuid",
    strings: "jsonb",
  }[f.kind];
  const check =
    f.kind === "enum"
      ? ` CHECK (${name} IN (${f.values.map(quote).join(", ")}))`
      : f.kind === "month"
        ? ` CHECK (${name} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')`
        : "";
  return type + (f.required ? " NOT NULL" : "") + check;
}

/** `order` and friends are reserved words; every generated column is quoted. */
export const columnName = (field: string) => `"${snake(field)}"`;

export function storageModel(): StorageModel {
  const model: StorageModel = {};
  for (const spec of Object.values(schema) as EntitySpec[]) {
    const table: TableModel = { columns: {}, foreignKeys: {}, indexes: {} };
    for (const [key, f] of Object.entries(spec.fields)) {
      const name = columnName(key);
      table.columns[name] = column(name, f);
      if (f.kind === "ref") {
        const target = (schema as Record<string, EntitySpec>)[f.target].table;
        table.foreignKeys[`${spec.table}_${snake(key)}_fk`] =
          `FOREIGN KEY (owner_id, ${name}) REFERENCES ${target}(owner_id, id)`;
        table.indexes[`${spec.table}_${snake(key)}_idx`] =
          `(owner_id, ${name}) WHERE NOT deleted`;
      }
      if (f.kind === "day")
        table.indexes[`${spec.table}_${snake(key)}_idx`] =
          `(owner_id, ${name}) WHERE NOT deleted`;
    }
    model[spec.table] = table;
  }
  return model;
}

/** Protocol tables. Hand-written once; they do not depend on the entity schema. */
export const protocolSql = `CREATE TABLE sync_clock (
  owner_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE sync_receipts (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  operation_id uuid NOT NULL,
  hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'conflict')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, device_id, operation_id)
);
-- One row per entity pointing at its latest revision: the change feed is compact by construction.
CREATE TABLE sync_heads (
  owner_id text NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY (owner_id, entity_id)
);
CREATE UNIQUE INDEX sync_heads_revision_idx ON sync_heads (owner_id, revision);
`;

function createTable(name: string, table: TableModel) {
  const columns = Object.entries(table.columns).map(([c, t]) => `  ${c} ${t},`);
  return `CREATE TABLE ${name} (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
${columns.join("\n")}
  PRIMARY KEY (owner_id, id)
);
`;
}
const constraints = (name: string, table: TableModel, only?: Set<string>) =>
  [
    ...Object.entries(table.foreignKeys)
      .filter(([k]) => !only || only.has(k))
      .map(([k, v]) => `ALTER TABLE ${name} ADD CONSTRAINT ${k} ${v};\n`),
    ...Object.entries(table.indexes)
      .filter(([k]) => !only || only.has(k))
      .map(([k, v]) => `CREATE INDEX ${k} ON ${name} ${v};\n`),
  ].join("");

/**
 * SQL that moves a database from `from` to `to`. Only additive steps are generated
 * (new table, new nullable column, new key/index); anything else must be written by hand.
 */
export function diffSql(from: StorageModel, to: StorageModel): string {
  let tables = "",
    later = "";
  for (const [name, table] of Object.entries(to)) {
    const old = from[name];
    if (!old) {
      tables += createTable(name, table);
      later += constraints(name, table);
      continue;
    }
    const added = new Set<string>();
    for (const [c, type] of Object.entries(table.columns)) {
      if (old.columns[c] === type) continue;
      if (old.columns[c] !== undefined || type.includes("NOT NULL"))
        throw new Error(
          `${name}.${c}: changing a column or adding a required one is not additive; write this migration by hand, then run with --accept`,
        );
      tables += `ALTER TABLE ${name} ADD COLUMN ${c} ${type};\n`;
    }
    for (const group of ["foreignKeys", "indexes"] as const)
      for (const [k, v] of Object.entries(table[group])) {
        if (old[group][k] === undefined) added.add(k);
        else if (old[group][k] !== v)
          throw new Error(
            `${name}: ${k} changed; write this migration by hand`,
          );
      }
    later += constraints(name, table, added);
  }
  for (const name of Object.keys(from))
    if (!to[name])
      throw new Error(`${name}: dropping a table must be written by hand`);
  return tables + later;
}
