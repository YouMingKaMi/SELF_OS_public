import { validDay } from "../../../../modules/tasks/index.ts";

type Draft = {
  key: string;
  title: string;
  note: string;
  date: string;
  time: string;
  after: string[];
};
export type Proposal = {
  items: Draft[];
  ids: Map<string, string>;
  original: string;
};

const prompt =
  '把原文拆成具体待办，只保留原文实际要求。只输出 JSON：{"items":[{"key":"a","title":"事项","note":"原文细节","date":"YYYY-MM-DD 或空字符串","time":"HH:MM 或空字符串","after":["前置事项的 key"]}]}。无明确先后时 after 为空；日期不明确则留空。按最多 20 件事项整理。';

const errors = {
  missingContent: "模型没有返回事项。",
  invalidJSON: "模型没有返回有效的任务格式，请重试。",
  invalidCount: "没有得到可用的事项，请重试。",
  invalidItem: "模型返回的事项格式不完整。",
  invalidDependency: "模型返回了无效的前置关系。",
  cycle: "模型返回的前置关系形成了循环。",
} as const;

export class TaskPlanError extends Error {
  readonly code: keyof typeof errors;
  constructor(code: keyof typeof errors) {
    super(errors[code]);
    this.code = code;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { throw new TaskPlanError("invalidJSON"); }
}

function keyOf(value: string) {
  return value.trim().normalize();
}

/** Normalize only the first candidate from the provider. IDs are allocated after preview parsing. */
export function parseTaskPlan(response: unknown): Draft[] {
  const choices = object(response)?.choices;
  const raw = Array.isArray(choices)
    ? object(object(choices[0])?.message)?.content
    : undefined;
  if (typeof raw !== "string" || !raw.trim()) throw new TaskPlanError("missingContent");
  const json = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, "");
  const entries = object(parseJSON(json))?.items;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 20)
    throw new TaskPlanError("invalidCount");
  const items: Draft[] = entries.map((entry: unknown) => {
    const item = object(entry);
    const key = typeof item?.key === "string" ? keyOf(item.key) : "";
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const after = item?.after;
    if (!item || !key || !title || title.length > 500 ||
      !Array.isArray(after) || after.some((id) => typeof id !== "string"))
      throw new TaskPlanError("invalidItem");
    const date = typeof item.date === "string" && validDay(item.date) ? item.date : "";
    return {
      key,
      title,
      date,
      time: date && typeof item.time === "string" && item.time.length === 5 &&
        /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.time) ? item.time : "",
      note: typeof item.note === "string"
        ? item.note.trim().slice(0, 5400).replace(/[\uD800-\uDBFF]$/, "")
        : "",
      after: [...new Set(after.map(keyOf))],
    };
  });
  const keys = new Set(items.map((item) => item.key));
  if (keys.size !== items.length || items.some((item) => item.after.some((key) => !keys.has(key))))
    throw new TaskPlanError("invalidDependency");

  const sorted: Draft[] = [];
  const placed = new Set<string>();
  while (sorted.length < items.length) {
    const next = items.find((item) => !placed.has(item.key) && item.after.every((key) => placed.has(key)));
    if (!next) throw new TaskPlanError("cycle");
    sorted.push(next);
    placed.add(next.key);
  }
  return sorted;
}

export async function requestTaskPlan(
  endpoint: string,
  model: string,
  apiKey: string,
  original: string,
  day: string,
): Promise<Proposal> {
  const url = new URL(endpoint.trim());
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("请输入 HTTPS 接口地址。");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey.trim() ? { authorization: "Bearer " + apiKey.trim() } : {}),
    },
    body: JSON.stringify({
      model: model.trim(),
      messages: [
        { role: "system", content: prompt + " 今天的业务日期为 " + day + "。" },
        { role: "user", content: original.trim() },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok)
    throw new Error("模型接口请求失败（" + response.status + "）。");
  const items = parseTaskPlan(parseJSON(await response.text()));
  return {
    items,
    ids: new Map(items.map((item) => [item.key, crypto.randomUUID()])),
    original: original.trim(),
  };
}
