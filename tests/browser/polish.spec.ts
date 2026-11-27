import { browserLaunchOptions } from "./options.ts";
import { test, expect, type Page } from "@playwright/test";
import { applyPatch } from "../../packages/contracts/edit.ts";
import type {
  AnyEntity as Entity,
  Data,
  EntityType,
} from "../../packages/contracts/entities.ts";

const base = process.env.COUNCIL_WEB_URL ?? "http://127.0.0.1:8900";
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
test.use({
  launchOptions: browserLaunchOptions,
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
});

/** An isolated synthetic API exercises real local persistence without touching a running database. */
async function syntheticWorkspace(page: Page, empty = false, delayMs = 0) {
  const rows: Entity[] = [];
  const add = (id: string, type: EntityType, data: Data) =>
    rows.push({
      id,
      type,
      data,
      version: 1,
      deleted: false,
      updatedAt: new Date().toISOString(),
    });
  if (!empty) {
    add("domain-learning", "domain", { name: "学习与创造", focused: true });
    add("domain-health", "domain", { name: "健康", focused: true });
    add("activity-reading", "activity", {
      domainId: "domain-learning",
      name: "阅读与笔记",
    });
    add("problem-reading", "problem", {
      domainId: "domain-learning",
      activityId: "activity-reading",
      title: "如何把阅读变成可用的知识",
      status: "active",
    });
    add("solution-reading", "solution", {
      problemId: "problem-reading",
      title: "用自己的话写一页笔记",
      status: "active",
    });
    add("category-food", "category", { name: "餐饮", necessary: true });
    add("journal-one", "journal", {
      kind: "chronicle",
      day,
      body: "晨间散步后，整理了本周想推进的方向。",
      complete: false,
    });
    add("expense-one", "expense", {
      title: "午餐",
      day,
      amountMinor: "2800",
      categoryId: "category-food",
      necessary: true,
      mode: "immediate",
    });
    add("metric-mood", "metric", { name: "心情", unit: "分", min: 1, max: 5 });
    add("metric-log", "metricLog", { metricId: "metric-mood", day, value: 4 });
    add("session-one", "session", {
      domainId: "domain-learning",
      day,
      title: "阅读",
      status: "finished",
      elapsedSeconds: 3000,
      startedAt: day + "T01:00:00Z",
      endedAt: day + "T01:50:00Z",
      segments: [day + "T01:00:00Z/" + day + "T01:50:00Z"],
      manual: false,
    });
    add("doc-one", "document", {
      kind: "thought",
      day,
      title: "把注意力放回可以做的事",
      body: "## 留出思考的空间\n\n每天给自己留一点时间，认真做完一件小事。\n\n### 本周尝试\n\n- 完成一次深度阅读\n- 用自己的话写下收获\n\n> 记录可以很轻，回看却能看见方向。",
    });
    add("doc-two", "document", {
      kind: "thought",
      day,
      title: "关于长期积累的一点想法",
      body: "不急着把每一个空白填满，给重要的事情留出位置。",
    });
  }
  if (!empty) {
    const task = { status: "pending" } as const;
    add("task-today", "task", {
      ...task,
      title: "整理今天的阅读笔记",
      scheduleKind: "day",
      scheduleDate: day,
    });
    add("task-recent", "task", {
      ...task,
      title: "准备周末的短途出行",
      scheduleKind: "recent",
    });
    add("task-unscheduled", "task", {
      ...task,
      title: "有空再整理的想法",
      scheduleKind: "unscheduled",
    });
  }
  // The synthetic server speaks the one protocol: POST /v1/commands, GET /v1/changes.
  let revision = rows.length;
  const heads = new Map(rows.map((row, i) => [row.id, i + 1]));
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/changes") {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      await route.fulfill({
        json: {
          changes: rows
            .map((entity) => ({ revision: heads.get(entity.id)!, entity }))
            .filter((change) => change.revision > cursor)
            .sort((x, y) => x.revision - y.revision)
            .map((change) => ({
              ...change,
              revision: String(change.revision),
            })),
          nextCursor: String(revision),
          hasMore: false,
        },
      });
    } else if (url.pathname === "/v1/commands") {
      const command = request.postDataJSON();
      const index = rows.findIndex((row) => row.id === command.entityId);
      const previous = rows[index];
      if ((previous?.version ?? 0) !== command.baseVersion) {
        await route.fulfill({ json: { outcome: "conflict", current: previous ?? null } });
        return;
      }
      const entity: Entity = {
        id: command.entityId,
        type: command.entityType,
        data: command.action === "patch"
          ? applyPatch(previous?.data ?? {}, command.data)
          : command.data ?? previous?.data ?? {},
        version: (previous?.version ?? 0) + 1,
        deleted: command.action === "delete",
        updatedAt: command.occurredAt,
      };
      if (index === -1) rows.push(entity);
      else rows[index] = entity;
      heads.set(entity.id, ++revision);
      await route.fulfill({
        json: { outcome: "accepted", entity, revision: String(revision) },
      });
    } else await route.fulfill({ status: 404, json: {} });
  });
  return {
    rows,
    remoteEdit(id: string, patch: Data) {
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      rows[index] = {
        ...row, data: applyPatch(row.data, patch), version: row.version + 1,
      };
      heads.set(id, ++revision);
    },
  };
}

