/**
 * One-way import from the original personal-council app into the new system.
 *
 *   node tools/migration/import-legacy.ts <state-export.json> [--owner personal] [--dry-run]
 *
 * Input: the original app's own read-only export (GET /api/state?space=main).
 * Every record goes through the normal SyncService, so every schema and business rule applies.
 * Ids are derived from the original ids. Re-runs compare the source and the last imported
 * fingerprint before changing an existing row. Writes a count-only reconciliation report
 * (no record text) next to the export file.
 *
 * Isolated by design: nothing in the running system imports this file, and it holds no data.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compose } from "../../services/api/compose.ts";
import type { AnyEntity, Data, EntityType } from "../../packages/contracts/entities.ts";
import { fingerprint, importAction, orderImport, type ImportFingerprint } from "./import-plan.ts";

type Any = Record<string, any>;
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("Usage: node tools/migration/import-legacy.ts <state.json> [--owner name] [--dry-run]");
const owner = args.includes("--owner") ? args[args.indexOf("--owner") + 1] : "personal";
const dryRun = args.includes("--dry-run");
const raw = readFileSync(file, "utf8");
const exported = JSON.parse(raw);
const state: Any = exported.state;
const snapshot = createHash("sha256").update(raw).digest("hex").slice(0, 16);

// ---------- helpers ----------
const uid = (kind: string, old: string) => {
  const h = createHash("sha256").update("legacy:" + kind + ":" + old).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${"89ab"[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const shanghai = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (value: unknown): string | undefined => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? shanghai.format(new Date(t)) : undefined;
};
const iso = (value: unknown) => {
  const t = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};
/** A calendar day as an instant at noon Shanghai, for facts known only to the day. */
const noon = (day: string) => day + "T04:00:00.000Z";
const decimal = (v: unknown) =>
  typeof v === "number" ? String(v) : typeof v === "string" && /^-?\d{1,18}(\.\d{1,12})?$/.test(v.trim()) ? v.trim() : undefined;
const clean = (data: Data): Data => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ""));
const live = (x: Any) => !x.deleted && !x.trashed;

const records: { type: EntityType; id: string; data: Data }[] = [];
const notes: string[] = [];
const skipped: Record<string, number> = {};
const skip = (what: string, n = 1) => (skipped[what] = (skipped[what] ?? 0) + n);
const add = (type: EntityType, old: string, data: Data) => {
  const id = uid(type, old);
  records.push({ type, id, data: clean(data) });
  return id;
};

