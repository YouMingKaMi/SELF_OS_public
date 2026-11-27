import assert from "node:assert/strict";
import test from "node:test";
import type { AnyEntity } from "../../packages/contracts/entities.ts";
import { planJournalTransfer } from "../../apps/web/src/data/journal-transfer.ts";

const idea: AnyEntity = {
  id: "source", type: "idea", version: 3, deleted: false,
  updatedAt: "2026-11-25T02:00:00Z",
  data: { body: "留😀移后", day: "2026-10-31", status: "completed" },
};

test("idea transfer takes only the selected text and uses the recorded day", () => {
  const [source, target] = planJournalTransfer(idea, "target", { start: 1, end: 4 });
  assert.equal(source.baseVersion, 3);
  assert.equal(source.action, "patch");
  assert.deepEqual(source.data, { body: "留后" });
  assert.deepEqual(target, {
    id: "target", type: "journal", action: "put", baseVersion: 0,
    data: { body: "😀移", day: "2026-10-31", kind: "raw", complete: false },
  });
  assert.throws(() => planJournalTransfer(idea, "target", { start: 2, end: 4 }), /INVALID_TRANSFER_SELECTION/);
});

test("a whole raw note becomes a pending idea, retaining its original date", () => {
  const raw: AnyEntity = { ...idea, type: "journal", data: {
    body: "录音转写\n", day: "2026-10-31", kind: "raw", complete: true,
  } };
  const [source, target] = planJournalTransfer(raw, "other");
  assert.equal(source.action, "delete");
  assert.deepEqual(target.data, { body: "录音转写\n", day: "2026-10-31", status: "pending" });
  assert.throws(() => planJournalTransfer({ ...raw, data: { ...raw.data, kind: "chronicle" } }, "other"));
  assert.throws(() => planJournalTransfer({ ...raw, data: { ...raw.data, body: "x".repeat(100_001) } }, "other"), /TRANSFER_TOO_LONG/);
});