test("home refreshes the indexed daily expenses when a record moves between dates", async ({ page }) => {
  const { remoteEdit } = await syntheticWorkspace(page);
  await page.goto(base + "/home");
  const total = page.locator('[data-card="expenses"] .home-figure strong');
  await expect(total).toHaveText("¥28.00");

  remoteEdit("expense-one", { day: "2001-01-01" });
  await page.locator(".global-sync").click();
  await expect(total).toHaveText("¥0.00");

  remoteEdit("expense-one", { day, amountMinor: "3000" });
  await page.locator(".global-sync").click();
  await expect(total).toHaveText("¥30.00");
});

test("home starts a selected branch, completes today's task and captures an expense", async ({
  page,
}) => {
  const { rows } = await syntheticWorkspace(page);
  await page.goto(base + "/home");
  await expect(page.getByLabel("快速推进领域")).toContainText("学习与创造");
  await page
    .getByLabel("快速推进领域", { exact: true })
    .selectOption("domain-learning");
  await page
    .getByLabel("快速推进子领域", { exact: true })
    .selectOption("activity-reading");
  await page
    .getByLabel("快速推进问题", { exact: true })
    .selectOption("problem-reading");
  await page
    .getByLabel("快速推进方案", { exact: true })
    .selectOption("solution-reading");
  await page.getByRole("button", { name: "开始推进", exact: true }).click();
  await expect(page.locator(".home-session")).toContainText(
    "用自己的话写一页笔记",
  );
  await expect
    .poll(
      () =>
        rows.find(
          (row) => row.type === "session" && row.data.status === "running",
        )?.data.solutionId,
    )
    .toBe("solution-reading");
  await page
    .locator(".home-session")
    .getByRole("button", { name: "暂停", exact: true })
    .click();
  await expect(page.locator(".home-session")).toContainText("已暂停");
  await page
    .locator(".home-session")
    .getByRole("button", { name: "继续", exact: true })
    .click();
  await expect(page.locator(".home-session")).toContainText("正在推进");
  await page
    .locator(".home-session")
    .getByRole("button", { name: "取消误触", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "开始推进", exact: true }),
  ).toBeVisible();
  const todayCard = page.locator('[data-card="tasks"]');
  const recentCard = page.locator('[data-card="recent"]');
  await expect(todayCard).toContainText("整理今天的阅读笔记");
  await expect(todayCard).not.toContainText("准备周末");
  await expect(recentCard).toContainText("准备周末的短途出行");
  await todayCard
    .getByRole("button", { name: "完成任务 整理今天的阅读笔记" })
    .click();
  await expect(todayCard).not.toContainText("整理今天的阅读笔记");
  await expect
    .poll(() => rows.find((row) => row.id === "task-today")?.data.status)
    .toBe("completed");
  await page.getByRole("button", { name: "记一笔花销", exact: true }).click();
  await page.getByLabel("消费内容", { exact: true }).fill("下午的咖啡");
  await page.getByLabel("金额（元）", { exact: true }).fill("18.50");
  await page.locator(".modal .primary").click();
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect
    .poll(
      () =>
        rows.find(
          (row) => row.type === "expense" && row.data.title === "下午的咖啡",
        )?.data.amountMinor,
    )
    .toBe("1850");
  await expect(page.locator('[data-card="expenses"]')).toContainText("¥46.50");
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("home stays compact at desktop and phone widths in both themes", async ({
  page,
}, testInfo) => {
  await syntheticWorkspace(page);
  await page.goto(base + "/home");
  await expect(page.getByLabel("快速推进领域")).toContainText("学习与创造");
  await expect(page.locator(".studio-sidebar nav").getByRole("button", { name: "今日", exact: true }).locator(".icon")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("polish-home-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "浅色外观", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始推进", exact: true }),
  ).toHaveCSS("background-color", "rgb(85, 82, 76)");
  await page.screenshot({
    path: testInfo.outputPath("polish-home-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "深色外观", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始推进", exact: true }),
  ).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "开始推进", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("polish-home-mobile.png"),
    fullPage: true,
  });
});

