import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, importAction, orderImport, type ImportRow } from "../../tools/migration/import-plan.ts";
import type { AnyEntity } from "../../packages/contracts/entities.ts";

const row = (id: string, type: ImportRow["type"], data: ImportRow["data"]): ImportRow => ({ id, type, data });
const saved = (base: ImportRow, changes = {}): AnyEntity => ({ ...base, version: 2, updatedAt: "", deleted: false, ...changes });

test("legacy import keeps edits/deletions and updates only an unchanged imported target", () => {
  const before = row("d", "domain", {name: "old"});
  const after = row("d", "domain", {name: "new source"});
  const hash = fingerprint(before.type, before.data);
  const prior = {source: hash, target: hash, snapshot: "first"};
  assert.equal(importAction(before, undefined), "create");
  assert.equal(importAction(before, saved(before)), "unchanged");
  assert.equal(importAction(after, saved(before)), "conflict");
  assert.equal(importAction(after, saved(before), prior), "update");
  assert.equal(importAction(after, saved(before, {data: {name: "user edit"}}), prior), "conflict");
  assert.equal(importAction(before, saved(before, {deleted: true}), prior), "conflict");
});

test("legacy import visits arbitrary-depth ancestors and reports cyclic or missing refs", () => {
  const domain = row("d", "domain", {name: "sample"});
  const problem = row("p", "problem", {domainId: "d", title: "sample"});
  const solution = (id: string, parentId?: string) => row(id, "solution", {problemId: "p", parentId});
  const plan = orderImport([solution("three", "two"), solution("two", "one"), solution("one"), problem, domain,
    solution("cycle-a", "cycle-b"), solution("cycle-b", "cycle-a"), solution("unknown", "absent")], new Map());
  assert.deepEqual(plan.ordered.map(({id}) => id), ["d", "p", "one", "two", "three"]);
  assert.equal(plan.failed.length, 3);
  assert.ok(plan.failed.some((reason) => reason.includes("reference cycle")));
});
