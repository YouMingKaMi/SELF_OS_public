import { useSyncExternalStore } from "react";
import type { Data } from "../data/entities.ts";

export type DocumentDraft = {
  data: Data;
  base?: { version: number; data: Data } | null;
  savedAt: number;
};

const drafts = new Map<string, DocumentDraft | undefined>();
const listeners = new Set<() => void>();
const storageKey = (key: string) => "pc-next-article-draft-" + key;
const prefix = (key: string) => storageKey(key) + "@";
const tab = (() => {
  const key = "pc-next-document-tab";
  try {
    const id = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();
const ownKey = (key: string) => prefix(key) + tab;

function decode(stored: string | null): DocumentDraft | undefined {
  if (stored === null) return undefined;
  const parsed = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object") return undefined;
  return typeof parsed.savedAt === "number" && parsed.data
    ? parsed
    : { data: parsed, savedAt: 0 }; // Existing drafts have no trustworthy base.
}

export function readDocumentDraft(key: string) {
  if (!drafts.has(key)) {
    try {
      drafts.set(key, decode(localStorage.getItem(ownKey(key)) ?? localStorage.getItem(storageKey(key))));
    } catch {
      drafts.set(key, undefined);
    }
  }
  return drafts.get(key);
}

/** Each tab owns its draft so saving or reloading one cannot clear another's edits. */
export function writeDocumentDraft(key: string, draft: Omit<DocumentDraft, "savedAt">) {
  const value = { ...draft, savedAt: Date.now() };
  drafts.set(key, value);
  listeners.forEach((listener) => listener());
  try {
    localStorage.setItem(ownKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearDocumentDraft(key: string) {
  drafts.set(key, undefined);
  try {
    localStorage.removeItem(ownKey(key));
    localStorage.removeItem(storageKey(key));
  } catch {
    // The article is already durable in the outbox even if storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function anotherDocumentDraft(key: string) {
  try {
    return Object.keys(localStorage)
      .filter((item) => item.startsWith(prefix(key)) && item !== ownKey(key))
      .map((item) => decode(localStorage.getItem(item)))
      .sort((a, b) => (b?.savedAt ?? 0) - (a?.savedAt ?? 0))[0];
  } catch {
    return undefined;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDocumentDraft(key: string) {
  return useSyncExternalStore(subscribe, () => readDocumentDraft(key));
}
