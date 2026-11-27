import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { entityTypes, type AnyEntity } from "../../packages/contracts/entities.ts";
import { buildGeminiApp } from "../../services/council-gemini/app.ts";
import { expandedSections, expandedTypes } from "../../services/council-gemini/sections.ts";
import { type Reader } from "../../services/council-query/query.ts";

test("Gemini connector requires an owner-approved PKCE grant and keeps its read scope", async () => {
  const origin = "https://self-os.example";
  const redirect = "https://oauth-redirect.googleusercontent.com/r/self-os";
  const dir = mkdtempSync(join(tmpdir(), "council-gemini-"));
  const databasePath = join(dir, "oauth.sqlite");
  const record: AnyEntity = {
    type: "idea", id: "synthetic-idea", version: 1, deleted: false, updatedAt: "2026-11-17T00:00:00Z",
    data: { body: "synthetic content", day: "2026-11-17", status: "pending" },
  };
  const memoir: AnyEntity = {
    type: "memoir", id: "synthetic-memoir", version: 1, deleted: false, updatedAt: "2026-11-26T00:00:00Z",
    data: { period: "middle_school", title: "synthetic memoir", detail: "fixture details" },
  };
  const api = buildGeminiApp({
    origin, databasePath,
    isOwnerSession: async (cookie) => cookie === "council_device=owner",
    read: (async (types) => ({ revision: 11, rows: [record, memoir].filter((row) => types.includes(row.type)) })) as Reader,
  });
  try {
    const remote = (method: string, params = {}, token = "") => api.inject({
      method: "POST", url: "/ai/gemini/mcp",
      headers: token ? { authorization: "Bearer " + token } : {},
      payload: { jsonrpc: "2.0", id: 1, method, params },
    });
    assert.equal((await remote("tools/list")).statusCode, 401);
    const register = (uri: string) => api.inject({
      method: "POST", url: "/ai/gemini/register",
      payload: { redirect_uris: [uri], token_endpoint_auth_method: "client_secret_post" },
    });
    assert.equal((await register(redirect + "@example.com")).statusCode, 400);
    const client = (await register(redirect)).json();
    const verifier = "V".repeat(50);
    const search = new URLSearchParams({
      client_id: client.client_id, redirect_uri: redirect, response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256", state: "synthetic".repeat(160),
    });
    const response = await api.inject({ url: "/v1/ai-gemini/authorize?" + search });
    const ticket = response.body.match(/name="ticket" value="([^"]+)"/)?.[1];
    assert.ok(ticket);
    const consent = (cookie: string, source = origin) => api.inject({
      method: "POST", url: "/v1/ai-gemini/authorize", headers: { cookie, origin: source },
      payload: { ticket },
    });
    assert.equal((await consent("council_device=other")).statusCode, 403);
    assert.equal((await consent("council_device=owner", "https://unrelated.example")).statusCode, 403);
    const authorized = await consent("council_device=owner");
    assert.equal(authorized.statusCode, 200);
    const callback = new URL(authorized.body.match(/href="([^"]+)"/)![1].replaceAll("&amp;", "&"));
    const code = callback.searchParams.get("code");
    assert.ok(code);
    assert.equal(callback.searchParams.get("state"), search.get("state"));
    const auth = { client_id: client.client_id, client_secret: client.client_secret };
    const token = (data: object) => api.inject({
      method: "POST", url: "/ai/gemini/token", payload: { ...auth, ...data },
    });
    const exchange = { grant_type: "authorization_code", redirect_uri: redirect, code };
    assert.equal((await token({ ...exchange, code_verifier: "W".repeat(50) })).statusCode, 400);
    const successful = await token({ ...exchange, code_verifier: verifier });
    assert.equal(successful.statusCode, 200, successful.body);
    const { access_token: access, refresh_token: refresh } = successful.json();
    assert.equal((await token({ ...exchange, code_verifier: verifier })).statusCode, 400);
    const call = (name: string, args = {}, credential = access) =>
      remote("tools/call", { name, arguments: args }, credential);
    const status = (await call("self_os_status")).json().result;
    assert.deepEqual(JSON.parse(status.content[0].text).sections, ["reference_notes", "tasks", "reading"]);
    for (const section of ["notes", "expense_entries", "chronicle", "memoir", "treasury_accounts"]) {
      assert.equal((await call("self_os_read", { section })).json().result.isError, true);
    }
    assert.equal((await call("self_os_read", { section: "reference_notes", include_deleted: true })).json().result.isError, true);
    assert.equal((await call("self_os_expenses_summary", { month: "2026-11" })).json().result.isError, true);
    assert.equal((await remote("tools/list", {}, access)).json().result.tools.length, 2);
    const excludedTypes = new Set(["achievement", "storageBox", "storageItem", "workspaceConfig"]);
    assert.deepEqual(new Set(expandedTypes), new Set(entityTypes.filter((type) => !excludedTypes.has(type))));
    const grants = new DatabaseSync(databasePath);
    try {
      grants.prepare("INSERT INTO oauth_expanded_grants (client) VALUES (?)").run(client.client_id);
    } finally {
      grants.close();
    }
    assert.deepEqual(JSON.parse((await call("self_os_status")).json().result.content[0].text).sections, Object.keys(expandedSections));
    assert.equal((await remote("tools/list", {}, access)).json().result.tools[2].name, "self_os_expenses_summary");
    assert.equal((await call("self_os_read", { section: "ideas" })).json().result.isError, undefined);
    assert.equal((await call("self_os_read", { section: "storage" })).json().result.isError, true);
    const memoirPage = (await call("self_os_read", { section: "memoir" })).json().result;
    assert.deepEqual(JSON.parse(memoirPage.content[0].text).records, [memoir]);
    const count = (await call("self_os_read", { section: "ideas", count_only: true })).json().result;
    assert.deepEqual(JSON.parse(count.content[0].text), { section: "ideas", revision: 11, total: 1, excludedUndated: 0 });
    assert.equal((await call("self_os_read", { section: "ideas", include_deleted: true })).json().result.isError, true);
    assert.equal((await call("self_os_read", { section: "achievements" })).json().result.isError, true);
    assert.equal((await call("self_os_expenses_summary", { month: "2000-01" })).json().result.isError, undefined);
    const renewed = (await token({ grant_type: "refresh_token", refresh_token: refresh })).json();
    assert.equal((await call("self_os_status")).statusCode, 401);
    assert.equal((await call("self_os_read", { section: "ideas" }, renewed.access_token)).json().result.isError, undefined);
    assert.equal((await api.inject({
      method: "POST", url: "/ai/gemini/revoke", payload: { ...auth, token: renewed.refresh_token },
    })).statusCode, 200);
    assert.equal((await call("self_os_status", {}, renewed.access_token)).statusCode, 401);
    const afterRevocation = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(afterRevocation.prepare("SELECT count(*) AS count FROM oauth_expanded_grants").get()?.count, 0);
    } finally {
      afterRevocation.close();
    }
  } finally {
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