// ---------- practice ----------
const adv = state.advancement;
const focus = new Set<string>(adv.workbench?.focusDomainIds ?? []);
const domainIds = new Map<string, string>();
adv.domains.forEach((d: Any, i: number) => {
  domainIds.set(d.id, add("domain", d.id, { name: d.name, focused: focus.has(d.id), order: i, goal: d.goal || undefined }));
});
const activityIds = new Map<string, string>();
for (const a of adv.activities) {
  if (!domainIds.has(a.domainId)) { skip("activity without domain"); continue; }
  activityIds.set(a.id, add("activity", a.id, { domainId: domainIds.get(a.domainId)!, name: a.name, archived: !!a.archived }));
}
const progressStatus: Record<string, string> = { active: "active", open: "pending", pending: "pending", resolved: "resolved", done: "resolved", completed: "resolved", closed: "resolved", abandoned: "discarded", discarded: "discarded" };
const problemIds = new Map<string, string>();
const problemDomain = new Map<string, string>();
for (const p of adv.issues) {
  if (!live(p)) { skip("deleted problem"); continue; }
  const note = [p.body, p.conclusion ? "结论：" + p.conclusion : "", p.next ? "下一步：" + p.next : ""].filter(Boolean).join("\n\n");
  problemIds.set(p.id, add("problem", p.id, {
    domainId: domainIds.get(p.domainId)!, title: p.title, status: progressStatus[p.status] ?? "pending", focused: false, note,
  }));
  problemDomain.set(p.id, p.domainId);
}
const plans = adv.plans.filter(live);
const planIds = new Map<string, string>(plans.map((p: Any) => [p.id, uid("solution", p.id)]));
for (const p of plans) {
  if (!problemIds.has(p.problemId)) { skip("solution without problem"); continue; }
  add("solution", p.id, {
    problemId: problemIds.get(p.problemId)!, parentId: p.parentId && planIds.has(p.parentId) ? planIds.get(p.parentId) : undefined,
    title: p.title, status: progressStatus[p.status] ?? "pending", reason: p.body || undefined,
  });
}
skip("deleted solution", adv.plans.length - plans.length);
// A record keeps its problem/solution only when they sit on its own branch.
const place = (x: Any) => {
  const problem = x.problemId && problemIds.has(x.problemId) && problemDomain.get(x.problemId) === x.domainId ? x.problemId : undefined;
  const plan = problem && x.planId && planIds.has(x.planId) && plans.find((p: Any) => p.id === x.planId)?.problemId === problem ? x.planId : undefined;
  if (x.problemId && !problem) notes.push("一条记录的问题不在同一领域，已保留在领域下");
  return {
    domainId: domainIds.get(x.domainId)!, activityId: x.activityId ? activityIds.get(x.activityId) : undefined,
    problemId: problem ? problemIds.get(problem) : undefined, solutionId: plan ? planIds.get(plan) : undefined,
  };
};
let legacySeconds = 0;
for (const s of adv.sessions) {
  if (!live(s) || !domainIds.has(s.domainId)) { skip("deleted session"); continue; }
  const segments = (s.segments ?? []).filter((g: Any) => g.end > g.start).map((g: Any) => iso(g.start) + "/" + iso(g.end));
  if (!s.cancelled) legacySeconds += (s.durationMs ?? 0) / 1000;
  add("session", s.id, {
    ...place(s), title: s.title || "推进", day: s.date ?? dayOf(s.endedAt), status: s.cancelled ? "cancelled" : "finished",
    startedAt: s.segments?.[0] ? iso(s.segments[0].start) : undefined, endedAt: iso(s.endedAt),
    elapsedSeconds: Math.round((s.durationMs ?? 0) / 1000), manual: !!s.manual, segments, note: s.note || undefined,
  });
}
for (const u of adv.updates) {
  if (!live(u) || !domainIds.has(u.domainId)) { skip("deleted progress"); continue; }
  add("progress", u.id, { ...place(u), day: u.date ?? dayOf(u.createdAt), body: u.body });
}

// ---------- chronicle ----------
const complete = new Set(Object.entries(state.chronicle.days ?? {}).filter(([, v]: any) => v?.complete).map(([k]) => k));
for (const e of state.chronicle.events) {
  if (!live(e)) { skip("deleted chronicle event"); continue; }
  const through = e.endDate && e.endDate !== e.date ? `（持续到 ${Number(e.endDate.slice(5, 7))}月${Number(e.endDate.slice(8))}日）` : "";
  add("journal", e.id, { kind: "chronicle", day: e.date, body: e.text + through, complete: complete.has(e.date) });
}

