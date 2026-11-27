import {
  DocumentSearchIndex,
  type SearchDocument,
} from "../../../../modules/documents/index.ts";

export type DocumentSearchRequest = {
  requestId: number;
  updated: SearchDocument[];
  removed: string[];
  query: string;
};
export type DocumentSearchReply = { requestId: number; ids: string[] };

const index = new DocumentSearchIndex();
globalThis.addEventListener(
  "message",
  (event: MessageEvent<DocumentSearchRequest>) => {
    const { requestId, updated, removed, query } = event.data;
    for (const id of removed) index.remove(id);
    for (const row of updated) index.upsert(row);
    const reply: DocumentSearchReply = { requestId, ids: index.find(query) };
    globalThis.postMessage(reply);
  },
);
