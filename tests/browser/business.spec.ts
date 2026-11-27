import { browserLaunchOptions } from "./options.ts";
import { test, expect, type Page } from "@playwright/test";
test.use({
  launchOptions: browserLaunchOptions,
  viewport: { width: 1440, height: 1000 },
});
async function saved(page: Page, type: string, predicate: (e: any) => boolean) {
  let found: any;
  await expect
    .poll(async () => {
      const latest = new Map<string, any>();
      let cursor = "0";
      do {
        const r = await page.request.get(
          "http://127.0.0.1:8900/v1/changes?cursor=" + cursor,
        );
        expect(r.status()).toBe(200);
        const data = await r.json();
        for (const row of data.changes) latest.set(row.entity.id, row.entity);
        if (!data.hasMore) break;
        cursor = data.nextCursor;
      } while (true);
      found = [...latest.values()].find((e) => e.type === type && predicate(e));
      return Boolean(found);
    })
    .toBe(true);
  return found;
}
test("expense defaults, recurring reference, long-term resale attribution and history", async ({
  page,
}) => {
  const title = "财务联调 " + Date.now();
  await page.clock.setFixedTime(new Date("2026-11-22T04:00:00Z"));
  await page.goto("http://127.0.0.1:8900/expenses");
  await expect(page.locator(".global-sync")).toContainText("已同步");
  await page.getByRole("button", { name: "＋ 记一笔", exact: true }).click();
  const form = page.locator(".modal");
  await form.getByLabel("消费内容", { exact: true }).fill(title);
  await form.getByLabel("金额（元）", { exact: true }).fill("100");
  await expect(
    form.getByRole("combobox", { name: "必要性", exact: true }),
  ).toHaveValue("yes");
  await expect(
    form
      .getByRole("combobox", { name: "细分类（可不选）", exact: true })
      .locator("option:checked"),
  ).toHaveText("正餐");
  await form
    .getByRole("combobox", { name: "消费方式", exact: true })
    .selectOption("estimated");
  await form.getByLabel("开始使用", { exact: true }).fill("2026-11-01");
  await form.getByLabel("预计使用到", { exact: true }).fill("2026-11-10");
  await form.getByRole("button", { name: "保存这笔记录", exact: true }).click();
  let record = await saved(
    page,
    "expense",
    (e) => e.data.title === title && e.version === 1,
  );
  const purchaseDay = record.data.day;
  expect(record.data.amountMinor).toBe("10000");
  expect(record.data.necessary).toBe(true);
  await page
    .locator(".segmented")
    .getByRole("button", { name: "长期使用", exact: true })
    .click();
  const product = page.locator(".long-list>div").filter({ hasText: title });
  await product
    .getByRole("button", { name: title, exact: true })
    .click();
  await form.getByText("结束使用 / 出售", { exact: true }).click();
  await form.getByLabel("实际结束日期", { exact: true }).fill("2026-11-05");
  await form.getByLabel("回收金额（元）", { exact: true }).fill("20");
  await form.getByLabel("实际回收日期", { exact: true }).fill("2026-11-07");
  await form.getByRole("button", { name: "保存这笔记录", exact: true }).click();
  record = await saved(
    page,
    "expense",
    (e) => e.id === record.id && e.version === 2,
  );
  expect(record.data.day).toBe(purchaseDay);
  expect(record.data.recoveryMinor).toBe("2000");
  await expect(product).toHaveCount(0);
  await page.getByRole("button", { name: /展开已结束/ }).click();
  await expect(product).toContainText("¥80.00");
  await page
    .locator(".segmented")
    .getByRole("button", { name: "固定支出", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ 固定支出", exact: true }).click();
  await form
    .getByLabel("固定支出名称", { exact: true })
    .fill(title + " 固定参考");
  await form.getByLabel("每月金额", { exact: true }).fill("88");
  await form.getByRole("button", { name: "保存参考支出", exact: true }).click();
  await saved(
    page,
    "recurringExpense",
    (e) => e.data.name === title + " 固定参考",
  );
  const extra = await saved(page, "expense", (e) => e.id === record.id);
  expect(extra.version).toBe(2);
  await expect(page.locator(".toast")).toHaveCount(0);
});
test("treasury set and delta retain exact balance and ordered time coordinates", async ({
  page,
}) => {
  const name = "国库联调 " + Date.now();
  await page.goto("http://127.0.0.1:8900/treasury");
  await page.getByRole("button", { name: "＋ 人民币钱包", exact: true }).click();
  const form = page.locator(".modal");
  await form.getByLabel("钱包名称", { exact: true }).fill(name);
  await form.getByRole("button", { name: "记录", exact: true }).click();
  const wallet = await saved(page, "wallet", (e) => e.data.name === name);
  await page
    .getByRole("button", { name: "＋ 记录余额变化", exact: true })
    .click();
  await expect(
    form.getByRole("combobox", { name: "记录方式", exact: true }),
  ).toHaveValue("set");
  await form.getByLabel("数量", { exact: true }).fill("100.25");
  await form.getByRole("button", { name: "记录", exact: true }).click();
  await saved(
    page,
    "walletEntry",
    (e) => e.data.walletId === wallet.id && e.data.quantity === "100.25",
  );
  await page
    .getByRole("button", { name: "＋ 记录余额变化", exact: true })
    .click();
  await expect(
    form.getByRole("combobox", { name: "记录方式", exact: true }),
  ).toHaveValue("delta");
  await form.getByLabel("数量", { exact: true }).fill("-20.10");
  await form.getByRole("button", { name: "记录", exact: true }).click();
  await saved(
    page,
    "walletEntry",
    (e) => e.data.walletId === wallet.id && e.data.quantity === "-20.10",
  );
  await expect(page.getByText("¥80.15", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0);
});
test("timer continues across navigation, pause is explicit, cancellation excludes session", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8900/practice");
  await expect(page.locator(".global-sync")).toContainText("已同步");
  if (await page.locator(".floating-timer").count()) {
    await page
      .locator(".floating-timer")
      .getByRole("button", { name: "取消本次计时", exact: true })
      .click();
    await expect(page.locator(".floating-timer")).toHaveCount(0);
  }
  const started = Date.now() - 1000;
  await page.getByRole("button", { name: "▷ 开始推进", exact: true }).click();
  const running = await saved(
    page,
    "session",
    (e) =>
      e.data.status === "running" && Date.parse(e.data.startedAt) >= started,
  );
  await page
    .locator(".studio-sidebar nav")
    .getByRole("button", { name: "编年史" })
    .click();
  await expect(page.locator(".floating-timer")).toBeVisible();
  await page
    .locator(".floating-timer")
    .getByRole("button", { name: "暂停", exact: true })
    .click();
  let paused = await saved(
    page,
    "session",
    (e) => e.id === running.id && e.data.status === "paused",
  );
  expect(paused.data.segments.length).toBe(1);
  await page
    .locator(".floating-timer")
    .getByRole("button", { name: "继续", exact: true })
    .click();
  await saved(
    page,
    "session",
    (e) =>
      e.id === running.id && e.data.status === "running" && e.version === 3,
  );
  await page
    .locator(".floating-timer")
    .getByRole("button", { name: "取消本次计时", exact: true })
    .click();
  await saved(
    page,
    "session",
    (e) => e.id === running.id && e.data.status === "cancelled",
  );
  await expect(page.locator(".floating-timer")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);
});
test("habit pause, checklist values, metric zero, calendar lunar selection persist to API", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8900/habits");
  await expect(page.locator(".global-sync")).toContainText("已同步");
  const diet = page.locator(".habit-section").filter({ hasText: "饮食" });
  if (await diet.getByRole("button", { name: "恢复计划", exact: true }).count())
    await diet.getByRole("button", { name: "恢复计划", exact: true }).click();
  const fish = diet.getByRole("button", { name: /鱼油/ });
  if (!(await fish.innerText()).includes("✓")) await fish.click();
  await saved(page, "habitLog", (e) => e.data.items?.includes("鱼油"));
  await diet.getByRole("button", { name: "暂停计划", exact: true }).click();
  await saved(
    page,
    "habit",
    (e) => e.data.name === "饮食" && e.data.status === "paused",
  );
  await diet.getByRole("button", { name: "恢复计划", exact: true }).click();
  await saved(
    page,
    "habit",
    (e) => e.data.name === "饮食" && e.data.status === "active",
  );
  await page.goto("http://127.0.0.1:8900/metrics");
  await page
    .getByRole("spinbutton", { name: "学习评分", exact: true })
    .fill("0");
  await page.getByRole("spinbutton", { name: "学习评分", exact: true }).blur();
  await saved(page, "metricLog", (e) => e.data.value === 0);
  await page.goto("http://127.0.0.1:8900/days");
  await page.getByRole("button", { name: "＋ 添加日子", exact: true }).click();
  const form = page.locator(".modal");
  const name = "农历联调 " + Date.now();
  await form.getByLabel("名称", { exact: true }).fill(name);
  await form
    .getByRole("combobox", { name: "按哪种历法记录", exact: true })
    .selectOption("lunar");
  await expect(form.locator(".calendar-days button")).toHaveCount(42);
  await form
    .getByLabel("也可直接选择公历日期", { exact: true })
    .fill("2027-02-06");
  await form.getByRole("button", { name: "保存日子", exact: true }).click();
  await saved(
    page,
    "importantDay",
    (e) =>
      e.data.name === name &&
      e.data.calendar === "lunar" &&
      e.data.lunarMonth === 1 &&
      e.data.lunarDay === 1,
  );
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("an edit made during a pull starts another push without waiting for the interval", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pulling = false;
  await page.route("**/v1/changes?*", async (route) => {
    if (!pulling) {
      pulling = true;
      await gate;
    }
    await route.continue();
  });
  await page.goto("http://127.0.0.1:8900/treasury");
  await expect.poll(() => pulling).toBe(true);
  const name = "同步期间新增 " + Date.now();
  await page.getByRole("button", { name: "＋ 人民币钱包", exact: true }).click();
  const form = page.locator(".modal");
  await form.getByLabel("钱包名称", { exact: true }).fill(name);
  await form.getByRole("button", { name: "记录", exact: true }).click();
  await expect(form).toHaveCount(0);
  release();
  // The normal retry is 15 seconds; this must reach the real API within 5 seconds.
  await saved(page, "wallet", (record) => record.data.name === name);
  await expect(page.locator(".global-sync")).toContainText("已同步");
});