test("article search does not change the edited document and drafts survive navigation and reload", async ({
  page,
}, testInfo) => {
  const { rows } = await syntheticWorkspace(page);
  await page.goto(base + "/thoughts");
  await expect(page.locator(".article-list")).toContainText(
    "把注意力放回可以做的事",
  );
  await page
    .locator(".article-list")
    .getByRole("button")
    .filter({ hasText: "把注意力放回可以做的事" })
    .click();
  await page
    .locator(".document-paper > header")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page
    .getByLabel("文章正文", { exact: true })
    .fill("## 未完成的草稿\n\n把注意力放回可以做的事。");
  await page.getByLabel("搜索文章", { exact: true }).fill("长期积累");
  await expect(page.getByLabel("文章标题", { exact: true })).toHaveValue(
    "把注意力放回可以做的事",
  );
  await page
    .locator(".studio-sidebar nav")
    .getByRole("button", { name: "今日", exact: true })
    .click();
  await page
    .locator(".workspace-tabs")
    .getByRole("button", { name: "个人思考", exact: true })
    .click();
  await expect(page.getByLabel("文章正文", { exact: true })).toHaveValue(
    "## 未完成的草稿\n\n把注意力放回可以做的事。",
  );
  await page.reload();
  await expect(page.getByLabel("文章正文", { exact: true })).toHaveValue(
    "## 未完成的草稿\n\n把注意力放回可以做的事。",
  );
  await page.getByRole("button", { name: "保存文章", exact: true }).click();
  await expect(page.locator(".prose")).toContainText("未完成的草稿");
  await expect
    .poll(() => rows.find((row) => row.id === "doc-one")?.data.body)
    .toContain("未完成的草稿");
  await expect(page.getByLabel("内容来源", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("polish-document-desktop.png"),
    fullPage: true,
  });
});

test.describe("offline document index", () => {
  test.use({ serviceWorkers: "allow" });

  test("searches Chinese substrings with a cold offline worker and indexes saved local edits", async ({ page, context }) => {
    await syntheticWorkspace(page);
    await page.goto(base + "/thoughts");
    await expect(page.locator(".article-list")).toContainText("把注意力放回可以做的事");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    const search = page.getByRole("textbox", { name: "搜索文章" });
    const workerStarted = page.waitForEvent("worker", (worker) => worker.url().includes("document-search-worker"));
    await search.fill("深度阅读");
    const worker = await workerStarted;
    expect(await worker.evaluate(() => location.pathname)).toContain("document-search-worker");
    const list = page.locator(".article-list");
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list).toContainText("把注意力放回可以做的事");
    await list.getByRole("button").click();
    await page.locator(".document-paper > header").getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("文章正文", { exact: true }).fill("离线索引验证：新的本机文稿正文。");
    await page.getByRole("button", { name: "保存文章", exact: true }).click();
    await expect(list.getByRole("button")).toHaveCount(0);
    await search.fill("本机文稿");
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list).toContainText("把注意力放回可以做的事");
  });
});