// ---------- notes: classified by where they lived ----------
const folders = new Map<string, Any>(state.folders.map((f: Any) => [f.id, f]));
const ancestry = (id: string | null) => {
  const out: Any[] = [];
  for (let f = id ? folders.get(id) : undefined; f && out.length < 20; f = f.parent ? folders.get(f.parent) : undefined) out.push(f);
  return out;
};
const folderDomain = new Map<string, string>(adv.domains.filter((d: Any) => d.folderId).map((d: Any) => [d.folderId, d.id]));
const docKinds: Record<string, number> = {};
for (const n of state.notes) {
  if (!live(n)) { skip("deleted or trashed note"); continue; }
  const names = ancestry(n.folder).map((f) => f.name);
  const day = dayOf(n.date) ?? dayOf(n.createdAt)!;
  const tags: string[] = (n.tags ?? []).filter((t: unknown) => typeof t === "string");
  if (n.values?.preparationChecklist) {
    const raw = n.values.preparationChecklist;
    const items = (Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [])
      .map((x: any) => (typeof x === "string" ? x : x?.text ?? x?.name ?? x?.title)).filter(Boolean);
    const list = items.length ? items : String(n.body ?? "").split("\n").map((l: string) => l.replace(/^[-*\s\[\]x]+/, "").trim()).filter(Boolean);
    add("checklist", n.id, { name: n.title, items: list });
    docKinds.checklist = (docKinds.checklist ?? 0) + 1;
    continue;
  }
  if (names.includes("想法暂存")) {
    // The original stored the idea text as both title and body; keep it once.
    const title = String(n.title ?? "").trim(), text = String(n.body ?? "").trim();
    const body = !text ? title : !title || text.startsWith(title) ? text : title + "\n" + text;
    add("idea", n.id, { body, day, status: n.values?.ideaCompleted ? "completed" : "pending" });
    docKinds.idea = (docKinds.idea ?? 0) + 1;
    continue;
  }
  if (names.includes("未加工信息原料")) {
    add("journal", "raw:" + n.id, { kind: "raw", day, body: n.body || n.title, complete: false });
    docKinds.raw = (docKinds.raw ?? 0) + 1;
    continue;
  }
  const kind = names.includes("个人思考") ? "thought" : names.includes("月报") ? "monthly" : "note";
  const domainFolder = ancestry(n.folder).find((f) => folderDomain.has(f.id));
  const domainId = kind === "note" && domainFolder ? domainIds.get(folderDomain.get(domainFolder.id)!) : undefined;
  const ai = n.aiGenerated || tags.includes("AI生成");
  const month = /^\d{4}-\d{2}$/.test(n.period ?? "") ? n.period : day.slice(0, 7);
  add("document", n.id, {
    title: n.title || "无标题", body: n.body ?? "", kind, day,
    month: kind === "monthly" ? month : undefined, domainId,
    // Provenance exists only on domain notes; elsewhere an AI label stays as a tag.
    source: domainId ? (ai ? "ai" : "unknown") : undefined,
    tags: tags.length ? tags : undefined,
  });
  docKinds[kind] = (docKinds[kind] ?? 0) + 1;
}

// ---------- tasks ----------
for (const t of state.tasks) {
  if (!live(t)) { skip("deleted task"); continue; }
  const date = dayOf(t.date);
  const kind = t.schedule === "recent" ? "recent" : t.schedule === "deadline" && t.deadline ? "deadline" : date ? "day" : "unscheduled";
  const doneDay = dayOf(t.completedDate) ?? (t.done ? date : undefined);
  if (t.done && !t.completedDate) notes.push("一条旧任务没有完成日期，按计划日期记为完成日");
  add("task", t.id, {
    title: t.title, status: t.done ? "completed" : "pending", scheduleKind: kind,
    scheduleDate: kind === "day" ? date : kind === "deadline" ? dayOf(t.deadline) : undefined,
    completedAt: t.done && doneDay ? noon(doneDay) : undefined,
  });
}

