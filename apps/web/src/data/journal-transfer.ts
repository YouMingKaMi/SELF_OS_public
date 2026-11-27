import type { AnyEntity } from "../../../../packages/contracts/entities.ts";
import type { LocalWrite } from "./command-batch.ts";

/** Half-open UTF-16 offsets into the exact source body shown to the user. */
export type TextSelection = { start: number; end: number };

export function planJournalTransfer(
  source: AnyEntity,
  destinationId: string,
  selection?: TextSelection,
): LocalWrite[] {
  const toRaw = source.type === "idea";
  if (source.deleted || (!toRaw && !(source.type === "journal" && source.data.kind === "raw")))
    throw new Error("INVALID_TRANSFER_SOURCE");
  const { body, day } = source.data;
  if (typeof body !== "string" || typeof day !== "string")
    throw new Error("INVALID_TRANSFER_SOURCE");
  const { start, end } = selection ?? { start: 0, end: body.length };
  const splitsScalar = (offset: number) =>
    body.charCodeAt(offset - 1) >= 0xd800 && body.charCodeAt(offset - 1) <= 0xdbff &&
    body.charCodeAt(offset) >= 0xdc00 && body.charCodeAt(offset) <= 0xdfff;
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end <= start || end > body.length || splitsScalar(start) || splitsScalar(end))
    throw new Error("INVALID_TRANSFER_SELECTION");

  const moved = body.slice(start, end);
  const remaining = body.slice(0, start) + body.slice(end);
  if (!moved.trim()) throw new Error("INVALID_TRANSFER_SELECTION");
  if (!toRaw && moved.length > 100_000) throw new Error("TRANSFER_TOO_LONG");

  const sourceWrite = { type: source.type, id: source.id, baseVersion: source.version };
  return [
    remaining.trim()
      ? { ...sourceWrite, action: "patch", data: { body: remaining }, editBase: source.data }
      : { ...sourceWrite, action: "delete" },
    toRaw
      ? { type: "journal", id: destinationId, action: "put", baseVersion: 0,
          data: { body: moved, day, kind: "raw", complete: false } }
      : { type: "idea", id: destinationId, action: "put", baseVersion: 0,
          data: { body: moved, day, status: "pending" } },
  ];
}

