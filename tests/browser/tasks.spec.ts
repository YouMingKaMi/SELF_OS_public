import { browserLaunchOptions } from "./options.ts";
import { test, expect } from "@playwright/test";
test.use({
  launchOptions: browserLaunchOptions,
  viewport: { width: 1440, height: 1000 },
});
const tasksUrl =
  process.env.COUNCIL_BROWSER_URL ?? "http://127.0.0.1:8900/tasks";
async function closeTask(page: import("@playwright/test").Page) {
  const close = page.getByRole("button", { name: "关闭详情", exact: true });
  if (await close.isVisible()) await close.click();
}
async function openFilters(page: import("@playwright/test").Page) {
  const filters = page.getByRole("button", {
    name: "更多任务筛选",
    exact: true,
  });
  if ((await filters.getAttribute("aria-expanded")) !== "true")
    await filters.click();
}
async function openCalendar(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: "月历", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  return page.getByRole("dialog", { name: "月历", exact: true });
}
async function goToMonth(
  popup: import("@playwright/test").Locator,
  label: "查看月份" | "排期月份",
  year: string,
  month: number,
) {
  await popup.getByRole("button", { name: new RegExp("^" + label) }).click();
  await popup.getByLabel("跳转年份", { exact: true }).fill(year);
  await popup.getByRole("button", { name: month + "月", exact: true }).click();
}
test("offline edits survive reload, reconnect, conflict resolution, responsive layout", async ({
  browser,
}, testInfo) => {
  const a = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const b = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await a.newPage();
  const other = await b.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(tasksUrl);
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  const name = "离线测试 " + Date.now();
  await page.getByLabel("添加任务", { exact: true }).fill(name);
  await page.getByRole("button", { name: "添加 ↵", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  await page.getByLabel("查看 " + name, { exact: true }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await a.setOffline(true);
  await page.locator("#task-title").fill(name + " 本机修改");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page
      .locator(".task-content")
      .getByText(name + " 本机修改", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "收件箱", exact: true }).click();
  await expect(
    page
      .locator(".task-content")
      .getByText(name + " 本机修改", { exact: true }),
  ).toBeVisible();
  await other.goto(tasksUrl);
  await other.getByRole("button", { name: "收件箱", exact: true }).click();
  await expect(other.getByText(name, { exact: true })).toBeVisible();
  await other.getByLabel("查看 " + name, { exact: true }).click();
  await other.locator("#task-title").fill(name + " 另一端");
  await other.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    other.locator(".task-content").getByText(name + " 另一端", { exact: true }),
  ).toBeVisible();
  await expect(other.getByRole("button", { name: "已同步" })).toBeVisible();
  await a.setOffline(false);
  await closeTask(page);
  await page.locator(".task-page .sync").click();
  await page.getByLabel("查看 " + name + " 本机修改", { exact: true }).click();
  await expect(page.getByText("这件事在另一端有了修改")).toBeVisible();
  await page.getByRole("button", { name: "保留我的修改", exact: true }).click();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  await closeTask(other);
  await other.locator(".task-page .sync").click();
  await expect(
    other
      .locator(".task-content")
      .getByText(name + " 本机修改", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("tasks-desktop-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "✓ 标记完成", exact: true }).click();
  await closeTask(page);
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await expect(
    page
      .locator(".task-content")
      .getByText(name + " 本机修改", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("查看 " + name + " 本机修改", { exact: true }).click();
  await page.getByRole("button", { name: "废弃这件事", exact: true }).click();
  await closeTask(page);
  await openFilters(page);
  await page.getByRole("button", { name: "已废弃", exact: true }).click();
  await expect(
    page
      .locator(".task-content")
      .getByText(name + " 本机修改", { exact: true }),
  ).toBeVisible();
  await closeTask(page);
  await openFilters(page);
  await page.getByRole("button", { name: "待完成", exact: true }).click();
  await page.getByRole("button", { name: "浅色外观", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("tasks-desktop-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "深色外观", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".studio-sidebar")).not.toHaveClass(/mobile-open/);
  await page.waitForFunction(
    () =>
      document.querySelector(".studio-sidebar")!.getBoundingClientRect()
        .right <= 0,
  );
  await page.screenshot({
    path: testInfo.outputPath("tasks-mobile-dark.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test("cancel unsent create and recover offline drafts", async ({
  page,
  context,
}) => {
  await page.goto(tasksUrl);
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  await context.setOffline(true);
  const name = "撤销验证 " + Date.now();
  await page.getByLabel("添加任务", { exact: true }).fill(name);
  await page.getByRole("button", { name: "添加 ↵", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("查看 " + name, { exact: true }).click();
  await page
    .getByRole("button", { name: "↶ 撤销最后一次待发送修改", exact: true })
    .click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toHaveCount(0);
  await context.setOffline(false);
  await page.locator(".task-page .sync").click();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
});
test("offline scheduling, interval filtering, completion history", async ({
  page,
  context,
}) => {
  await page.goto(tasksUrl);
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  const name = "排期验证 " + Date.now();
  const schedule = page.getByRole("button", { name: "安排日期", exact: true });
  await schedule.click();
  const dateDialog = page.getByRole("dialog", {
    name: "安排日期",
    exact: true,
  });
  await dateDialog
    .getByRole("button", { name: "起止日期", exact: true })
    .click();
  await goToMonth(dateDialog, "排期月份", "2032", 11);
  await dateDialog
    .getByRole("button", { name: "2032-11-28", exact: true })
    .click();
  await dateDialog.getByRole("button", { name: "下个月", exact: true }).click();
  await dateDialog
    .getByRole("button", { name: "2032-12-03", exact: true })
    .click();
  await dateDialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(schedule).toContainText("2032-11-28");
  await page.getByLabel("添加任务", { exact: true }).fill(name);
  await page.getByRole("button", { name: "添加 ↵", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  const calendar = await openCalendar(page);
  await goToMonth(calendar, "查看月份", "2032", 12);
  await calendar.getByRole("button", { name: "查看整月", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toBeVisible();
  await openCalendar(page);
  await calendar
    .getByRole("button", { name: "2032-12-04", exact: true })
    .click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toHaveCount(0);
  await openCalendar(page);
  await calendar
    .getByRole("button", { name: "2032-12-03", exact: true })
    .click();
  await page.getByLabel("查看 " + name, { exact: true }).click();
  await context.setOffline(true);
  await page.locator("#edit-kind").selectOption("recent");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toHaveCount(0);
  await closeTask(page);
  await openCalendar(page);
  await calendar.getByRole("button", { name: "全部时间", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("查看 " + name, { exact: true }).click();
  await expect(page.locator("#edit-kind")).toHaveValue("recent");
  await context.setOffline(false);
  await closeTask(page);
  await page.locator(".task-page .sync").click();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  await page.getByLabel("查看 " + name, { exact: true }).click();
  await page.locator("#edit-kind").selectOption("day");
  await page.locator("#edit-date").fill("2032-12-10");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByLabel("查看 " + name, { exact: true })).toHaveCount(0);
  await closeTask(page);
  await openFilters(page);
  await page.getByRole("button", { name: "待完成", exact: true }).click();
  await expect(
    page
      .locator(".task-group")
      .filter({
        has: page.locator(".task-content").getByText(name, { exact: true }),
      })
      .locator("h3"),
  ).toContainText("2032-12-10");
  await page.getByLabel("查看 " + name, { exact: true }).click();
  await page.getByRole("button", { name: "✓ 标记完成", exact: true }).click();
  await closeTask(page);
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".task-group")
      .filter({
        has: page.locator(".task-content").getByText(name, { exact: true }),
      })
      .locator("h3"),
  ).toContainText("完成于");
  await openCalendar(page);
  await goToMonth(calendar, "查看月份", "2032", 12);
  await calendar.getByRole("button", { name: "查看整月", exact: true }).click();
  await expect(
    page.locator(".task-content").getByText(name, { exact: true }),
  ).toHaveCount(0);
});

test("a task saved offline waits for its prerequisite and unlocks on both clients", async ({
  page,
  context,
  browser,
}) => {
  await page.goto(tasksUrl);
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  const suffix = Date.now();
  const before = "先收集材料 " + suffix;
  const after = "再写提纲 " + suffix;
  const finished = "已完成的资料整理 " + suffix;
  for (const title of [before, after, finished]) {
    await page.getByRole("button", { name: "安排日期", exact: true }).click();
    await page
      .getByRole("dialog", { name: "安排日期", exact: true })
      .getByRole("button", { name: "近期", exact: true })
      .click();
    await page.getByLabel("添加任务", { exact: true }).fill(title);
    await page.getByRole("button", { name: "添加 ↵", exact: true }).click();
    await expect(
      page.getByLabel("查看 " + title, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  }
  await page
    .getByRole("button", { name: "完成 " + finished, exact: true })
    .click();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  await page.getByLabel("查看 " + after, { exact: true }).click();
  await page.getByText("前置任务", { exact: true }).click();
  await page.getByLabel("搜索前置任务").fill(finished);
  await expect(
    page.getByRole("button", { name: "＋ " + finished, exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("搜索前置任务").fill(before);
  await page.getByRole("button", { name: "＋ " + before, exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await closeTask(page);
  await page.getByRole("button", { name: "接下来", exact: true }).click();
  await expect(page.getByLabel("查看 " + after, { exact: true })).toHaveCount(
    0,
  );
  await closeTask(page);
  await openFilters(page);
  await page.getByRole("button", { name: "等前置", exact: true }).click();
  await expect(page.getByLabel("查看 " + after, { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  await closeTask(page);
  await page.getByRole("button", { name: "接下来", exact: true }).click();
  await page
    .getByRole("button", { name: "完成 " + before, exact: true })
    .click();
  await expect(page.getByLabel("查看 " + after, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "已同步" })).toBeVisible();
  const second = await browser.newPage();
  try {
    await second.goto(tasksUrl);
    await expect(
      second.getByLabel("查看 " + after, { exact: true }),
    ).toBeVisible();
    await expect(
      second.getByLabel("查看 " + before, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test("folder graph draws and edits the actual dependency and the list unlocks it", async ({
  page,
}) => {
  await page.goto(tasksUrl);
  const suffix = Date.now();
  const folder = "关系图 " + suffix;
  const first = "准备 " + suffix;
  const second = "交付 " + suffix;
  await page.getByRole("button", { name: "任务文件夹", exact: true }).click();
  await page.getByRole("button", { name: "新建清单", exact: true }).click();
  await page.getByLabel("清单名称").fill(folder);
  await page.getByRole("button", { name: "保存清单", exact: true }).click();
  for (const name of [first, second]) {
    await page.getByLabel("添加任务", { exact: true }).fill(name);
    await page.getByRole("button", { name: "添加 ↵", exact: true }).click();
    await expect(
      page.getByLabel("查看 " + name, { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "关系图", exact: true }).click();
  const graph = page.getByRole("region", { name: "任务关系图" });
  await page.getByRole("button", { name: "连线", exact: true }).click();
  await graph.getByRole("button", { name: first, exact: true }).click();
  await graph.getByRole("button", { name: second, exact: true }).click();
  await expect(graph.locator(".task-graph-edge")).toHaveCount(1);
  await page.getByRole("button", { name: "退出连线", exact: true }).click();
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".task-track-lines path")).toHaveCount(1);
  const locked = page.getByRole("button", {
    name: "完成 " + second,
    exact: true,
  });
  await expect(locked).toBeDisabled();
  await page
    .getByRole("button", { name: "完成 " + first, exact: true })
    .click();
  await expect(
    page.getByText("解锁了「" + second + "」", { exact: true }),
  ).toBeVisible();
  await expect(locked).toBeEnabled();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(locked).toBeDisabled();
});
