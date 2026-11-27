import { useEffect, useState } from "react";
import type { SearchDocument } from "../../../../modules/documents/index.ts";
import type { Entity } from "../../../../packages/contracts/entities.ts";
import type {
  DocumentSearchReply,
  DocumentSearchRequest,
} from "./document-search-worker.ts";

type Documents = readonly Entity<"document">[];
type ReplyHandler = (ids?: string[]) => void;

let worker: Worker | undefined;
let previous: Documents | undefined;
let indexed = new Map<string, SearchDocument>();
let requestId = 0;
const waiting = new Map<number, ReplyHandler>();

function stopWorker() {
  worker?.terminate();
  worker = undefined;
  previous = undefined;
  indexed.clear();
  for (const fallback of waiting.values()) fallback();
  waiting.clear();
}

function loadWorker() {
  if (!worker) {
    worker = new Worker(
      new URL("./document-search-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }: MessageEvent<DocumentSearchReply>) => {
      waiting.get(data.requestId)?.(data.ids);
      waiting.delete(data.requestId);
    };
    worker.onerror = stopWorker;
    worker.onmessageerror = stopWorker;
  }
  return worker;
}

function searchDocuments(
  records: Documents,
  query: string,
  receive: ReplyHandler,
) {
  const id = ++requestId;
  waiting.set(id, receive);
  try {
    const channel = loadWorker();
    const updated: SearchDocument[] = [];
    const removed: string[] = [];
    if (previous !== records) {
      const current = new Map<string, SearchDocument>();
      for (const { id, data } of records) {
        const row = { id, title: data.title, body: data.body ?? "" };
        const old = indexed.get(id);
        if (old?.title !== row.title || old.body !== row.body)
          updated.push(row);
        current.set(id, row);
      }
      for (const key of indexed.keys())
        if (!current.has(key)) removed.push(key);
      previous = records;
      indexed = current;
    }
    const request: DocumentSearchRequest = {
      requestId: id,
      query,
      updated,
      removed,
    };
    channel.postMessage(request);
  } catch {
    stopWorker();
  }
  return () => {
    waiting.delete(id);
  };
}

type SearchResult = { records: Documents; query: string; ids: Set<string> };

/** An undefined result for a nonempty query means the current query is running. */
export function useDocumentSearch(records: Documents, query: string) {
  const [result, setResult] = useState<SearchResult>();
  useEffect(() => {
    if (!query) return;
    return searchDocuments(records, query, (ids) => {
      // Keep search usable if a browser blocks worker scripts.
      const needle = query.toLowerCase();
      const exact =
        ids ??
        records
          .filter(({ data }) =>
            (data.title + " " + (data.body ?? ""))
              .toLowerCase()
              .includes(needle),
          )
          .map(({ id }) => id);
      setResult({ records, query, ids: new Set(exact) });
    });
  }, [records, query]);
  return result?.records === records && result.query === query
    ? result.ids
    : undefined;
}
