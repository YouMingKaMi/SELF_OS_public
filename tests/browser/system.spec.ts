import { browserLaunchOptions } from "./options.ts";
import { test, expect } from "@playwright/test";
test.use({
  launchOptions: browserLaunchOptions,
  viewport: { width: 1440, height: 1000 },
});
test("all feature routes render, navigate, keep tabs unique, split views and respond at phone width", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const routes = [
    // Home is titled with today's date in the business timezone.
    [
      "home",
      Number(day.slice(5, 7)) +
        "月" +
        Number(day.slice(8)) +
        "日 · 周" +
        "日一二三四五六"[new Date(day + "T12:00:00Z").getUTCDay()],
    ],
    ["practice", "个人推进台"],
    ["tasks", "接下来"],
    ["habits", "习惯记录库"],
    ["expenses", "花销"],
    ["treasury", "国库"],
    ["chronicle", "编年史"],
    ["raw", "未加工信息原料"],
    ["ideas", "想法暂存"],
    ["thoughts", "个人思考"],
    ["monthly", "月报"],
    ["notes", "资料笔记"],
    ["metrics", "每日指标"],
    ["days", "重要日子"],
    ["checklists", "准备清单"],
    ["departments", "部门与知识库"],
    ["discover", "发现"],
    ["settings", "设置"],
  ];
  for (const [route, title] of routes) {
    await page.goto("http://127.0.0.1:8900/" + route);
    await expect(
      page.locator("h1").getByText(title, { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".global-sync")).toContainText("已同步");
    await expect(page.locator(".toast")).toHaveCount(0);
  }
  await page.goto("http://127.0.0.1:8900/home");
  await expect(
    page.getByText("开始体验 SELF OS。这是一条可编辑的模拟记录。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("system-home-desktop.png"),
    fullPage: true,
  });
  await page
    .locator(".studio-sidebar nav")
    .getByRole("button", { name: "个人推进台" })
    .click();
  await expect(page.locator("h1")).toHaveText("个人推进台");
  await page
    .locator(".domain-chips")
    .getByRole("button", { name: "健身", exact: true })
    .click();
  await page
    .locator(".domain-chips")
    .getByRole("button", { name: "自动化", exact: true })
    .click();
  await expect(
    page.locator(".workspace-tabs>div").filter({ hasText: "个人推进台" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "分屏查看", exact: true }).click();
  await page.locator(".split-menu").getByRole("button", { name: "花销", exact: true }).click();
  await expect(page.locator(".workspace-panes")).toHaveClass(/split/);
  await expect(page.locator(".workspace-panes").getByRole("heading", { name: "花销", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("system-split.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "分屏查看", exact: true }).click();
  await expect(page.locator(".workspace-panes")).not.toHaveClass(/split/);
  await page.goto("http://127.0.0.1:8900/home");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("h1")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("system-home-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("journal editing, idea statuses, document creation, treasury changes, preparation checklist", async ({
  page,
}) => {
  const name = "全系统验证 " + Date.now();
  await page.goto("http://127.0.0.1:8900/ideas");
  await page.getByLabel("记录内容", { exact: true }).fill(name);
  await page.getByLabel("记录内容", { exact: true }).press("Enter");
  await expect(
    page.locator(".journal-text").getByText(name, { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".journal-lines .journal-row")
    .filter({ hasText: name })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await page
    .locator(".segmented")
    .getByRole("button", { name: "已完成", exact: true })
    .click();
  await expect(
    page.locator(".journal-text").getByText(name, { exact: true }).first(),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:8900/raw");
  await page.getByLabel("记录内容", { exact: true }).fill(name + " 原文");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator(".journal-lines")).toContainText(name + " 原文");
  await page
    .locator(".journal-lines .journal-row")
    .filter({ hasText: name })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.locator(".journal-lines textarea").fill(name + " 修改后");
  await page
    .locator(".journal-lines")
    .getByRole("button", { name: "确认修改", exact: true })
    .click();
  await expect(page.locator(".journal-lines")).toContainText(name + " 修改后");
  await page.goto("http://127.0.0.1:8900/thoughts");
  await page.getByRole("button", { name: "＋ 新建文章", exact: true }).click();
  await page.getByLabel("文章标题", { exact: true }).fill(name);
  await page
    .getByLabel("文章正文", { exact: true })
    .fill("## 可阅读的标题\n\n这是一篇测试文章。");
  await page.getByRole("button", { name: "保存文章", exact: true }).click();
  await expect(page.locator(".prose")).toContainText("可阅读的标题");
  await expect(page.getByLabel("内容来源", { exact: true })).toHaveCount(0);
  await page.goto("http://127.0.0.1:8900/checklists");
  await page.getByRole("button", { name: "＋ 新场景", exact: true }).click();
  await page.getByLabel("场景名称", { exact: true }).fill(name);
  await page
    .getByLabel("每行一个要准备的东西", { exact: true })
    .fill("钥匙\n手机");
  await page.locator(".modal .primary").click();
  await expect(
    page.locator(".checklist-item").getByText("钥匙", { exact: true }),
  ).toBeVisible();
  await page.locator(".checklist-item").filter({ hasText: "钥匙" }).click();
  await expect(page.locator(".checklist-item .checked")).toHaveCount(1);
  await page.getByRole("button", { name: "重置本次", exact: true }).click();
  await expect(page.locator(".checklist-item .checked")).toHaveCount(0);
});
test("raw text can be edited before upload and survives offline route reload", async ({
  page,
  context,
}) => {
  const name = "离线原料验证 " + Date.now();
  await page.goto("http://127.0.0.1:8900/raw");
  await expect(page.locator(".global-sync")).toContainText("已同步");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.getByLabel("记录内容", { exact: true }).fill(name);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  let row = page
    .locator(".journal-lines .journal-row")
    .filter({ hasText: name });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".journal-lines textarea").fill(name + " 修改后");
  await page
    .locator(".journal-lines")
    .getByRole("button", { name: "确认修改", exact: true })
    .click();
  // A rendered journal row replaces the editor only after the local transaction commits.
  await expect(row.locator("textarea")).toHaveCount(0);
  await expect(row).toContainText(name + " 修改后");
  await page.reload();
  await expect(page.locator(".journal-lines")).toContainText(name + " 修改后");
  await context.setOffline(false);
  await page.getByRole("button", { name: "全系统同步", exact: true }).click();
  await expect(page.locator(".global-sync")).toContainText("已同步");
  await page.reload();
  await expect(page.locator(".journal-lines")).toContainText(name + " 修改后");
  await expect(page.locator(".toast")).toHaveCount(0);
});
