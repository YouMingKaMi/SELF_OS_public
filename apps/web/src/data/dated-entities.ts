import { useEffect, useState } from "react";
import type { AnyEntity, EntityType } from "../../../../packages/contracts/entities.ts";
import { database, project, type Pending } from "./db.ts";
import { subscribe } from "./store.ts";

/** Read the indexed interval and overlay unsynchronized edits, including moved records. */
async function readRange(types: EntityType[], from: string, through: string) {
  if (from > through) return [];
  const db = await database;
  const tx = db.transaction(["confirmed", "pending"], "readonly");
  const confirmed = tx.objectStore("confirmed");
  const byDay = confirmed.index("typeDay");
  const selected = new Set(types);
  const [buckets, pending] = await Promise.all([
    Promise.all(types.map((type) =>
      byDay.getAll(IDBKeyRange.bound([type, from], [type, through])),
    )),
    tx.objectStore("pending").getAll(),
  ]);
  const edits = new Map<string, Pending[]>();
  for (const operation of pending) {
    if (!selected.has(operation.entityType)) continue;
    const list = edits.get(operation.entityId) ?? [];
    list.push(operation);
    edits.set(operation.entityId, list);
  }
  const rows = new Map(buckets.flat().map((entity) => [entity.id, entity]));
  await Promise.all([...edits.keys()].map(async (id) => {
    if (rows.has(id)) return;
    const entity = await confirmed.get(id);
    if (entity) rows.set(id, entity);
  }));
  await tx.done;
  const visible: AnyEntity[] = [];
  for (const id of new Set([...rows.keys(), ...edits.keys()])) {
    const entity = project(rows.get(id), (edits.get(id) ?? []).sort((a, b) => a.sequence - b.sequence));
    const day = entity?.data.day;
    if (entity && !entity.deleted && typeof day === "string" && day >= from && day <= through) {
      visible.push(entity);
    }
  }
  return visible;
}

export function useDatedEntities(from: string, through: string, ...types: EntityType[]) {
  const scope = types.join(",");
  const key = JSON.stringify([scope, from, through]);
  const [result, setResult] = useState<{ key: string; rows: AnyEntity[] }>();
  useEffect(() => {
    let revision = 0;
    const selected = scope.split(",").filter(Boolean) as EntityType[];
    function refresh() {
      const request = ++revision;
      void readRange(selected, from, through)
        .then((rows) => { if (request === revision) setResult({ key, rows }); })
        .catch((error: unknown) => console.error("Unable to read local dated entities", error));
    }
    const unsubscribe = subscribe(selected, refresh, false);
    refresh();
    return () => {
      revision++;
      unsubscribe();
    };
  }, [scope, from, through, key]);
  return result?.key === key ? result.rows : EMPTY;
}

const EMPTY: AnyEntity[] = [];
