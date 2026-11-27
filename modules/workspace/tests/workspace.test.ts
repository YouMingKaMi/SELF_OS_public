import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Data } from "../../../packages/contracts/entities.ts";
import { composeRules } from "../../../services/api/compose.ts";
import { client } from "../../../tests/support.ts";
import { MemoryStore, SyncService } from "../../kernel/server.ts";
import {
  ALIASABLE_FEATURES,
  BUILTIN_DEPARTMENTS,
  TOGGLEABLE_FEATURES,
  WORKSPACE_CONFIG_ID,
  WORKSPACE_PRESETS,
  detectWorkspacePreset,
  isFeatureEnabled,
  parseAliasMap,
  stringifyAliasMap,
} from "../index.ts";

const vectors = JSON.parse(readFileSync(
  new URL("../../../fixtures/workspace-config-vectors.json", import.meta.url), "utf8",
)) as {
  presetEnabledFeatures: Record<keyof typeof WORKSPACE_PRESETS, string[]>;
  aliasCases: { raw: string | null; parsed: Record<string, string>; canonical: string | null }[];
};

function setup() {
  const sync = new SyncService(new MemoryStore(), composeRules());
  const c = client(sync, "workspace-owner");
  const put = (data: Data, id = WORKSPACE_CONFIG_ID) =>
    c.send(c.command("workspaceConfig", id, 0, data));
  const patch = (baseVersion: number, data: Data) =>
    c.send({ ...c.command("workspaceConfig", WORKSPACE_CONFIG_ID, baseVersion, data), action: "patch" });
  return { sync, c, put, patch };
}

test("workspace presets enable the specified features and compare unordered sets", () => {
  assert.deepEqual([...TOGGLEABLE_FEATURES], vectors.presetEnabledFeatures.council);
  assert.deepEqual([...ALIASABLE_FEATURES], ["home", "departments", "discover", ...TOGGLEABLE_FEATURES]);
  assert.deepEqual([...BUILTIN_DEPARTMENTS], ["执行部", "财政部", "档案库", "中科院"]);
  for (const name of ["council", "standard", "minimal"] as const) {
    const { disabledFeatures, hiddenDepartments } = WORKSPACE_PRESETS[name];
    assert.deepEqual(TOGGLEABLE_FEATURES.filter((key) => isFeatureEnabled(key, disabledFeatures)),
      vectors.presetEnabledFeatures[name]);
    assert.deepEqual(hiddenDepartments, []);
    assert.equal(detectWorkspacePreset([...disabledFeatures, ...disabledFeatures].reverse(), []), name);
  }
  assert.equal(detectWorkspacePreset(), "council");
  assert.equal(detectWorkspacePreset([], ["财政部", "财政部"]), "custom");
  assert.equal(detectWorkspacePreset(["tasks"]), "custom");
  assert.equal(detectWorkspacePreset(["future-module"]), "custom");
});

test("workspace always enables core entries and enables future modules by default", () => {
  const core = ["home", "departments", "discover", "settings"];
  for (const key of core) assert.ok(isFeatureEnabled(key, core));
  assert.ok(isFeatureEnabled("future-module"));
  assert.ok(isFeatureEnabled("future-module", TOGGLEABLE_FEATURES));
  assert.equal(isFeatureEnabled("treasury", TOGGLEABLE_FEATURES), false);
});

test("workspace alias helpers read and serialize the cross-platform vectors", () => {
  for (const { raw, parsed, canonical } of vectors.aliasCases) {
    assert.deepEqual(parseAliasMap(raw), parsed, raw ?? "");
    assert.equal(stringifyAliasMap(parsed), canonical);
    assert.deepEqual(parseAliasMap(canonical), parsed);
  }
  assert.equal(stringifyAliasMap({ home: "  首页\n", notes: "\t" }), '{"home":"首页"}');
  assert.equal(stringifyAliasMap({ home: " " }), null);
});

test("workspace config enforces the fixed singleton ID per owner", async () => {
  const { sync, c, put } = setup();
  await assert.rejects(put({}, "c0000000-0000-4000-8000-000000000002"), /INVALID_WORKSPACE_CONFIG_ID/);
  const [first, second] = await Promise.all([put({}), put({ preset: "minimal" })]);
  assert.equal(first.outcome, "accepted");
  assert.deepEqual(first.entity.data, {});
  assert.equal(second.outcome, "conflict");
  assert.deepEqual(second.current, first.entity);
  assert.deepEqual((await sync.changes(c.owner)).changes, [{ revision: "1", entity: first.entity }]);

  const other = client(sync, "other-workspace-owner");
  const separate = await other.send(other.command("workspaceConfig", WORKSPACE_CONFIG_ID, 0, { preset: "council" }));
  assert.equal(separate.outcome, "accepted");
  assert.deepEqual(separate.entity.data, { preset: "council" });
});

