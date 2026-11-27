import type {
  AnyEntity,
  EntityType,
} from "../../packages/contracts/entities.ts";
import { entityTypes } from "../../packages/contracts/entities.ts";
import { net } from "../../modules/finance/index.ts";
import { validDay } from "../../modules/kernel/server.ts";

export const readableSections = {
  tasks: entityTypes.filter((type) => ["task", "taskList"].includes(type)),
  habits: ["habit", "habitRule", "habitLog"],
  notes: ["document", "journal"],
  folders: ["domain", "activity"],
  reminders: ["importantDay"],
  chronicle: ["journal"],
  chronicle_days: ["journal"],
  important_dates: ["importantDay"],
  expense_entries: ["expense"],
  expense_categories: ["category"],
  expense_budgets: ["budget"],
  expense_subscriptions: ["recurringExpense"],
  treasury_assets: ["asset"],
  treasury_accounts: ["wallet"],
  treasury_market: ["assetPrice"],
  treasury_changes: ["walletEntry"],
} satisfies Record<string, readonly EntityType[]>;
const sections: Record<string, readonly EntityType[]> = readableSections;
export const documentKindBySection: Readonly<Record<string, string>> = {
  reference_notes: "note",
  personal_thoughts: "thought",
  monthly_reports: "monthly",
};
export const readableTypes = [...new Set(Object.values(sections).flat())];
const dateFields = ["date", "period", "updatedAt", "createdAt"] as const;
const necessityValues = ["necessary", "optional", "undecided"] as const;
export const timezone = "Asia/Shanghai";
const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone });
const dateInput = { type: "string", format: "date" };
const positiveInteger = { type: "integer", minimum: 0 };
const allowlistedSections = [...Object.keys(sections), "treasury_snapshots"];

function inputSchema(properties: object, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function tool(name: string, description: string, inputSchema: object) {
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  };
}

