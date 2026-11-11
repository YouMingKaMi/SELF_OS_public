import { useSyncExternalStore } from "react";
import type { Data } from "../data/entities.ts";

const drafts = new Map<string, Data>();
const listeners = new Set<() => void>();
const storageKey = (key: string) => "pc-next-article-draft-" + key;
function readDraft(key: string, initial: Data) {
  if (!drafts.has(key)) {
    try {
      drafts.set(
        key,
        JSON.parse(localStorage.getItem(storageKey(key)) ?? "null") ?? initial,
      );
    } catch {
      drafts.set(key, initial);
    }
  }
  return drafts.get(key)!;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function writeDocumentDraft(key: string, data: Data) {
  drafts.set(key, data);
  localStorage.setItem(storageKey(key), JSON.stringify(data));
  listeners.forEach((listener) => listener());
}
export function clearDocumentDraft(key: string) {
  drafts.delete(key);
  localStorage.removeItem(storageKey(key));
  listeners.forEach((listener) => listener());
}
export function hasDocumentDraft(key: string) {
  return localStorage.getItem(storageKey(key)) !== null;
}
/** Both workspace panes edit one local draft for the same article. */
export function useDocumentDraft(key: string, initial: Data) {
  const data = useSyncExternalStore(subscribe, () => readDraft(key, initial));
  return [data, (next: Data) => writeDocumentDraft(key, next)] as const;
}
