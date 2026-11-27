import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("http://127.0.0.1:8900");
  await page.getByText("整理下一阶段的学习安排", { exact: true }).waitFor();
  await page.getByLabel("查看 整理下一阶段的学习安排", { exact: true }).click();
  await expect(page.locator("#task-title")).toHaveValue(
    "整理下一阶段的学习安排",
  );
  await page.screenshot({
    path: "test-results/task-screenshots/tasks-desktop-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "☼ 浅色外观", exact: true }).click();
  await page.screenshot({
    path: "test-results/task-screenshots/tasks-desktop-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "☾ 深色外观", exact: true }).click();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/task-screenshots/tasks-mobile-dark.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