test("an incoming change cannot silently overwrite a document draft", async ({ page }) => {
  const { rows, remoteEdit } = await syntheticWorkspace(page);
  await page.goto(base + "/thoughts");
  await page.locator(".article-list button").filter({ hasText: "把注意力放回可以做的事" }).click();
  await page.locator(".document-paper header").getByRole("button", { name: "编辑" }).click();
  const body = page.getByLabel("文章正文");
  await body.fill("本机未提交的正文");
  remoteEdit("doc-one", { body: "另一设备的正文", tags: ["保留这个标签"] });
  await page.locator(".global-sync").click();
  const save = page.getByRole("button", { name: "保存文章", exact: true });
  await expect(save).toBeDisabled();
  await expect(body).toHaveValue("本机未提交的正文");
  await page.reload();
  await expect(body).toHaveValue("本机未提交的正文");
  await page.locator("summary").filter({ hasText: "查看当前同步版本" }).click();
  await expect(page.locator(".editor-current-version")).toContainText("另一设备的正文");
  await page.getByRole("button", { name: "保留草稿修改，从当前版本继续" }).click();
  await save.click();
  await expect.poll(() => rows.find(({ id }) => id === "doc-one")?.data.body).toBe("本机未提交的正文");
  expect(rows.find(({ id }) => id === "doc-one")?.data.tags).toEqual(["保留这个标签"]);
});

test("empty articles offer a clear writing action without a tall empty frame", async ({
  page,
}, testInfo) => {
  await syntheticWorkspace(page, true);
  await page.goto(base + "/monthly");
  await expect(
    page.getByRole("button", { name: "开始写月报", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("polish-document-empty.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始写月报", exact: true }).click();
  await expect(page.getByLabel("文章正文", { exact: true })).toBeVisible();
});

test("a narrow chart keeps a readable axis and reports the focused value", async ({
  page,
}, testInfo) => {
  await syntheticWorkspace(page, false, 150);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/metrics");
  const chart = page.getByRole("img", { name: "心情", exact: true });
  await expect(chart).toBeVisible();
  await expect
    .poll(async () => {
      const box = await chart.boundingBox();
      const width = await chart.getAttribute("viewBox");
      return box && width
        ? Math.abs(Number(width.split(" ")[2]) - box.width)
        : 100;
    })
    .toBeLessThan(2);
  await chart.locator("circle").focus();
  await expect(page.locator(".chart-caption")).toContainText("4分");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("polish-chart-mobile.png"),
    fullPage: true,
  });
});

test("article validation is visible and long content reflows on a phone", async ({
  page,
}, testInfo) => {
  await syntheticWorkspace(page, true);
  await page.goto(base + "/thoughts");
  await page.getByRole("button", { name: "＋ 新建文章", exact: true }).click();
  await page.getByRole("button", { name: "保存文章", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请填写标题");
  await expect(
    page.getByRole("button", { name: "保存文章", exact: true }),
  ).toHaveCSS("color", "rgb(24, 24, 24)");
  await page.screenshot({
    path: testInfo.outputPath("polish-document-error.png"),
    fullPage: true,
  });
  await page
    .getByRole("alert")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page
    .getByLabel("文章标题", { exact: true })
    .fill(
      "关于阅读、生活与长期积累的一篇较长记录：给自己留下一条可以回望的路径",
    );
  await page
    .getByLabel("文章正文", { exact: true })
    .fill(
      Array.from(
        { length: 8 },
        (_, index) =>
          `## 第${index + 1}次观察\n\n认真记录一次行动，看清它带来的变化。文字不必急着得出结论，可以从具体的小事开始，慢慢整理出自己的理解。\n\n- 先完成一件小事\n- 再写下发生了什么`,
      ).join("\n\n"),
    );
  await page.getByRole("button", { name: "保存文章", exact: true }).click();
  await expect(page.locator(".prose")).toContainText("第8次观察");
  await page.screenshot({
    path: testInfo.outputPath("polish-document-long.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".workspace-pane").evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: testInfo.outputPath("polish-document-mobile.png"),
    animations: "disabled",
    fullPage: true,
  });
});
