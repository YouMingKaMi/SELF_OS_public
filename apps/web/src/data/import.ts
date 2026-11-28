import { entityTypes, spec, type EntityType } from "../../../../packages/contracts/schema.ts";
import type { FieldSpec } from "../../../../packages/contracts/fields.ts";
import type { AnyEntity, Data, Value } from "../../../../packages/contracts/entities.ts";
import { fieldPatch } from "../../../../packages/contracts/edit.ts";
import { database } from "./db.ts";
import { isLocalMode } from "./local-mode.ts";
import { readAll, replaceConfirmed } from "./store.ts";
import { enqueue } from "./sync.ts";

export type ParsedWorkspaceBackup = {
  exportedAt: string;
  entities: AnyEntity[];
  liveCount: number;
  deletedCount: number;
  byType: Record<string, number>;
  skippedInvalid: number;
};
export type ImportStrategy = "merge" | "replace";
export type ImportResult = { imported: number; updated: number; skipped: number; mode: "local" | "remote" };

const maxBackupBytes = 64 * 1024 * 1024;
const knownTypes = new Set<string>(entityTypes);

function exceedsBackupSize(text: string): boolean {
  if (text.length > maxBackupBytes) return true;
  if (text.length * 3 <= maxBackupBytes) return false;
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > maxBackupBytes) return true;
  }
  return false;
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return undefined;
  return value as Record<string, unknown>;
}

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && !!value.trim();
}

function validField(field: FieldSpec, value: unknown): value is Value {
  switch (field.kind) {
    case "string": return typeof value === "string" && (!field.required || !!value.trim()) && value.length <= field.max;
    case "enum": return typeof value === "string" && field.values.includes(value);
    case "day": return typeof value === "string" && validDay(value);
    case "month": return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
    case "timestamp": return timestamp(value);
    case "money":
      return typeof value === "string" && (field.signed ? /^-?\d{1,18}$/ : /^\d{1,18}$/).test(value);
    case "decimal":
      return typeof value === "string" &&
        (field.signed ? /^-?\d{1,18}(\.\d{1,12})?$/ : /^\d{1,18}(\.\d{1,12})?$/).test(value);
    case "integer":
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= field.min && value <= field.max &&
        (field.kind === "number" || Number.isInteger(value));
    case "boolean": return typeof value === "boolean";
    case "ref": return id(value);
    case "strings": return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
}

function parseEntity(value: unknown): AnyEntity | undefined {
  const row = object(value);
  if (!row || !id(row.id) || typeof row.type !== "string" || !knownTypes.has(row.type) ||
      typeof row.deleted !== "boolean" || typeof row.version !== "number" ||
      !Number.isSafeInteger(row.version) || row.version < 0 || !timestamp(row.updatedAt))
    return undefined;
  const raw = object(row.data);
  if (!raw) return undefined;
  const type = row.type as EntityType;
  const data: Data = {};
  for (const [key, field] of Object.entries(spec(type).fields)) {
    const value = Object.hasOwn(raw, key) ? raw[key] : undefined;
    if (value == null || (value === "" && field.kind !== "string")) {
      if (!row.deleted && field.required) return undefined;
    } else {
      if (!validField(field, value)) return undefined;
      data[key] = value;
    }
  }
  return { id: row.id, type, deleted: row.deleted, version: row.version, updatedAt: row.updatedAt, data };
}

function newer(incoming: AnyEntity, existing: AnyEntity): boolean {
  const difference = Date.parse(incoming.updatedAt) - Date.parse(existing.updatedAt);
  return difference > 0 || difference === 0 && incoming.version > existing.version;
}

export function parseWorkspaceImport(rawText: string): ParsedWorkspaceBackup {
  if (exceedsBackupSize(rawText)) throw new Error("备份文件超过 64 MiB");
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); }
  catch { throw new Error("备份文件不是有效的 JSON"); }
  const backup = object(parsed);
  if (!backup || backup.format !== "personal-council-next" || backup.version !== 1 ||
      !timestamp(backup.exportedAt) || !Array.isArray(backup.entities))
    throw new Error("备份格式无效，仅支持 SELF OS v1 工作区备份");

  const records = new Map<string, AnyEntity>();
  let skippedInvalid = 0;
  for (const value of backup.entities) {
    const entity = parseEntity(value);
    if (!entity) {
      skippedInvalid++;
      continue;
    }
    const prior = records.get(entity.id);
    if (!prior || newer(entity, prior)) records.set(entity.id, entity);
  }
  if (!records.size && backup.entities.length) throw new Error("备份中没有可导入的有效记录");

  const byType: Record<string, number> = {};
  let deletedCount = 0;
  for (const entity of records.values()) {
    byType[entity.type] = (byType[entity.type] ?? 0) + 1;
    if (entity.deleted) deletedCount++;
  }
  return {
    exportedAt: backup.exportedAt,
    entities: [...records.values()],
    liveCount: records.size - deletedCount,
    deletedCount,
    byType,
    skippedInvalid,
  };
}