// ---------- habits ----------
const habitKind: Record<string, string> = { number: "quantity", check: "binary", checklist: "checklist" };
let habitLogs = 0;
state.habits.forEach((h: Any, i: number) => {
  const versions = [...(h.versions ?? [])].sort((a: Any, b: Any) => String(a.fromDate).localeCompare(String(b.fromDate)));
  const latest = versions.at(-1) ?? h;
  const habitId = add("habit", h.id, {
    name: h.name, kind: habitKind[latest.kind] ?? "binary", unit: latest.unit || undefined,
    items: (latest.items ?? []).map((x: Any) => x.name), status: h.enabled ? "active" : "archived", showHome: !!h.enabled, order: i,
  });
  const itemNames = new Map<string, string>();
  for (const v of versions) {
    for (const x of v.items ?? []) itemNames.set(x.id, x.name);
    if (v.policy === "atleast") notes.push("有习惯规则为『至少若干项』，新版按全部项判断完成");
    // A version without a start date starts at its first recorded day (or the habit's first).
    const days = Object.entries<Any>(h.entries ?? {}).filter(([, e]) => e.versionId === v.id).map(([d]) => d).sort();
    // "0001-01-01" in the original means "since the beginning".
    const given = dayOf(v.fromDate) && String(v.fromDate) >= "1900" ? dayOf(v.fromDate) : undefined;
    const from = given ?? days[0] ?? Object.keys(h.entries ?? {}).sort()[0] ?? "1900-01-01";
    if (!given) notes.push("有习惯规则写作『从最开始』，按该习惯第一条记录的日期生效");
    add("habitRule", v.id, {
      habitId, effectiveFrom: from, target: typeof v.target === "number" ? v.target : undefined,
      weekdays: (v.days ?? []).map(String), kind: habitKind[v.kind], unit: v.unit || undefined,
      items: (v.items ?? []).map((x: Any) => x.name),
    });
  }
  const kindOf = (versionId: string) => habitKind[versions.find((v: Any) => v.id === versionId)?.kind ?? latest.kind];
  for (const [day, entry] of Object.entries<Any>(h.entries ?? {})) {
    const kind = kindOf(entry.versionId);
    const legacy = String(entry.legacy?.raw ?? "").trim();
    let value: number | undefined = typeof entry.value === "number" ? entry.value : undefined;
    if (value === undefined && kind === "binary") value = legacy.startsWith("✅") ? 1 : legacy.startsWith("❌") ? 0 : undefined;
    if (value === undefined && kind === "quantity" && /^-?\d+(\.\d+)?/.test(legacy)) value = parseFloat(legacy);
    const status = entry.legacy?.status;
    const version = versions.find((v: Any) => v.id === entry.versionId) ?? latest;
    // "✅" on a quantity habit said "met the target" without the number: record exactly the target.
    if (value === undefined && kind === "quantity" && legacy.startsWith("✅") && typeof version.target === "number") {
      value = version.target;
      notes.push("数量习惯的旧记录只写了 ✅ 达标，没有具体数量，按当时目标值记录");
    }
    const items = kind === "checklist"
      ? Object.entries(entry.items ?? {}).filter(([, on]) => on).map(([id]) => itemNames.get(id) ?? id) : undefined;
    if (kind === "checklist" && value === undefined && items) value = items.length || undefined;
    // An explicitly incomplete checklist day is a real record with nothing ticked.
    if (kind === "checklist" && value === undefined && status === "incomplete") value = 0;
    if (value === undefined && !(items && items.length)) {
      skip(
        status === "rest" ? "habit rest day (not a record)" : status === "partial" ? "habit day partly done, items not noted"
          : status === "deferred" ? "habit day deferred" : "habit day with no value", 1);
      continue;
    }
    add("habitLog", h.id + ":" + day, {
      habitId, ruleId: versions.some((v: Any) => v.id === entry.versionId) ? uid("habitRule", entry.versionId) : undefined,
      day, value, items, hidden: false,
    });
    habitLogs++;
  }
});

// ---------- finance ----------
const ex = state.expenses;
const cats = new Map<string, Any>(ex.categories.map((c: Any) => [c.id, c]));
// The new ledger has two levels: a deeper category files under its top-level ancestor.
const topOf = (id: string): string => {
  let c = cats.get(id);
  for (let i = 0; c?.parentId && cats.has(c.parentId) && i < 10; i++) c = cats.get(c.parentId);
  return c?.id ?? id;
};
const parentOf = topOf;
const votes = new Map<string, number[]>();
for (const e of ex.entries.filter(live)) {
  const p = parentOf(e.categoryId);
  const v = votes.get(p) ?? [0, 0];
  v[e.necessity === "necessary" ? 0 : 1]++;
  votes.set(p, v);
}
for (const c of ex.categories.filter((c: Any) => !c.parentId))
  add("category", c.id, { name: c.name, necessary: (votes.get(c.id)?.[0] ?? 1) >= (votes.get(c.id)?.[1] ?? 0) });