export const tools = [
  tool(
    "council_status",
    "检查 SELF OS 正式资料是否可查询，只返回状态、修订号和栏目。",
    inputSchema({}),
  ),
  tool(
    "council_read",
    "读取 SELF OS 已同步原记录。notes 包含资料笔记、个人思考、月报和原料，按 data.kind 区分。习惯定义、历史规则和实际记录分别返回。金额使用整数分，国库数量与报价是原记录，不等于余额或收益。",
    inputSchema(
      {
        section: { enum: allowlistedSections },
        date_field: { enum: dateFields },
        start_date: dateInput,
        end_date: dateInput,
        query: { type: "string", maxLength: 500 },
        ids: { type: "array", items: { type: "string" }, maxItems: 100 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: positiveInteger,
        revision: positiveInteger,
        include_deleted: { type: "boolean" },
      },
      ["section"],
    ),
  ),
  tool(
    "council_expenses_summary",
    "按月汇总人民币分。长期用品回收金额归入原购买日；当前月截至今天，历史月为整月。可按用途分类和必要性筛选。",
    inputSchema(
      {
        month: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$" },
        category_id: { type: "string" },
        necessity: { enum: necessityValues },
        revision: positiveInteger,
      },
      ["month"],
    ),
  ),
];

type DateField = (typeof dateFields)[number];
export type ReadRecords = {
  types: readonly EntityType[];
  section: string;
  field: DateField;
  start: string;
  end: string;
  query: string;
  ids: string[];
  includeDeleted: boolean;
  offset: number;
  limit: number;
  revision?: number;
};
export type ReadResult = {
  revision: number;
  rows: AnyEntity[];
};
export type RecordPage = ReadResult & {
  total: number;
  excludedUndated: number;
};
export type Reader = ((
  types: readonly EntityType[],
  includeDeleted?: boolean,
) => Promise<ReadResult>) & {
  records?: (request: ReadRecords) => Promise<RecordPage>;
  expenses?: (start: string, end: string) => Promise<ReadResult>;
};
type Args = Record<string, unknown>;
export class InvalidQuery extends Error {}

function integer(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new InvalidQuery("分页参数或修订号无效");
  return value;
}
function dayArg(value: unknown) {
  if (value === undefined) return "";
  if (typeof value !== "string" || !validDay(value))
    throw new InvalidQuery("使用 YYYY-MM-DD 日期");
  return value;
}
function checkRevision(args: Args, revision: number) {
  if (integer(args.revision, revision) !== revision)
    throw new InvalidQuery("同步资料已更新，请从第一页重新查询");
}
function localDay(timestamp: unknown) {
  return typeof timestamp === "string"
    ? dayFormatter.format(new Date(timestamp))
    : "";
}
function dateRange(row: AnyEntity, field: string): [string, string] {
  const { data } = row;
  if (field === "updatedAt" || field === "createdAt") {
    const date = localDay(
      field === "updatedAt" ? row.updatedAt : data.createdAt,
    );
    return [date, date];
  }
  if (field === "period" || (row.type === "budget" && data.month)) {
    if (typeof data.month !== "string") return ["", ""];
    const [year, month] = data.month.split("-").map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return [data.month + "-01", data.month + "-" + last];
  }
  if (row.type === "task" && data.scheduleKind === "range")
    return [String(data.scheduleStart ?? ""), String(data.scheduleEnd ?? "")];
  const date = String(
    data.day ?? data.date ?? data.scheduleDate ?? localDay(data.at),
  );
  return [date, date];
}
function inSection(row: AnyEntity, section: string) {
  if (Object.hasOwn(documentKindBySection, section))
    return row.type === "document" && row.data.kind === documentKindBySection[section];
  if (section === "raw_materials" || (section === "notes" && row.type === "journal"))
    return row.data.kind === "raw";
  if (section === "chronicle" || section === "chronicle_days")
    return row.data.kind === "chronicle";
  if (section === "reminders") return Number(row.data.remindDays ?? 0) > 0;
  return true;
}

function page(
  rows: AnyEntity[],
  offset: number,
  total: number,
  daysOnly: boolean,
) {
  const records = [];
  let used = 0;
  const maxPage = 24_000;
  for (const row of rows) {
    const originalLength =
      typeof row.data.body === "string" ? row.data.body.length : 0;
    let data = daysOnly
      ? { day: row.data.day, complete: row.data.complete }
      : row.data;
    if (!daysOnly && originalLength > 16_000)
      data = {
        ...data,
        body: String(data.body)
          .slice(0, 16_000)
          .replace(/[\uD800-\uDBFF]$/, ""),
      };
    const bodyTruncated = !daysOnly && originalLength > 16_000;
    const record = {
      ...row,
      data,
      ...(bodyTruncated ? { bodyTruncated, originalLength } : {}),
    };
    used += JSON.stringify(record).length;
    if (records.length && used > maxPage) break;
    records.push(record);
  }
  const end = offset + records.length;
  return {
    records,
    total,
    nextOffset: end < total ? end : null,
  };
}

export async function readRecords(args: Args, read: Reader, allowed?: typeof sections) {
  const section = args.section;
  if (typeof section !== "string" ||
    (allowed ? !Object.hasOwn(allowed, section) : !allowlistedSections.includes(section)))
    throw new InvalidQuery("请选择支持的栏目");
  if (section === "treasury_snapshots")
    throw new InvalidQuery(
      "新版保存钱包变动和市场价格记录，没有独立的历史国库快照。可查询 treasury_changes、treasury_market。",
    );
  const field = dateFields.find(
    (value) => value === (args.date_field ?? "date"),
  );
  if (!field) throw new InvalidQuery("日期字段无效");
  const start = dayArg(args.start_date);
  const end = dayArg(args.end_date);
  if (end && start > end) throw new InvalidQuery("开始日期不能晚于结束日期");
  const offset = integer(args.offset, 0);
  const limit = Math.max(1, Math.min(100, integer(args.limit, 20)));
  if (
    args.query !== undefined &&
    (typeof args.query !== "string" || args.query.length > 500)
  )
    throw new InvalidQuery("关键词无效");
  const query =
    typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const ids = args.ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new InvalidQuery("记录 ID 无效");
  const request: ReadRecords = {
    types: (allowed ?? sections)[section],
    section,
    field,
    start,
    end,
    query,
    ids,
    includeDeleted: args.include_deleted === true,
    offset,
    limit,
    revision:
      args.revision === undefined ? undefined : integer(args.revision, 0),
  };
  const result = read.records
    ? await read.records(request)
    : filterRecords(await read(request.types, request.includeDeleted), request);
  checkRevision(args, result.revision);
  return {
    section,
    revision: result.revision,
    excludedUndated: result.excludedUndated,
    ...page(result.rows, offset, result.total, section === "chronicle_days"),
  };
}

export function filterRecords(
  result: ReadResult,
  request: ReadRecords,
): RecordPage {
  const { rows, revision } = result;
  checkRevision(request, revision);
  const { section, ids, query, start, end, field, offset, limit } = request;
  const matches = rows.filter(
    (row) =>
      inSection(row, section) &&
      (!ids.length ||
        ids.includes(row.id) ||
        (section === "habits" &&
          typeof row.data.habitId === "string" &&
          ids.includes(row.data.habitId))) &&
      (!query ||
        Object.values(row.data).some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(query),
        )),
  );
  let excludedUndated = 0;
  const dated = matches.filter((row) => {
    if (!start && !end) return true;
    if (section === "habits" && row.type !== "habitLog") return true;
    const [first, last] = dateRange(row, field);
    if (!first || !last) {
      excludedUndated++;
      return false;
    }
    return (!start || last >= start) && (!end || first <= end);
  });
  dated.sort(
    (a, b) =>
      dateRange(b, field)[0].localeCompare(dateRange(a, field)[0]) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
  return {
    revision,
    excludedUndated,
    rows: dated.slice(offset, offset + limit),
    total: dated.length,
  };
}

function summary(rows: AnyEntity[]) {
  let gross = 0n;
  let recovered = 0n;
  let total = 0n;
  for (const row of rows) {
    const amount = BigInt(String(row.data.amountMinor ?? "0"));
    gross += amount;
    recovered += BigInt(String(row.data.recoveryMinor ?? "0"));
    total += net(row);
  }
  return {
    count: rows.length,
    grossMinor: String(gross),
    recoveryMinor: String(recovered),
    netMinor: String(total),
  };
}
function grouped(rows: AnyEntity[], field: string, fallback: string) {
  const groups = new Map<string, AnyEntity[]>();
  for (const row of rows) {
    const key = String(row.data[field] ?? fallback);
    const found = groups.get(key);
    if (found) found.push(row);
    else groups.set(key, [row]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, records]) => ({ key, ...summary(records) }));
}