async function importLocal(backup: ParsedWorkspaceBackup, strategy: ImportStrategy): Promise<ImportResult> {
  const db = await database;
  const tx = db.transaction(["confirmed", "pending", "meta"], "readwrite");
  const confirmed = tx.objectStore("confirmed");
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, mode: "local" };
  try {
    if (strategy === "replace") {
      await confirmed.clear();
      await tx.objectStore("pending").clear();
      const meta = tx.objectStore("meta");
      await meta.delete("cursor");
      await meta.delete("scope");
    }
    for (const entity of backup.entities) {
      if (strategy === "replace") {
        await confirmed.put({ ...entity, version: Math.max(1, entity.version) });
        result.imported++;
        continue;
      }
      const existing = await confirmed.get(entity.id);
      if (!existing) {
        await confirmed.put(entity);
        result.imported++;
      } else if (newer(entity, existing)) {
        await confirmed.put({ ...entity, version: Math.max(existing.version + 1, entity.version) });
        result.updated++;
      } else {
        result.skipped++;
      }
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* IndexedDB may have aborted the transaction itself. */ }
    await tx.done.catch(() => {});
    throw error;
  }
  await replaceConfirmed(true);
  return result;
}

function* dependencies(entity: AnyEntity, byId: ReadonlyMap<string, AnyEntity>): Generator<AnyEntity, void> {
  for (const [key, field] of Object.entries(spec(entity.type).fields)) {
    if (field.kind !== "ref") continue;
    const id = entity.data[key];
    const target = typeof id === "string" ? byId.get(id) : undefined;
    if (target?.type === field.target) yield target;
  }
  const relatedIds = entity.type === "task" ? entity.data.prerequisiteIds
    : entity.type === "achievement" ? entity.data.prevIds : undefined;
  if (!Array.isArray(relatedIds)) return;
  for (const id of relatedIds) {
    const target = byId.get(id);
    if (target?.type === entity.type) yield target;
  }
}

function dependencyOrder(entities: AnyEntity[]): AnyEntity[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const unvisited = new Set(byId.keys());
  const ordered: AnyEntity[] = [];
  // Visit IDs in lexical order so unrelated records and cycles have a repeatable order.
  for (const id of [...byId.keys()].sort()) {
    if (!unvisited.delete(id)) continue;
    const entity = byId.get(id)!;
    const stack = [{ entity, refs: dependencies(entity, byId) }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = frame.refs.next();
      if (next.done) {
        ordered.push(frame.entity);
        stack.pop();
      } else if (unvisited.delete(next.value.id)) {
        // Marking on entry skips an edge back into the active path, preserving the payload.
        stack.push({ entity: next.value, refs: dependencies(next.value, byId) });
      }
    }
  }
  return ordered;
}

export async function importWorkspaceBackup(
  backup: ParsedWorkspaceBackup,
  strategy: ImportStrategy,
): Promise<ImportResult> {
  if (isLocalMode()) return importLocal(backup, strategy);
  if (strategy === "replace")
    throw new Error("连接服务器模式下仅支持合并导入，避免误覆盖其他设备数据");

  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, mode: "remote" };
  const current = new Map((await readAll()).map((entity) => [entity.id, entity]));
  const writes: AnyEntity[] = [];
  const deletions: AnyEntity[] = [];
  for (const entity of backup.entities) {
    const existing = current.get(entity.id);
    // Version and timestamp belong to the source workspace. Compare what a command would write.
    const identical = existing && existing.type === entity.type && existing.deleted === entity.deleted &&
      (entity.deleted || Object.keys(fieldPatch(existing.data, entity.data)).length === 0);
    if (identical || (!existing && entity.deleted)) {
      result.skipped++;
      continue;
    }
    if (entity.deleted) {
      // Use the target workspace's links, since backup tombstones may omit them.
      deletions.push({ ...entity, data: existing?.data ?? entity.data });
    } else {
      writes.push(entity);
    }
  }

  for (const entity of [...dependencyOrder(writes), ...dependencyOrder(deletions).reverse()]) {
    await enqueue(entity.type, entity.id, entity.deleted ? "delete" : "put", entity.deleted ? undefined : entity.data);
    if (current.has(entity.id)) result.updated++;
    else result.imported++;
  }
  return result;
}
