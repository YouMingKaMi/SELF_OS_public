/**
 * The single source of truth for every synchronised entity.
 * Adding or changing a field happens here, then `npm run contracts:generate`
 * and `npm run db:migration` derive everything else.
 * v1 compatibility: only optional additions; anything else needs a v2 plan.
 */
import {
  entity,
  text,
  choice,
  day,
  month,
  timestamp,
  money,
  decimal,
  integer,
  number,
  flag,
  ref,
  strings,
  type DataOf,
  type EntitySpec,
} from "./fields.ts";

const progressState = ["pending", "active", "resolved", "discarded"] as const;
const habitKind = ["binary", "quantity", "checklist"] as const;

export const schema = {
  // workspace
  department: entity("workspace", "workspace_departments", {
    name: text(true),
    features: strings,
  }),

  // practice
  domain: entity("practice", "practice_domains", {
    name: text(true),
    focused: flag,
    order: number(),
    // v1 additive: what this domain is for.
    goal: text(false, 2000),
  }),
  activity: entity("practice", "practice_activities", {
    domainId: ref("domain", true),
    name: text(true),
    archived: flag,
  }),
  problem: entity("practice", "practice_problems", {
    domainId: ref("domain", true),
    activityId: ref("activity"),
    title: text(true),
    status: choice(progressState),
    focused: flag,
    // v1 additive: the problem statement, conclusion and next step, as written.
    note: text(false, 20000),
  }),
  solution: entity("practice", "practice_solutions", {
    problemId: ref("problem", true),
    parentId: ref("solution"),
    title: text(true),
    status: choice(progressState),
    reason: text(false, 10000),
  }),
  session: entity("practice", "practice_sessions", {
    domainId: ref("domain", true),
    activityId: ref("activity"),
    problemId: ref("problem"),
    solutionId: ref("solution"),
    title: text(true),
    day: day(true),
    startedAt: timestamp(),
    endedAt: timestamp(),
    elapsedSeconds: number(),
    runningSince: timestamp(),
    status: choice(["running", "paused", "finished", "cancelled"]),
    note: text(false, 20000),
    manual: flag,
    segments: strings,
  }),
  progress: entity("practice", "practice_progress", {
    domainId: ref("domain", true),
    activityId: ref("activity"),
    problemId: ref("problem"),
    solutionId: ref("solution"),
    day: day(true),
    body: text(true, 100000),
  }),

  // tasks
  task: entity("tasks", "tasks", {
    title: text(true),
    status: choice(["pending", "completed", "discarded"]),
    scheduleKind: choice(["unscheduled", "recent", "day", "deadline", "range"]),
    scheduleDate: day(),
    scheduleStart: day(),
    scheduleEnd: day(),
    createdAt: timestamp(),
    completedAt: timestamp(),
  }),
  checklist: entity("tasks", "preparation_checklists", {
    name: text(true),
    items: strings,
  }),
  checklistRun: entity("tasks", "preparation_runs", {
    checklistId: ref("checklist", true),
    day: day(true),
    checked: strings,
  }),

  // habits
  habit: entity("habits", "habit_definitions", {
    name: text(true),
    kind: choice(habitKind),
    unit: text(),
    items: strings,
    status: choice(["active", "paused", "optional", "archived"]),
    showHome: flag,
    order: number(),
  }),
  habitRule: entity("habits", "habit_rules", {
    habitId: ref("habit", true),
    effectiveFrom: day(true),
    target: number(),
    weekdays: strings,
    kind: choice(habitKind, false),
    unit: text(),
    items: strings,
  }),
  habitLog: entity("habits", "habit_logs", {
    habitId: ref("habit", true),
    ruleId: ref("habitRule"),
    day: day(true),
    value: number(),
    items: strings,
    hidden: flag,
  }),

  // finance
  budget: entity("finance", "expense_budgets", {
    month: month(true),
    amountMinor: money(true),
  }),
  category: entity("finance", "expense_categories", {
    name: text(true),
    parentId: ref("category"),
    necessary: flag,
    defaultChildId: ref("category"),
  }),
  expense: entity("finance", "expense_entries", {
    title: text(true),
    day: day(true),
    amountMinor: money(true, true),
    categoryId: ref("category"),
    subcategoryId: ref("category"),
    necessary: flag,
    mode: choice(["immediate", "estimated", "fixed"]),
    startDay: day(),
    endDay: day(),
    endedDay: day(),
    recoveryMinor: money(),
    recoveryDay: day(),
    note: text(false, 10000),
  }),
  recurringExpense: entity("finance", "recurring_expenses", {
    name: text(true),
    amountMinor: money(true),
    categoryId: ref("category"),
    active: flag,
  }),

  // treasury
  wallet: entity("treasury", "treasury_wallets", {
    name: text(true),
    category: choice(["cny", "external", "crypto", "stock"]),
    asset: text(),
    currency: text(true),
    unitPrice: decimal(),
    exchangeRate: decimal(),
  }),
  // v1 additive: a tradable asset (BTC, NVDA, 小米…). Its total is the sum of its holdings across wallets.
  asset: entity("treasury", "treasury_assets", {
    name: text(true),
    symbol: text(),
    kind: choice(["crypto", "stock"]),
    /** Quote source key, e.g. `coingecko:bitcoin`, `tencent:usNVDA`, `tencent:hk01810`. */
    quoteId: text(),
    /** Quote currency of the market (USD, HKD, CNY…); prices are converted to CNY for totals. */
    currency: text(),
    /** Fallback price in CNY when no live quote is available. */
    manualPrice: decimal(),
    order: number(),
  }),
  // v1 additive: a price observed for an asset (CNY per unit), so history moves with the market, not only with holdings.
  assetPrice: entity("treasury", "treasury_asset_prices", {
    assetId: ref("asset", true),
    at: timestamp(true),
    price: decimal(true),
  }),
  walletEntry: entity("treasury", "treasury_entries", {
    walletId: ref("wallet", true),
    // v1 additive: which asset this entry counts, for exchange / brokerage wallets holding several.
    assetId: ref("asset"),
    mode: choice(["set", "delta"]),
    quantity: decimal(true, true),
    at: timestamp(true),
    reason: text(false, 10000),
    unitPrice: decimal(),
    exchangeRate: decimal(),
  }),

  // documents
  document: entity("documents", "documents", {
    title: text(true),
    body: text(false, 1000000),
    kind: choice(["note", "thought", "monthly"]),
    day: day(),
    month: month(),
    domainId: ref("domain"),
    activityId: ref("activity"),
    source: choice(["unknown", "original", "ai", "assisted", "excerpt"], false),
    // v1 additive: free topic tags kept from the original system.
    tags: strings,
  }),

  // journal
  journal: entity("journal", "journal_entries", {
    kind: choice(["chronicle", "raw"]),
    day: day(true),
    body: text(true, 1000000),
    complete: flag,
  }),
  idea: entity("journal", "idea_entries", {
    body: text(true, 100000),
    day: day(true),
    status: choice(["pending", "completed", "discarded"]),
  }),

  // metrics
  metric: entity("metrics", "metric_definitions", {
    name: text(true),
    unit: text(),
    minimum: number(-100000),
    maximum: number(),
  }),
  metricLog: entity("metrics", "metric_entries", {
    metricId: ref("metric", true),
    day: day(true),
    value: number(-100000),
    note: text(false, 10000),
  }),

  // calendar
  importantDay: entity("calendar", "important_days", {
    name: text(true),
    calendar: choice(["solar", "lunar"]),
    date: day(),
    lunarYear: integer(1900, 2100),
    lunarMonth: integer(1, 12),
    lunarDay: integer(1, 30),
    leap: flag,
    repeat: choice(["once", "weekly", "monthly", "yearly", "custom"]),
    interval: integer(1, 10000),
    intervalUnit: choice(["day", "week", "month", "year"]),
    remindDays: integer(0, 3650),
    dismissedDate: text(),
    note: text(false, 10000),
  }),
} as const satisfies Record<string, EntitySpec>;

export type EntityType = keyof typeof schema;
export const entityTypes = Object.keys(schema) as EntityType[];
/** Typed payload of one entity type, e.g. `EntityData<"expense">`. */
export type EntityData<T extends EntityType = EntityType> = {
  [K in T]: DataOf<(typeof schema)[K]["fields"]>;
}[T];
export const spec = (type: EntityType): EntitySpec => schema[type];