for (const c of ex.categories.filter((c: Any) => c.parentId)) {
  if (cats.get(c.parentId)?.parentId) notes.push("三级分类按其顶级用途归档为二级");
  add("category", c.id, { name: c.name, parentId: uid("category", topOf(c.id)) });
}
const legacyMonth: Record<string, bigint> = {};
function exactMinor(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error("INVALID_LEGACY_AMOUNT");
}
for (const e of ex.entries) {
  if (!live(e)) { skip("deleted expense"); continue; }
  const cat = cats.get(e.categoryId);
  const a = e.allocation;
  const mode = !a ? "immediate" : a.fixedEndDate || a.termType === "fixed" ? "fixed" : "estimated";
  const start = a?.startDate ?? e.date;
  const end = a ? [a.fixedEndDate, a.expectedEndDate, a.endDate, start].find(Boolean) : undefined;
  const month = e.date.slice(0, 7);
  legacyMonth[month] = (legacyMonth[month] ?? 0n) + exactMinor(e.amountCents) - exactMinor(a?.resaleCents ?? 0);
  add("expense", e.id, {
    title: e.title, day: e.date, amountMinor: String(e.amountCents),
    categoryId: cat ? uid("category", parentOf(e.categoryId)) : undefined,
    subcategoryId: cat?.parentId ? uid("category", e.categoryId) : undefined,
    necessary: e.necessity === "necessary", mode,
    startDay: a ? start : undefined, endDay: a ? (end! < start ? start : end) : undefined,
    endedDay: a?.endDate && a.endDate !== end ? a.endDate : a?.endDate && a.fixedEndDate ? a.endDate : undefined,
    recoveryMinor: a?.resaleCents ? String(a.resaleCents) : undefined, recoveryDay: a?.resaleDate,
  });
}
for (const [month, budget] of Object.entries<Any>(ex.budgets ?? {}))
  if (typeof budget?.total === "number") add("budget", month, { month, amountMinor: String(Math.round(budget.total)) });
for (const f of ex.fixedCharges) {
  if (f.deleted) { skip("deleted fixed charge"); continue; }
  add("recurringExpense", f.id, {
    name: f.title, amountMinor: String(f.amountCents), categoryId: cats.has(f.categoryId) ? uid("category", parentOf(f.categoryId)) : undefined,
    active: !!f.enabled,
  });
}

// ---------- treasury ----------
const tr = state.treasury;
const assets = new Map<string, Any>(tr.assets.map((a: Any) => [a.id, a]));
const assetKind: Record<string, string> = { cash: "cny", investment: "external", crypto: "crypto", other: "stock", stock: "stock" };
const walletIds = new Map<string, string>();
for (const acc of tr.accounts) {
  if (acc.archived) { skip("archived account"); continue; }
  const asset = assets.get(acc.assetId) ?? {};
  walletIds.set(acc.id, add("wallet", acc.id, {
    name: acc.name, category: assetKind[asset.category] ?? "external", asset: asset.name, currency: "CNY",
    unitPrice: decimal(asset.priceCny), exchangeRate: "1",
  }));
}
const lastQty = new Map<string, string>();
for (const change of [...tr.changes].sort((a: Any, b: Any) => String(a.at).localeCompare(String(b.at)))) {
  for (const acc of change.after?.accounts ?? []) {
    if (!walletIds.has(acc.id)) continue;
    const qty = decimal(acc.amount);
    if (qty === undefined || lastQty.get(acc.id) === qty) continue;
    lastQty.set(acc.id, qty);
    add("walletEntry", change.id + ":" + acc.id, { walletId: walletIds.get(acc.id)!, mode: "set", quantity: qty, at: iso(change.at), reason: change.label });
  }
}
for (const acc of tr.accounts) {
  const qty = decimal(acc.amount);
  if (!walletIds.has(acc.id) || qty === undefined || lastQty.get(acc.id) === qty) continue;
  const at = iso(acc.updatedAt) ?? iso(exported.exportedAt);
  if (!at) { skip("wallet final balance without observation date"); continue; }
  add("walletEntry", "final:" + acc.id, { walletId: walletIds.get(acc.id)!, mode: "set", quantity: qty, at, reason: "迁移时余额" });
}

