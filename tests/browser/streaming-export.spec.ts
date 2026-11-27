import assert from "node:assert/strict";
import { expect, test, type Page } from "@playwright/test";
import { browserLaunchOptions } from "./options.ts";

test.use({ launchOptions: browserLaunchOptions, serviceWorkers: "block" });
const origin = process.env.COUNCIL_BROWSER_ORIGIN ?? "http://127.0.0.1:8900";
const date = "2026-11-18";
const occurredAt = date + "T01:00:00.000Z";
const id = (index: number) =>
  "00000000-0000-4000-a000-" + index.toString(16).padStart(12, "0");

function article(index: number, title = "测试文章 " + index, deleted = false) {
  return {
    id: id(index),
    type: "document",
    version: 1,
    updatedAt: occurredAt,
    deleted,
    data: {
      title,
      kind: "thought",
      day: date,
      body: '原文\n\n```json\n{"样例":1}\n```\n',
    },
  };
}

async function seed(
  page: Page,
  records: ReturnType<typeof article>[],
  edits: object[] = [],
  releaseWriter = false,
) {
  await page.evaluate(
    ({ records, edits, releaseWriter }) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("council-next-v2");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(["confirmed", "pending"], "readwrite");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
          for (const record of records) tx.objectStore("confirmed").put(record);
          for (const edit of edits) tx.objectStore("pending").put(edit);
          if (releaseWriter)
            (window as Window & { resumeExport?: () => void }).resumeExport!();
        };
      }),
    { records, edits, releaseWriter },
  );
}

async function openSettings(page: Page) {
  await page.route(origin + "/v1/**", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto(origin + "/settings");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
}

test("exports the offline projection and original Markdown through the download fallback", async ({
  context,
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    }),
  );
  await openSettings(page);
  const pending = (index: number, action: string, data?: object) => ({
    entityId: id(index),
    entityType: "document",
    operationId: id(100 + index),
    baseVersion: index === 3 ? 0 : 1,
    state: "queued",
    action,
    data,
    occurredAt,
    sequence: index,
  });
  await seed(
    page,
    [article(1), article(2, "回收站原文", true), article(4)],
    [
      pending(1, "patch", { title: "本机新标题" }),
      pending(3, "put", {
        title: "本机新文",
        kind: "thought",
        day: date,
        body: "本机正文",
      }),
      pending(4, "delete"),
    ],
  );
  await page.reload();
  await expect(page.getByText("3 条", { exact: true })).toBeVisible();
  await context.setOffline(true);
  const requested = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出已下载资料" }).click();
  const file = await requested;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const bytes of stream) chunks.push(bytes);
  const output = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(output.format, "personal-council-next");
  assert.equal(output.version, 1);
  assert.deepEqual(
    output.entities.map((row: ReturnType<typeof article>) => [
      row.id,
      row.deleted,
      row.data.title,
    ]),
    [
      [id(1), false, "本机新标题"],
      [id(2), true, "回收站原文"],
      [id(4), true, "测试文章 4"],
      [id(3), false, "本机新文"],
    ],
  );
  await page.getByRole("button", { name: "查看回收站" }).click();
  await expect(page.getByText("回收站原文", { exact: true })).toBeVisible();

  await context.setOffline(false);
  await page.goto(origin + "/thoughts");
  await expect(page.getByRole("button", { name: "导出 .md" })).toBeEnabled();
  const markdown = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 .md" }).click();
  const mdStream = await (await markdown).createReadStream();
  const md = [];
  for await (const bytes of mdStream) md.push(bytes);
  const content = Buffer.concat(md).toString("utf8");
  assert.match(content, /^# 个人思考/m);
  assert.ok(content.includes(article(1).data.body));
  assert.ok(content.includes("## 本机新文"));
  assert.ok(!content.includes("回收站原文"));
});

test("a delayed file writer reads a single snapshot across concurrent local changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    const result = { writes, closed: false };
    Object.defineProperties(window, {
      exportResult: { value: result },
      showSaveFilePicker: {
        configurable: true,
        value: async () => ({
          createWritable: async () => ({
            write: async (part: string) => {
              writes.push(part);
              if (writes.length === 2)
                await new Promise<void>((done) => {
                  (
                    window as Window & { resumeExport?: () => void }
                  ).resumeExport = done;
                });
              await new Promise((done) => setTimeout(done, 15));
            },
            close: async () => {
              result.closed = true;
            },
            abort: async () => {},
          }),
        }),
      },
    });
  });
  await openSettings(page);
  const rows = Array.from({ length: 72 }, (_, i) => article(i));
  await seed(page, rows);
  await page.reload();
  const button = page.getByRole("button", { name: "导出已下载资料" });
  await button.click();
  const readResult = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            exportResult?: { writes: string[]; closed: boolean };
          }
        ).exportResult!,
    );
  await expect
    .poll(async () => (await readResult()).writes.length)
    .toBeGreaterThanOrEqual(2);
  await seed(
    page,
    [article(60, "导出过程中改写"), article(72, "导出过程中添加")],
    [],
    true,
  );
  await expect(button).toBeEnabled();
  const result = await readResult();
  assert.equal(result.closed, true);
  assert.ok(result.writes.length >= 5, "header, multiple record pages, footer");
  assert.deepEqual(JSON.parse(result.writes.join("")).entities, rows);
});

test("canceling the save dialog leaves the workspace ready and starts no download", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const counts = { prompts: 0, downloads: 0 };
    const createURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      counts.downloads++;
      return createURL(blob);
    };
    Object.defineProperties(window, {
      exportAttempts: { value: counts },
      showSaveFilePicker: {
        configurable: true,
        value: async () => {
          counts.prompts++;
          throw new DOMException("Canceled", "AbortError");
        },
      },
    });
  });
  await openSettings(page);
  const button = page.getByRole("button", { name: "导出已下载资料" });
  await button.click();
  await expect(button).toBeEnabled();
  const counts = await page.evaluate(
    () =>
      (
        window as Window & {
          exportAttempts?: { prompts: number; downloads: number };
        }
      ).exportAttempts,
  );
  assert.deepEqual(counts, { prompts: 1, downloads: 0 });
});
