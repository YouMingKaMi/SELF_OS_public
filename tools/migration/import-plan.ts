import { createHash } from "node:crypto";
import { schema, type AnyEntity, type Data, type EntityType } from "../../packages/contracts/entities.ts";

export type ImportRow = { id: string; type: EntityType; data: Data };
export type ImportFingerprint = { source: string; target: string; snapshot: string };

export function fingerprint(type: EntityType, data: Data): string {
  const fields = Object.entries(data).filter(([key]) => type !== "task" || key !== "createdAt").sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function importAction(row: ImportRow, current: AnyEntity | undefined, prior?: ImportFingerprint) {
  if (!current) return prior ? "conflict" : "create";
  if (current.deleted || current.type !== row.type) return "conflict";
  const source = fingerprint(row.type, row.data);
  const target = fingerprint(current.type, current.data);
  if (source === target || (prior?.source === source && prior.target === target)) return "unchanged";
  if (prior && prior.source !== source && prior.target === target) return "update";
  return "conflict";
}

/** Visit only the declared references. Unresolvable rows stay out of the execution plan. */
export function orderImport(rows: readonly ImportRow[], existing: ReadonlyMap<string, AnyEntity>) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const duplicateIds = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) duplicateIds.add(row.id);
    seen.add(row.id);
  }
  const state = new Map<string, "visiting" | "valid" | "invalid">();
  const ordered: ImportRow[] = [];
  const failed: string[] = [];
  const visit = (row: ImportRow): boolean => {
    const prior = state.get(row.id);
    if (prior === "valid" || prior === "invalid") return prior === "valid";
    const fail = (reason: string) => {
      if (state.get(row.id) !== "invalid") failed.push(`${row.type}: ${reason}`);
      state.set(row.id, "invalid");
      return false;
    };
    if (prior === "visiting") return fail("reference cycle");
    if (duplicateIds.has(row.id)) return fail("duplicate source ID");
    state.set(row.id, "visiting");
    for (const [name, field] of Object.entries(schema[row.type].fields)) {
      if (field.kind !== "ref") continue;
      const key = row.data[name];
      if (key === undefined && !field.required) continue;
      if (typeof key !== "string") return fail(`missing reference ${name}`);
      const planned = byId.get(key);
      const saved = existing.get(key);
      if (planned) {
        if (planned.type !== field.target || !visit(planned)) return fail(`invalid reference ${name}`);
      } else if (!saved || saved.deleted || saved.type !== field.target) {
        return fail(`missing reference ${name}`);
      }
    }
    state.set(row.id, "valid");
    ordered.push(row);
    return true;
  };
  for (const row of rows) visit(row);
  return { ordered, failed };
}