// ---------- metrics, important days ----------
for (const m of state.dailyMetrics.definitions) {
  if (m.archived) { skip("archived metric"); continue; }
  add("metric", m.id, { name: m.name, unit: m.unit, minimum: m.min, maximum: m.max });
}
for (const r of state.dailyMetrics.records ?? []) skip("metric record (none expected)");
const repeat: Record<string, string> = { none: "once", once: "once", weekly: "weekly", monthly: "monthly", yearly: "yearly" };
for (const d of state.importantDates) {
  if (d.deleted) { skip("deleted important day"); continue; }
  const pad = (n: number) => String(n).padStart(2, "0");
  add("importantDay", d.id, {
    name: d.title, calendar: d.calendar === "lunar" ? "lunar" : "solar",
    date: d.calendar === "lunar" ? undefined : `${d.year}-${pad(d.month)}-${pad(d.day)}`,
    lunarYear: d.calendar === "lunar" ? d.year : undefined, lunarMonth: d.calendar === "lunar" ? d.month : undefined,
    lunarDay: d.calendar === "lunar" ? d.day : undefined, leap: !!d.leap, repeat: repeat[d.repeat] ?? "once",
    intervalUnit: "year", remindDays: d.remindDays ?? 3, dismissedDate: d.dismissedOccurrence || undefined,
  });
  if (!d.enabled) notes.push("有一个停用的重要日子按普通日子导入");
}
skip("writing template (no equivalent yet)", state.templates.length);
skip("writing reminder rule (no equivalent yet)", state.rules.length);
skip("feature request", state.requests.length);

