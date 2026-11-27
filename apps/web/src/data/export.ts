import type { AnyEntity } from "../../../../packages/contracts/entities.ts";
import { database, project } from "./db.ts";
import { indexPending, subscribe } from "./store.ts";

type Write = (chunk: string) => void | Promise<void>;
export type WorkspaceOverview = {
  live: number;
  deleted: number;
  trash: AnyEntity[];
};
const pageSize = 24;

/** Visit one consistent projection of local records and ordinary pending edits. */
async function visitSnapshot(
  visit: (records: AnyEntity[]) => void | Promise<void>,
) {
  const db = await database;
  const tx = db.transaction(["confirmed", "pending"], "readonly");
  const done = tx.done;
  // Handle a database failure even when the caller is waiting on the file sink.
  void done.catch(() => {});
  const confirmed = tx.objectStore("confirmed");

  async function deliver(records: AnyEntity[]) {
    const writing = visit(records);
    if (!writing) return;
    let waiting = true;
    async function holdSnapshot() {
      // A transaction would otherwise commit while the file writer crosses browser tasks.
      while (waiting) await confirmed.getKey("");
    }
    await Promise.all([
      writing.finally(() => {
        waiting = false;
      }),
      holdSnapshot(),
    ]);
  }

  try {
    const operations = indexPending(await tx.objectStore("pending").getAll());
    let range: IDBKeyRange | undefined;
    for (;;) {
      const page = await confirmed.getAll(range, pageSize);
      const projected = page.map((record) => {
        const visible =
          project(record, operations.get(record.id) ?? []) ?? record;
        operations.delete(record.id);
        return visible;
      });
      if (projected.length) await deliver(projected);
      if (page.length < pageSize) break;
      range = IDBKeyRange.lowerBound(page[page.length - 1].id, true);
    }
    const pendingOnly: AnyEntity[] = [];
    for (const edits of operations.values()) {
      const record = project(undefined, edits);
      if (!record) continue;
      pendingOnly.push(record);
      if (pendingOnly.length < pageSize) continue;
      await deliver(pendingOnly);
      pendingOnly.length = 0;
    }
    if (pendingOnly.length) await deliver(pendingOnly);
    await done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* A failing database request may have already aborted it. */
    }
    await done.catch(() => {});
    throw error;
  }
}

export async function readWorkspaceOverview(
  includeTrash: boolean,
): Promise<WorkspaceOverview> {
  const result: WorkspaceOverview = { live: 0, deleted: 0, trash: [] };
  await visitSnapshot((records) => {
    for (const record of records) {
      if (record.deleted) {
        result.deleted++;
        if (includeTrash) result.trash.push(record);
      } else result.live++;
    }
  });
  return result;
}

export function subscribeWorkspaceOverview(listener: () => void) {
  return subscribe(["entities"], listener);
}

/** Emit format 1 JSON incrementally to a local download destination. */
export async function writeWorkspaceExport(write: Write) {
  const exportedAt = new Date().toISOString();
  await write(
    '{"format":"personal-council-next","version":1,"exportedAt":' +
      JSON.stringify(exportedAt) +
      ',"entities":[\n',
  );
  let separator = "";
  await visitSnapshot(async (records) => {
    let chunk = "";
    for (const record of records) {
      chunk += separator + JSON.stringify(record);
      separator = ",\n";
      if (chunk.length >= 262_144) {
        await write(chunk);
        chunk = "";
      }
    }
    if (chunk) await write(chunk);
  });
  await write("\n]}\n");
}
