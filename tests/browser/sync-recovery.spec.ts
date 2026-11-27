import { expect, test } from "@playwright/test";
import type { Command } from "../../packages/contracts/entities.ts";
import type { RecoveryRequest } from "../../packages/contracts/recovery.ts";
import { browserLaunchOptions } from "./options.ts";

test.use({ launchOptions: browserLaunchOptions, serviceWorkers: "block" });

test("restored dataset replaces confirmed rows only after a complete snapshot, with explicit draft review", async ({
  context, page,
}) => {
  const origin = process.env.COUNCIL_BROWSER_ORIGIN ?? "http://127.0.0.1:8900";
  const datasetId = "00000000-0000-4000-a000-000000000001";
  const initial = "00000000-0000-4000-a000-000000000002";
  const restored = "00000000-0000-4000-a000-000000000003";
  const snapshotId = "00000000-0000-4000-a000-000000000004";
  const task = (id: string, title: string) => ({
    id, type: "task", data: { title, status: "pending" },
    version: 1, updatedAt: "2026-11-18T00:00:00Z", deleted: false,
  });
  const before = task("00000000-0000-4000-a000-000000000005", "旧版已同步任务");
  const after = task("00000000-0000-4000-a000-000000000006", "恢复保存的第一条任务");
  const later = task("00000000-0000-4000-a000-000000000007", "恢复保存的第二条任务");
  let generation = initial;
  let failSecondPage = true;
  let postedBefore = 0, postedAfter = 0;
  let accepted: Command | undefined;
  await context.route(origin + "/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    const scope = { datasetId, generation };
    const snapshot = { ...scope, watermark: "3", snapshotId, total: 3, expiresAt: "2026-12-01T00:00:00Z" };
    switch (url.pathname) {
      case "/v1/events":
        return route.fulfill({ body: "", contentType: "text/event-stream" });
      case "/v1/sync-state":
        return route.fulfill({ json: { ...scope, watermark: generation === initial ? "1" : "3",
          scopeRequired: generation === restored } });
      case "/v1/changes":
        expect(url.searchParams.get("generation")).toBe(generation);
        return route.fulfill({ json: { changes: cursor === "0" ? [{ entity: before, revision: "1" }] : [],
          nextCursor: cursor === "0" ? "1" : cursor, hasMore: false } });
      case "/v1/snapshots":
        expect(route.request().postDataJSON()).toEqual(scope);
        return route.fulfill({ json: snapshot });
      case "/v1/snapshots/" + snapshotId:
        if (url.searchParams.get("after") === "0")
          return route.fulfill({ json: { ...snapshot, records: [after], nextPosition: "1" } });
        return failSecondPage
          ? route.fulfill({ status: 500, json: { error: "test interruption" } })
          : route.fulfill({ json: { ...snapshot,
            records: [later, task(accepted!.entityId, "回执遗失但已同步")], nextPosition: null } });
      case "/v1/recovery-matches": {
        const { probes, scope: requested, watermark } = route.request().postDataJSON() as RecoveryRequest;
        expect(requested).toEqual(scope);
        expect(watermark).toBe(snapshot.watermark);
        expect(probes.map((probe) => probe.command)).toEqual([accepted]);
        return route.fulfill({ json: { matches: [{
          operationId: accepted!.operationId, entityId: accepted!.entityId, kind: "receipt",
        }] } });
      }
      case "/v1/commands": {
        const command = route.request().postDataJSON() as Command;
        expect(command.scope).toEqual(scope);
        if (generation === initial) {
          postedBefore++;
          if (command.data?.title === "回执遗失但已同步") accepted = command;
          return route.abort();
        }
        postedAfter++;
        return route.fulfill({ json: { outcome: "accepted", revision: "3",
          entity: task(command.entityId, String(command.data?.title)) } });
      }
      default:
        return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
    }
  });

  await page.goto(origin + "/tasks");
  await expect(page.getByText(before.data.title, { exact: true })).toBeVisible();
  const composer = page.getByPlaceholder("记下一件事…");
  await composer.fill("回执遗失但已同步");
  await composer.press("Enter");
  await expect.poll(() => postedBefore).toBeGreaterThan(0);
  await expect(page.locator(".global-sync")).toContainText("服务器连接暂不可用");
  await composer.fill("待核对的离线任务");
  await composer.press("Enter");
  await expect(page.getByText("待核对的离线任务", { exact: true })).toBeVisible();

  generation = restored;
  const interrupted = page.waitForResponse((response) => response.status() === 500 &&
    new URL(response.url()).pathname.startsWith("/v1/snapshots/"));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await interrupted;
  await expect(page.getByText(before.data.title, { exact: true })).toBeVisible();
  await expect(page.getByText(after.data.title, { exact: true })).toHaveCount(0);

  failSecondPage = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".global-sync")).toContainText("有记录待处理");
  await expect(page.getByText(after.data.title, { exact: true })).toBeVisible();
  await expect(page.getByText(later.data.title, { exact: true })).toBeVisible();
  await expect(page.getByText("回执遗失但已同步", { exact: true })).toBeVisible();
  await expect(page.getByText(before.data.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText("待核对的离线任务", { exact: true })).toHaveCount(0);
  expect(postedAfter).toBe(0);

  await page.goto(origin + "/settings");
  await expect(page.getByRole("heading", { name: "待核对的离线任务", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "回执遗失但已同步", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重新提交本机版本" }).click();
  await expect.poll(() => postedAfter).toBe(1);
});
