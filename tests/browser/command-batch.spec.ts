import { expect, test } from "@playwright/test";
import type { CommandBatch } from "../../packages/contracts/command-batch.ts";
import { browserLaunchOptions } from "./options.ts";

test.use({ launchOptions: browserLaunchOptions, serviceWorkers: "block" });

test("saving a habit sends one durable batch and retries the same operation after a lost response", async ({
  context, page,
}) => {
  const origin = process.env.COUNCIL_BROWSER_ORIGIN ?? "http://127.0.0.1:8900";
  const scope = {
    datasetId: "00000000-0000-4000-a000-000000000001",
    generation: "00000000-0000-4000-a000-000000000002",
  };
  const attempts: CommandBatch[] = [];
  let singles = 0;
  let disconnected = true;
  await context.route(origin + "/v1/**", async (route) => {
    const url = new URL(route.request().url());
    switch (url.pathname) {
      case "/v1/events":
        return route.fulfill({ body: "", contentType: "text/event-stream" });
      case "/v1/sync-state":
        return route.fulfill({ json: { ...scope, watermark: "0" } });
      case "/v1/changes":
        return route.fulfill({ json: { changes: [], nextCursor: "0", hasMore: false } });
      case "/v1/commands":
        singles++;
        return route.fulfill({ status: 500, json: { error: "UNEXPECTED_SINGLE_WRITE" } });
      case "/v1/command-batches": {
        const batch = route.request().postDataJSON() as CommandBatch;
        attempts.push(batch);
        if (disconnected) return route.abort();
        return route.fulfill({ json: { outcome: "accepted", effects: batch.commands.map((member, index) => ({
          outcome: "accepted", revision: String(index + 1),
          entity: {
            id: member.entityId, type: member.entityType, version: 1, deleted: false,
            data: member.data, updatedAt: member.occurredAt,
          },
        })) } });
      }
      default:
        return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
    }
  });
  await page.goto(origin + "/habits");
  await page.getByRole("button", { name: /添加习惯/ }).click();
  const editor = page.locator(".modal");
  await editor.getByLabel("名称", { exact: true }).fill("事务测试习惯");
  await editor.getByLabel("记录方式").selectOption("quantity");
  await editor.getByLabel("最低目标").fill("3");
  await editor.getByRole("button", { name: "保存计划" }).click();
  await expect.poll(() => attempts.length).toBeGreaterThan(0);
  await expect(page.getByText("事务测试习惯", { exact: true }).first()).toBeVisible();
  const first = attempts[0];
  expect(first.scope).toEqual(scope);
  expect(first.commands.map((command) => command.entityType)).toEqual(["habit", "habitRule"]);
  expect(first.commands[1].data).toMatchObject({ target: 3, habitId: first.commands[0].entityId });

  disconnected = false;
  await page.reload();
  await expect.poll(() => attempts.length).toBeGreaterThan(1);
  expect(attempts.at(-1)).toEqual(first);
  expect(singles).toBe(0);
  await expect(page.locator(".global-sync")).toContainText("已同步");
  await expect(page.getByText("事务测试习惯", { exact: true }).first()).toBeVisible();
});
