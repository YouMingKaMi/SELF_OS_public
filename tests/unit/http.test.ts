import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryStore, SyncService } from "../../modules/kernel/server.ts";
import { buildApp, developmentAuth } from "../../services/api/app.ts";
import { composeRules } from "../../services/api/compose.ts";

const token = "t".repeat(32);
function app() {
  return buildApp(
    new SyncService(new MemoryStore(), composeRules()),
    developmentAuth(token, "owner"),
  );
}
const headers = { authorization: "Bearer " + token, "x-device-id": "d1" };
const command = (data: object, more: object = {}) => ({
  operationId: randomUUID(),
  entityId: randomUUID(),
  entityType: "task",
  baseVersion: 0,
  action: "put",
  occurredAt: "2026-11-07T00:00:00Z",
  data,
  ...more,
});

test("HTTP: requests without the credential are refused before any work", async () => {
  const server = app();
  for (const authorization of [
    undefined,
    "Bearer wrong",
    "Bearer " + token + "x",
  ]) {
    const response = await server.inject({
      method: "GET",
      url: "/v1/changes",
      headers: authorization ? { authorization } : {},
    });
    assert.equal(response.statusCode, 401);
  }
  await server.close();
});
test("HTTP: every schedule variant round-trips; rule failures are 400 with a code", async () => {
  const server = app();
  for (const schedule of [
    { scheduleKind: "unscheduled" },
    { scheduleKind: "recent" },
    { scheduleKind: "day", scheduleDate: "2026-11-07" },
    { scheduleKind: "deadline", scheduleDate: "2026-11-08" },
    {
      scheduleKind: "range",
      scheduleStart: "2026-11-07",
      scheduleEnd: "2026-12-07",
    },
  ]) {
    const response = await server.inject({
      method: "POST",
      url: "/v1/commands",
      headers,
      payload: command({ title: "t", status: "pending", ...schedule }),
    });
    assert.equal(response.statusCode, 200);
    const { entity } = response.json();
    for (const [key, value] of Object.entries(schedule))
      assert.equal(entity.data[key], value);
  }
  const invalid = await server.inject({
    method: "POST",
    url: "/v1/commands",
    headers,
    payload: command({
      title: "t",
      status: "pending",
      scheduleKind: "day",
      scheduleDate: "2026-02-30",
    }),
  });
  assert.deepEqual(
    [invalid.statusCode, invalid.json()],
    [400, { error: "INVALID_DATE:scheduleDate" }],
  );
  await server.close();
});
test("HTTP: malformed envelopes are 400, reused operation ids are 409, cursors page", async () => {
  const server = app();
  const post = (payload: object, h: Record<string, string> = headers) =>
    server.inject({ method: "POST", url: "/v1/commands", headers: h, payload });
  assert.equal(
    (await post(command({}, { operationId: "nope" }))).statusCode,
    400,
  );
  assert.equal((await post(command({}, { extra: true }))).statusCode, 400);
  assert.equal(
    (await post(command({}), { authorization: headers.authorization }))
      .statusCode,
    400, // without a device header the development identity uses a default device; the empty body is still invalid
  );
  assert.equal(
    (await post(command({ title: "t" }, { entityType: "unknown" }))).statusCode,
    400,
  );
  const first = command({
    title: "t",
    status: "pending",
    scheduleKind: "recent",
  });
  assert.equal((await post(first)).statusCode, 200);
  const reused = await post({
    ...first,
    data: { ...first.data, title: "other" },
  });
  assert.deepEqual(
    [reused.statusCode, reused.json()],
    [409, { error: "OPERATION_REUSED" }],
  );
  const page = await server.inject({
    method: "GET",
    url: "/v1/changes?cursor=0&limit=1",
    headers,
  });
  assert.deepEqual(
    [page.json().changes.length, page.json().hasMore],
    [1, false],
  );
  assert.equal(
    (
      await server.inject({
        method: "GET",
        url: "/v1/changes?cursor=abc",
        headers,
      })
    ).statusCode,
    400,
  );
  await server.close();
});