test("workspace config normalizes allowlisted values and keeps layout order", async () => {
  const { put, patch } = setup();
  const alias = "😀".repeat(20);
  const shortcut = "😀".repeat(30);
  const receipt = await put({
    preset: "custom",
    disabledFeatures: ["notes", "practice", "notes"],
    hiddenDepartments: ["财政部", "执行部", "财政部"],
    featureAliases: JSON.stringify({ treasury: " 资产 ", home: " ", tasks: " " + alias }),
    departmentAliases: '{"财政部":" 预算 ","档案库":"\u3000"}',
    sidebarFavorites: [" tasks ", "notes", "tasks", "   "],
    phoneShortcuts: [shortcut + "\n", " " + shortcut],
    homeCards: [" chronicle ", "chronicle", "habits"],
  });
  assert.equal(receipt.outcome, "accepted");
  assert.deepEqual(receipt.entity.data, {
    preset: "custom",
    disabledFeatures: ["notes", "practice"],
    hiddenDepartments: ["财政部", "执行部"],
    featureAliases: '{"tasks":"' + alias + '","treasury":"资产"}',
    departmentAliases: '{"财政部":"预算"}',
    sidebarFavorites: ["tasks", "notes"],
    phoneShortcuts: [shortcut],
    homeCards: ["chronicle", "habits"],
  });

  const emptyAliases = await patch(receipt.entity.version, {
    featureAliases: '{"home":" "} ',
    departmentAliases: "{}",
  });
  assert.equal(emptyAliases.outcome, "accepted");
  assert.equal(emptyAliases.entity.data.featureAliases, undefined);
  assert.equal(emptyAliases.entity.data.departmentAliases, undefined);
  assert.deepEqual(emptyAliases.entity.data.disabledFeatures, ["notes", "practice"]);
});

test("workspace config rejects protected or unknown keys and invalid alias JSON", async () => {
  const { sync, c, put } = setup();
  const alias = "😀".repeat(20) + "字";
  for (const key of ["home", "settings", "departments", "discover", "future-module", " tasks "])
    await assert.rejects(put({ disabledFeatures: [key] }), /INVALID_FIELD:disabledFeatures/);
  await assert.rejects(put({ hiddenDepartments: ["自定义部门"] }), /INVALID_FIELD:hiddenDepartments/);
  await assert.rejects(put({ preset: "unknown" }), /INVALID_FIELD:preset/);
  for (const [field, key] of [["featureAliases", "notes"], ["departmentAliases", "中科院"]] as const) {
    for (const raw of ["", "{", "[]", "null", '"string"', '{"unknown":"name"}', '{"__proto__":"name"}',
      JSON.stringify({ [key]: 42 }), JSON.stringify({ [key]: null }), JSON.stringify({ [key]: "\ud800" })])
      await assert.rejects(put({ [field]: raw }), { message: "INVALID_FIELD:" + field });
    await assert.rejects(put({ [field]: JSON.stringify({ [key]: alias }) }), { message: "TOO_LONG:" + field });
  }
  await assert.rejects(put({ featureAliases: '{"settings":"偏好"}' }), /INVALID_FIELD:featureAliases/);
  assert.deepEqual((await sync.changes(c.owner)).changes, []);
});

test("workspace config rejects more than 40 layout entries or an entry exceeding 60 UTF-16 units", async () => {
  const { put } = setup();
  for (const field of ["sidebarFavorites", "phoneShortcuts", "homeCards"]) {
    await assert.rejects(put({ [field]: Array(41).fill("tasks") }), { message: "TOO_LONG:" + field });
    await assert.rejects(put({ [field]: ["😀".repeat(30) + "字"] }), { message: "TOO_LONG:" + field });
  }
  const max = Array.from({ length: 40 }, (_, i) => String(i));
  const receipt = await put({ homeCards: max });
  assert.equal(receipt.outcome, "accepted");
  assert.deepEqual(receipt.entity.data, { homeCards: max });
});

test("workspace config patch nulls clear aliases and restore defaults in the sync feed", async () => {
  const { sync, c, put, patch } = setup();
  const original = await put({
    preset: "custom",
    disabledFeatures: ["treasury"], hiddenDepartments: ["财政部"],
    featureAliases: '{"treasury":"资产"}', departmentAliases: '{"财政部":"预算"}',
    sidebarFavorites: ["notes"],
  });
  assert.equal(original.outcome, "accepted");

  const cleared = await patch(original.entity.version, { featureAliases: null, departmentAliases: null });
  assert.equal(cleared.outcome, "accepted");
  assert.deepEqual(cleared.entity.data, {
    preset: "custom", disabledFeatures: ["treasury"], hiddenDepartments: ["财政部"],
    sidebarFavorites: ["notes"],
  });
  await assert.rejects(patch(cleared.entity.version, { featureAliases: "invalid" }), /INVALID_FIELD:featureAliases/);
  const reset = await patch(cleared.entity.version, {
    preset: null, disabledFeatures: null, hiddenDepartments: null, sidebarFavorites: null,
  });
  assert.equal(reset.outcome, "accepted");
  assert.deepEqual(reset.entity.data, {});
  assert.equal(detectWorkspacePreset(), "council");
  assert.deepEqual((await sync.changes(c.owner, cleared.revision)).changes,
    [{ revision: reset.revision, entity: reset.entity }]);
});
