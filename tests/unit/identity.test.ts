import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  IdentityService,
  MemoryIdentityStore,
  MemoryStore,
  SyncService,
  nodeSecrets,
} from "../../modules/kernel/server.ts";
import { ChangeHub, buildApp, deviceAuth } from "../../services/api/app.ts";
import { composeRules } from "../../services/api/compose.ts";

const origin = "https://council.test";
let clock = new Date("2026-11-10T00:00:00Z");
function setup() {
  const identity = new IdentityService(new MemoryIdentityStore(), nodeSecrets, () => clock);
  const hub = new ChangeHub();
  const app = buildApp(new SyncService(new MemoryStore(), composeRules()), deviceAuth(identity), {
    identity,
    publicOrigin: origin,
    hub,
  });
  return { identity, app, hub };
}
const pair = (app: ReturnType<typeof setup>["app"], code: string, extra: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/pair", headers: { "x-council-request": "1", ...extra }, payload: { code } });
const task = () => ({
  operationId: randomUUID(),
  entityId: randomUUID(),
  entityType: "task",
  baseVersion: 0,
  action: "put",
  occurredAt: "2026-11-10T00:00:00Z",
  data: { title: "t", status: "pending", scheduleKind: "unscheduled" },
});

test("identity: a code pairs exactly once, case- and dash-insensitive, then expires", async () => {
  const { identity, app } = setup();
  const { code } = await identity.createPairing({ owner: "me", name: "iPhone", kind: "phone" });
  const first = await pair(app, code.toLowerCase().replace("-", " "));
  assert.equal(first.statusCode, 200);
  const { credential, device } = first.json();
  assert.equal(device.kind, "phone");
  assert.match(credential, /^[0-9a-f-]{36}\.[\w-]{43}$/);
  assert.equal((await pair(app, code)).statusCode, 400, "used code");
  const late = await identity.createPairing({ owner: "me", name: "x", kind: "phone", minutes: 1 });
  clock = new Date(clock.getTime() + 61_000);
  assert.equal((await pair(app, late.code)).statusCode, 400, "expired code");
  await app.close();
});

test("identity: owner and device come from the credential; revocation is immediate", async () => {
  const { identity, app } = setup();
  const { code } = await identity.createPairing({ owner: "me", name: "iPhone", kind: "phone" });
  const { credential, device } = (await pair(app, code)).json();
  const auth = { authorization: "Bearer " + credential, "x-device-id": "spoofed" };
  const sent = await app.inject({ method: "POST", url: "/v1/commands", headers: auth, payload: task() });
  assert.equal(sent.statusCode, 200);
  assert.equal((await app.inject({ url: "/v1/session", headers: auth })).json().device.id, device.id);
  assert.equal((await app.inject({ url: "/v1/changes", headers: auth })).json().changes.length, 1);
  assert.equal((await app.inject({ url: "/v1/changes", headers: { authorization: "Bearer " + credential.slice(0, -1) + (credential.endsWith("A") ? "B" : "A") } })).statusCode, 401);
  await identity.revoke(device.id);
  assert.equal((await app.inject({ url: "/v1/changes", headers: auth })).statusCode, 401);
  await app.close();
});

test("identity: the browser gets an HttpOnly cookie, and cookie writes need the same-site header", async () => {
  const { identity, app } = setup();
  const { code } = await identity.createPairing({ owner: "me", name: "Mac", kind: "web" });
  const paired = await pair(app, code);
  assert.equal(paired.json().credential, undefined, "no credential in the body");
  const cookie = String(paired.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const session = cookie.split(";")[0];
  assert.equal((await app.inject({ url: "/v1/changes", headers: { cookie: session } })).statusCode, 200);
  const write = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/v1/commands", headers: { cookie: session, ...headers }, payload: task() });
  assert.equal((await write({})).statusCode, 403, "no custom header → forged");
  assert.equal((await write({ "x-council-request": "1", origin: "https://evil.test" })).statusCode, 403);
  assert.equal((await write({ "x-council-request": "1", origin })).statusCode, 200);
  assert.equal((await pair(app, "AAAA-AAAA", {})).statusCode, 400);
  assert.equal(
    (await app.inject({ method: "POST", url: "/v1/pair", payload: { code: "AAAA-AAAA" } })).statusCode,
    403,
    "pairing also needs the header",
  );
  await app.close();
});

test("identity: pairing attempts are rate limited per address", async () => {
  const { app } = setup();
  const codes = await Promise.all(Array.from({ length: 12 }, () => pair(app, "ZZZZ-ZZZZ")));
  assert.equal(codes.filter((r) => r.statusCode === 429).length, 2);
  await app.close();
});

test("events: an accepted write hints every open stream of that owner", async () => {
  const { identity, app, hub } = setup();
  const { code } = await identity.createPairing({ owner: "me", name: "p", kind: "phone" });
  const { credential } = (await pair(app, code)).json();
  const hints: string[] = [];
  const stop = hub.subscribe("me", (r) => hints.push(r));
  const other = hub.subscribe("someone-else", () => assert.fail("other owner hinted"));
  await app.inject({ method: "POST", url: "/v1/commands", headers: { authorization: "Bearer " + credential }, payload: task() });
  assert.deepEqual(hints, ["1"]);
  stop();
  other();
  await app.close();
});
