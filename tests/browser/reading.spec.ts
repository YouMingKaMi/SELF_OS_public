import { browserLaunchOptions } from "./options.ts";
import { expect, test } from "@playwright/test";

test.use({
  launchOptions: browserLaunchOptions,
  viewport: { width: 1440, height: 900 },
});

test("collects links and title-only articles and synchronizes offline changes", async ({
  page,
  context,
  browser,
}) => {
  const url = "http://127.0.0.1:8900";
  const suffix = String(Date.now());
  const articleURL = "https://example.com/article/" + suffix;
  const title = "微信文章 " + suffix;
  await page.goto(url + "/departments");
  await page.getByRole("button", { name: "待研究清单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "待研究清单" })).toBeVisible();
  await page.getByRole("button", { name: "添加收藏" }).click();
  await page.getByLabel("说明").fill(articleURL);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const linkRow = page.getByRole("listitem").filter({ hasText: articleURL });
  await expect(linkRow.getByRole("link", { name: /打开原文/ })).toHaveAttribute(
    "href",
    articleURL,
  );
  await expect(page.getByRole("button", { name: "全系统同步" })).toHaveText(
    "已同步",
  );

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
  await context.setOffline(true);
  await page.getByRole("button", { name: "添加收藏" }).click();
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("来源").fill("微信");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("说明").fill("想再看一遍开头。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(row.getByText("想再看一遍开头。").first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "全系统同步" })).toHaveText(
    "已同步",
  );
  const other = await browser.newPage();
  try {
    await other.goto(url + "/reading");
    await other.getByRole("searchbox", { name: "搜索收藏" }).fill("想再看一遍");
    const otherRow = other.getByRole("listitem").filter({ hasText: title });
    await expect(otherRow).toBeVisible();
    await expect(other.getByRole("listitem")).toHaveCount(1);
    await otherRow.locator("summary").click();
    await expect(otherRow.locator(".reading-note")).toHaveText(
      "想再看一遍开头。",
    );
    await page.screenshot({ path: "/tmp/council-reading-desktop.png" });
    await other.setViewportSize({ width: 390, height: 844 });
    await other.screenshot({
      path: "/tmp/council-reading-narrow.png",
      animations: "disabled",
    });
    expect(
      await other
        .locator(".reading-list")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await otherRow.getByRole("button", { name: "标记初读" }).click();
    await expect(otherRow).toBeVisible();
    await other.getByRole("button", { name: "已初读", exact: true }).click();
    await expect(otherRow).toBeVisible();
    await otherRow.getByRole("button", { name: "撤销初读" }).click();
    await other.getByRole("button", { name: "未初读", exact: true }).click();
    await otherRow.getByRole("button", { name: "移除" }).click();
    await other
      .getByRole("button", { name: "移入回收站", exact: true })
      .click();
    await expect(otherRow).toHaveCount(0);
    await expect(other.getByRole("button", { name: "全系统同步" })).toHaveText(
      "已同步",
    );
    await expect(row).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("a research bookmark and a standalone event use the practice timer and notes", async ({
  page,
  browser,
}) => {
  const root = "http://127.0.0.1:8900";
  const suffix = Date.now();
  const domain = "计算机 " + suffix;
  const activity = "数据结构 " + suffix;
  const item = "课程仓库 " + suffix;
  const event = "听完 CS 61B " + suffix;
  await page.goto(root + "/practice");
  await page.getByRole("button", { name: "＋ 领域", exact: true }).click();
  await page.getByLabel("领域名称").fill(domain);
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await page.getByRole("button", { name: domain, exact: true }).click();
  await page.getByRole("button", { name: "＋ 子领域", exact: true }).click();
  await page.getByLabel("子领域名称").fill(activity);
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await page.getByRole("button", { name: "事件", exact: true }).click();
  await page.getByRole("button", { name: "新建事件" }).click();
  await page.getByLabel("事件名称").fill(event);
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: event + " ×", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑事件", exact: true }).click();
  await page.getByLabel("阶段目标或说明").fill("完成前四课");
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "完成前四课" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全系统同步" })).toHaveText(
    "已同步",
  );
  await page.goto(root + "/reading");
  await page.getByRole("button", { name: "添加收藏" }).click();
  await page.getByLabel("标题").fill(item);
  await page.getByLabel("标签", { exact: true }).fill("课件、" + domain);
  await page.getByLabel("说明").fill("https://example.com/course");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: item });
  await row.getByRole("button", { name: "标记初读" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "加入推进台" }).click();
  const selectedDomain = page
    .getByRole("dialog", { name: "加入推进台" })
    .locator("select")
    .first();
  await expect
    .poll(() =>
      selectedDomain.evaluate(
        (el: HTMLSelectElement) => el.selectedOptions[0]?.text,
      ),
    )
    .toBe(domain);
  await page
    .getByRole("dialog", { name: "加入推进台" })
    .locator("select")
    .nth(1)
    .selectOption({ label: activity });
  await page.getByRole("button", { name: "创建研究事件" }).click();
  await expect(
    page.getByRole("button", { name: item + " ×", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /打开原文/ })).toHaveAttribute(
    "href",
    "https://example.com/course",
  );
  const cockpit = page.locator(".practice-cockpit");
  await cockpit.getByRole("button", { name: "开始推进" }).click();
  await expect(cockpit.locator(".timer-digits")).toHaveText(/^00:00:0[1-9]$/);
  await cockpit.getByRole("button", { name: "结束", exact: true }).click();
  await page.getByRole("button", { name: "补记时间" }).click();
  await page.getByLabel("分钟").fill("25");
  await page.getByRole("button", { name: "保存时间" }).click();
  await page.getByLabel("推进记录").fill("读完第一节，记录关键例子");
  await page.getByRole("button", { name: "记下进展" }).click();
  await expect(
    page.getByText("读完第一节，记录关键例子", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "全系统同步" })).toHaveText(
    "已同步",
  );

  const other = await browser.newPage();
  try {
    await other.goto(root + "/reading");
    await other.getByRole("searchbox", { name: "搜索收藏" }).fill(item);
    const received = other.getByRole("listitem").filter({ hasText: item });
    await expect(received).toContainText(activity);
    await expect(received.locator("time")).toHaveText(/^00:25:\d{2}$/);
    await other.screenshot({
      path: "/tmp/council-research-desktop.png",
      animations: "disabled",
    });
    await received.getByRole("button", { name: "打开推进事件" }).click();
    await expect(
      other.getByText("读完第一节，记录关键例子", { exact: true }),
    ).toBeVisible();
    await other.setViewportSize({ width: 390, height: 844 });
    await other.screenshot({
      path: "/tmp/council-research-narrow.png",
      animations: "disabled",
    });
  } finally {
    await other.close();
  }
});