// ---------- import ----------
const order: EntityType[] = [
  "domain", "activity", "problem", "solution", "session", "progress", "category", "budget", "expense", "recurringExpense",
  "wallet", "walletEntry", "habit", "habitRule", "habitLog", "journal", "idea", "document", "metric", "importantDay", "task", "checklist",
];
const scope = createHash("sha256").update(JSON.stringify([owner, process.env.DATABASE_URL ?? "local-default"])).digest("hex").slice(0, 20);
const manifestFile = path.join(path.dirname(path.resolve(file)), `.legacy-import-${scope}.jsonl`);
const manifest = new Map<string, ImportFingerprint>();
let incompleteTailAt: number | undefined;
if (existsSync(manifestFile)) {
  const content = readFileSync(manifestFile, "utf8");
  const lines = content.trimEnd().split("\n").filter(Boolean);
  for (const [index, line] of lines.entries()) {
    try {
      const { id, source, target, snapshot } = JSON.parse(line);
      if ([id, source, target, snapshot].every((part) => typeof part === "string"))
        manifest.set(id, { source, target, snapshot });
    } catch (error) {
      // A killed writer can leave an incomplete final line. Its record is reconciled from the target.
      if (index !== lines.length - 1) throw error;
      incompleteTailAt = Buffer.byteLength(content.slice(0, content.lastIndexOf(line)));
      notes.push("导入指纹日志末条不完整，保留已有目标记录供核对");
    }
  }
}
const remember = (id: string, entry: ImportFingerprint) => {
  if (dryRun) return;
  const previous = manifest.get(id);
  if (previous?.source === entry.source && previous.target === entry.target) return;
  if (incompleteTailAt !== undefined) {
    truncateSync(manifestFile, incompleteTailAt);
    incompleteTailAt = undefined;
  }
  appendFileSync(manifestFile, JSON.stringify({ id, ...entry }) + "\n", { mode: 0o600, flush: true });
  manifest.set(id, entry);
};
const result = { created: 0, updated: 0, unchanged: 0, conflicts: [] as { type: EntityType; row: string }[], failed: [] as string[] };
const { pool, sync } = await compose(process.env.DATABASE_URL);
try {
  const existing = new Map<string, AnyEntity>();
  for (let cursor = "0"; ; ) {
    const page = await sync.changes(owner, cursor, 500);
    for (const c of page.changes) existing.set(c.entity.id, c.entity);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  const plan = orderImport(records, existing);
  result.failed.push(...plan.failed);
  for (const r of plan.ordered) {
    const current = existing.get(r.id);
    const decision = importAction(r, current, manifest.get(r.id));
    const source = fingerprint(r.type, r.data);
    if (decision === "conflict") {
      result.conflicts.push({ type: r.type, row: r.id });
      continue;
    }
    if (decision === "unchanged") {
      result.unchanged++;
      remember(r.id, { source, target: fingerprint(r.type, current!.data), snapshot });
      continue;
    }
    if (dryRun) { decision === "update" ? result.updated++ : result.created++; continue; }
    try {
      const receipt = await sync.execute(owner, "legacy-import", {
        operationId: randomUUID(), entityId: r.id, entityType: r.type, baseVersion: current?.version ?? 0,
        action: "put", data: r.data, occurredAt: new Date().toISOString(),
      });
      if (receipt.outcome === "accepted") {
        remember(r.id, { source, target: fingerprint(r.type, receipt.entity.data), snapshot });
        current ? result.updated++ : result.created++;
      }
      else result.failed.push(`${r.type}: conflict`);
    } catch (error) {
      result.failed.push(`${r.type}: ${(error as Error).message}`);
    }
  }
  // ---------- reconciliation (counts and sums only) ----------
  const after = new Map<string, AnyEntity>();
  for (let cursor = "0"; ; ) {
    const page = await sync.changes(owner, cursor, 500);
    for (const c of page.changes) after.set(c.entity.id, c.entity);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  const mine = records.map((r) => after.get(r.id)).filter((e): e is AnyEntity => !!e && !e.deleted);
  const count = (t: string) => mine.filter((e) => e.type === t).length;
  const newMonth: Record<string, bigint> = {};
  for (const e of mine.filter((e) => e.type === "expense"))
    newMonth[String(e.data.day).slice(0, 7)] = (newMonth[String(e.data.day).slice(0, 7)] ?? 0n) + exactMinor(e.data.amountMinor) - exactMinor(e.data.recoveryMinor ?? 0);
  const newSeconds = mine.filter((e) => e.type === "session" && e.data.status !== "cancelled").reduce((n, e) => n + Number(e.data.elapsedSeconds ?? 0), 0);
  const finalQty = tr.accounts.filter((a: Any) => !a.archived).map((a: Any) => {
    const entries = mine.filter((e) => e.type === "walletEntry" && e.data.walletId === walletIds.get(a.id)).sort((x, y) => String(x.data.at).localeCompare(String(y.data.at)));
    return decimal(a.amount) === undefined || entries.at(-1)?.data.quantity === decimal(a.amount);
  });
  const report = {
    snapshot, owner, dryRun, sourceRevision: exported.revision, generatedAt: new Date().toISOString(),
    result: { ...result, failed: result.failed.length, failures: [...new Set(result.failed)] },
    counts: Object.fromEntries(order.map((t) => [t, { planned: records.filter((r) => r.type === t).length, present: count(t) }])),
    documentsByKind: docKinds,
    checks: {
      expenseMonthsMatch: Object.keys(legacyMonth).every((m) => legacyMonth[m] === newMonth[m]),
      expenseByMonthMinor: Object.fromEntries(Object.keys(legacyMonth).sort().map((m) => [m, { legacy: String(legacyMonth[m]), new: String(newMonth[m] ?? 0n) }])),
      sessionSeconds: { legacy: Math.round(legacySeconds), new: newSeconds },
      walletFinalBalancesMatch: `${finalQty.filter(Boolean).length}/${finalQty.length}`,
      habitLogs, chronicleEvents: count("journal") - (docKinds.raw ?? 0),
    },
    skipped, notes: [...new Set(notes)],
  };
  const out = path.join(path.dirname(path.resolve(file)), `reconciliation-${dryRun ? "dry-run" : "import"}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ result: report.result, checks: { ...report.checks, expenseByMonthMinor: undefined }, report: out }, null, 2));
} finally {
  await pool.end();
}
