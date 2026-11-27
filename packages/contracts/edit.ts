import type { Data, Value } from "./entities.ts";

const legacyOptionalFields: Readonly<Record<string, readonly string[]>> = {
  domain: ["goal"],
  problem: ["note"],
  document: ["tags"],
  session: ["eventId"],
  progress: ["eventId"],
  readingItem: ["tags"],
};

/** Earlier clients omitted optional fields they did not know about. */
export function legacyPut(type: string, current: Data | undefined, next: Data): Data {
  const copy = { ...next };
  for (const key of legacyOptionalFields[type] ?? [])
    if (next[key] === undefined && current?.[key] !== undefined) copy[key] = current[key];
  return copy;
}

export function applyPatch(current: Data, patch: Data): Data {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next;
}

function equal(a: Value | null | undefined, b: Value | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => value === b[i]);
  return a === b;
}

export function fieldPatch(base: Data, edited: Data): Data {
  const patch: Data = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(edited)]))
    if (!equal(base[key], edited[key])) patch[key] = edited[key] ?? null;
  return patch;
}

export function hasFieldConflict(base: Data, current: Data, patch: Data): boolean {
  return Object.keys(patch).some(
    (key) => !equal(base[key], current[key]) && !equal(patch[key], current[key]),
  );
}