async function expenses(args: Args, read: Reader, today: string) {
  const month = args.month;
  if (typeof month !== "string" || !validDay(month + "-01"))
    throw new InvalidQuery("月份请使用 YYYY-MM");
  if (args.category_id !== undefined && typeof args.category_id !== "string")
    throw new InvalidQuery("用途分类无效");
  const necessity = args.necessity;
  if (
    necessity !== undefined &&
    !necessityValues.some((value) => value === necessity)
  )
    throw new InvalidQuery("必要性筛选无效");
  const currentMonth = today.slice(0, 7);
  if (month > currentMonth) {
    const { revision } = await read([]);
    checkRevision(args, revision);
    return { month, revision, available: false, reason: "未来月份没有统计" };
  }
  const first = month + "-01";
  const last =
    month === currentMonth
      ? today
      : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
          .toISOString()
          .slice(0, 10);
  const { rows, revision } = read.expenses
    ? await read.expenses(first, last)
    : await read(["expense", "category"]);
  checkRevision(args, revision);
  const categories = rows.filter((row) => row.type === "category");
  const allowed = new Set([
    args.category_id,
    ...categories
      .filter((row) => row.data.parentId === args.category_id)
      .map((row) => row.id),
  ]);
  const records = rows.filter((row) => {
    if (row.type !== "expense") return false;
    const day = String(row.data.day);
    return (
      day >= first &&
      day <= last &&
      (!args.category_id ||
        allowed.has(String(row.data.categoryId ?? "")) ||
        allowed.has(String(row.data.subcategoryId ?? ""))) &&
      (necessity === undefined ||
        (row.data.necessary === true
          ? "necessary"
          : row.data.necessary === false
            ? "optional"
            : "undecided") === necessity)
    );
  });
  const totals = summary(records);
  const days = Number(last.slice(-2));
  const netAmount = BigInt(totals.netMinor);
  const absolute = netAmount < 0 ? -netAmount : netAmount;
  const average = (absolute + BigInt(Math.floor(days / 2))) / BigInt(days);
  const averageDailyYuan =
    (netAmount < 0 && average !== 0n ? "-" : "") +
    average / 100n +
    "." +
    String(average % 100n).padStart(2, "0");
  return {
    month,
    revision,
    available: true,
    startDate: first,
    endDate: last,
    days,
    currency: "CNY",
    recoveryAttribution: "original_purchase_day",
    ...totals,
    averageDailyYuan,
    byDay: grouped(records, "day", ""),
    byCategory: grouped(records, "categoryId", "uncategorized").map(
      (group) => ({
        ...group,
        name: categories.find((row) => row.id === group.key)?.data.name ?? null,
      }),
    ),
    byNecessity: necessityValues.map((key) => ({
      key,
      ...summary(
        records.filter(
          (row) =>
            (row.data.necessary === true
              ? "necessary"
              : row.data.necessary === false
                ? "optional"
                : "undecided") === key,
        ),
      ),
    })),
  };
}

export async function runTool(
  name: string,
  args: Args,
  read: Reader,
  today = dayFormatter.format(new Date()),
) {
  switch (name) {
    case "council_status": {
      const { revision } = await read([]);
      return {
        available: true,
        source: "SELF OS 正式服务器",
        timezone,
        revision,
        sections: Object.keys(sections),
      };
    }
    case "council_read":
      return readRecords(args, read);
    case "council_expenses_summary":
      return expenses(args, read, today);
    default:
      throw new InvalidQuery("未知只读工具");
  }
}
