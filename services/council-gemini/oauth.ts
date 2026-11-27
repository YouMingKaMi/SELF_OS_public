import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply } from "fastify";

const scope = "mcp";
const minute = 60;
const accessLifetime = 60 * minute;
const refreshLifetime = 90 * 24 * 60 * minute;
const authorizePath = "/v1/ai-gemini/authorize";
const prefix = "/ai/gemini";
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const fields = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const field = (object: Record<string, unknown>, key: string): string =>
  typeof object[key] === "string" ? object[key] : "";
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;

export const mcpPath = prefix + "/mcp";

function googleRedirect(value: unknown): value is string {
  // These exact Google-owned callback origins are documented for Connected Apps.
  return typeof value === "string" &&
    /^https:\/\/oauth-redirect(?:-sandbox|-test)?\.googleusercontent\.com\/[ra]\/[A-Za-z0-9._~%-]{1,350}$/.test(value);
}

function invalid(reply: FastifyReply, error: string, status = 400) {
  return reply.code(status).send({ error });
}

export function mountOAuth(
  app: FastifyInstance,
  origin: string,
  databasePath: string,
  isOwnerSession: (cookie: string) => Promise<boolean>,
  report?: (event: string) => void,
) {
  const resource = origin + mcpPath;
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, method TEXT NOT NULL,
      redirects TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_pending (
      ticket TEXT PRIMARY KEY, client TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
      redirect TEXT NOT NULL, state TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY, client TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
      redirect TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_grants (
      client TEXT PRIMARY KEY REFERENCES oauth_clients(id) ON DELETE CASCADE,
      access TEXT NOT NULL UNIQUE, refresh TEXT NOT NULL UNIQUE,
      access_expires INTEGER NOT NULL, refresh_expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_expanded_grants (
      client TEXT PRIMARY KEY REFERENCES oauth_grants(client) ON DELETE CASCADE
    );
  `);
  app.addHook("onClose", () => db.close());
  const now = () => Math.floor(Date.now() / 1000);
  function prune() {
    db.prepare("DELETE FROM oauth_pending WHERE expires<=?").run(now());
    db.prepare("DELETE FROM oauth_codes WHERE expires<=?").run(now());
    db.prepare("DELETE FROM oauth_grants WHERE refresh_expires<=?").run(now());
    db.prepare("DELETE FROM oauth_clients WHERE expires<=? AND id NOT IN (SELECT client FROM oauth_grants)").run(now());
  }

  const metadata = {
    issuer: origin,
    authorization_endpoint: origin + authorizePath,
    token_endpoint: origin + prefix + "/token",
    registration_endpoint: origin + prefix + "/register",
    revocation_endpoint: origin + prefix + "/revoke",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    scopes_supported: [scope],
  };
  const protectedMetadata = { resource, authorization_servers: [origin], scopes_supported: [scope], bearer_methods_supported: ["header"] };
  const resourceDiscovery = "/.well-known/oauth-protected-resource" + mcpPath;
  app.get("/.well-known/oauth-authorization-server", async () => metadata);
  app.get(resourceDiscovery, async () => protectedMetadata);
  app.get("/.well-known/oauth-protected-resource", async () => protectedMetadata);

  app.post(prefix + "/register", async (req, reply) => {
    const body = fields(req.body);
    const redirects = body.redirect_uris;
    const method = body.token_endpoint_auth_method ?? "client_secret_basic";
    if (!Array.isArray(redirects) || !redirects.length || redirects.length > 8 ||
      !redirects.every(googleRedirect))
      return invalid(reply, "invalid_redirect_uri");
    if (method !== "client_secret_basic" && method !== "client_secret_post" && method !== "none")
      return invalid(reply, "invalid_client_metadata");
    prune();
    const count = db.prepare("SELECT count(*) AS count FROM oauth_clients").get()?.count;
    if (Number(count) >= 256) return invalid(reply, "temporarily_unavailable", 429);
    const id = random();
    const secret = method === "none" ? "" : random();
    db.prepare("INSERT INTO oauth_clients VALUES (?, ?, ?, ?, ?)")
      .run(id, hash(secret), method, JSON.stringify(redirects), now() + 30 * minute);
    return reply.code(201).send({
      client_id: id, client_id_issued_at: now(), client_name: "Gemini",
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      redirect_uris: redirects, token_endpoint_auth_method: method,
      response_types: ["code"], grant_types: ["authorization_code", "refresh_token"], scope,
    });
  });

  app.get(authorizePath, async (req, reply) => {
    const query = fields(req.query);
    const client = field(query, "client_id");
    const redirect = field(query, "redirect_uri");
    const state = field(query, "state");
    const challenge = field(query, "code_challenge");
    const requested = field(query, "scope");
    const audience = field(query, "resource");
    prune();
    const record = db.prepare("SELECT redirects FROM oauth_clients WHERE id=?").get(client);
    if (!record || !googleRedirect(redirect) || !JSON.parse(String(record.redirects)).includes(redirect) ||
      query.response_type !== "code" || query.code_challenge_method !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !state || state.length > 4096 ||
      (requested && requested !== scope) || (audience && audience !== resource))
      return invalid(reply, "invalid_request");
    const ticket = random();
    // Bound the number of pending requests per registered client.
    db.prepare("DELETE FROM oauth_pending WHERE client=?").run(client);
    db.prepare("INSERT INTO oauth_pending VALUES (?, ?, ?, ?, ?, ?)")
      .run(hash(ticket), client, redirect, state, challenge, now() + 5 * minute);
    return reply.header("Referrer-Policy", "same-origin").type("text/html; charset=utf-8").send(`<!doctype html><html lang="zh"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 SELF OS</title>
      <style>html{color-scheme:light dark}body{font:17px system-ui;max-width:32rem;margin:12vh auto;padding:0 1.4rem;line-height:1.6}button{padding:.7rem 1.2rem;font:inherit;border-radius:8px;cursor:pointer}</style>
      <h1>连接 SELF OS</h1><p>允许 Gemini 只读查询资料笔记、任务和待研究清单。查询命中的内容会发送给 Gemini。</p>
      <p>请在同一浏览器登录你的 SELF OS，然后完成授权。</p>
      <form action="${authorizePath}" method="post"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">允许 Gemini 只读查询</button></form></html>`);
  });

  app.post(authorizePath, async (req, reply) => {
    const source = req.headers.origin;
    const sameOriginForm = (!source || source === "null") && req.headers["sec-fetch-site"] === "same-origin";
    if (source !== origin && !sameOriginForm)
      return reply.code(403).type("text/plain; charset=utf-8").send("请从 SELF OS 授权页重新提交。");
    if (!req.headers.cookie)
      return reply.code(403).type("text/plain; charset=utf-8").send("请先在同一浏览器配对并登录 SELF OS，再返回 Gemini 重试授权。");
    const ticket = field(fields(req.body), "ticket");
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return invalid(reply, "invalid_request");
    if (!await isOwnerSession(req.headers.cookie))
      return reply.code(403).type("text/plain; charset=utf-8").send("当前 SELF OS 登录已失效，请重新登录再授权。");
    const pending = db.prepare("DELETE FROM oauth_pending WHERE ticket=? AND expires>? RETURNING *")
      .get(hash(ticket), now());
    if (!pending) return invalid(reply, "invalid_request");
    const code = random();
    db.prepare("INSERT INTO oauth_codes VALUES (?, ?, ?, ?, ?)")
      .run(hash(code), String(pending.client), String(pending.redirect), String(pending.challenge), now() + 5 * minute);
    report?.("authorization_code_issued");
    const redirect = new URL(String(pending.redirect));
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", String(pending.state));
    // Complete the consent POST on our own origin before navigating back to Google.
    const destination = redirect.href.replaceAll("&", "&amp;");
    return reply.type("text/html; charset=utf-8").send(`<!doctype html><html lang="zh"><meta charset="utf-8">
      <title>返回 Gemini</title><h1>SELF OS 已授权</h1>
      <p><a href="${destination}" rel="noreferrer">返回 Gemini 完成连接</a></p></html>`);
  });

  function authenticatedClient(body: Record<string, unknown>, authorization?: string) {
    let id = field(body, "client_id");
    let secret = field(body, "client_secret");
    let method = secret ? "client_secret_post" : "none";
    if (authorization) {
      if (!authorization.startsWith("Basic ") || id || secret) return;
      const value = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = value.indexOf(":");
      if (separator < 1) return;
      id = value.slice(0, separator);
      secret = value.slice(separator + 1);
      method = "client_secret_basic";
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return;
    const client = db.prepare("SELECT id FROM oauth_clients WHERE id=? AND method=? AND secret_hash=?")
      .get(id, method, hash(secret));
    return client ? id : undefined;
  }

  app.post(prefix + "/token", async (req, reply) => {
    const reject = (error: string, status = 400) => {
      report?.("token_" + error);
      return invalid(reply, error, status);
    };
    const body = fields(req.body);
    const client = authenticatedClient(body, req.headers.authorization);
    if (!client) return reject("invalid_client", 401);
    const audience = field(body, "resource");
    if (audience && audience !== resource) return reject("invalid_target");
    const requestedScope = field(body, "scope");
    if (requestedScope && requestedScope !== scope) return reject("invalid_scope");
    const access = random();
    const refresh = random();
    const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      let horizon = timestamp + refreshLifetime;
      if (body.grant_type === "authorization_code") {
        const verifier = field(body, "code_verifier");
        const code = verifierPattern.test(verifier) && db.prepare(
          "DELETE FROM oauth_codes WHERE code=? AND client=? AND redirect=? AND challenge=? AND expires>? RETURNING code",
        ).get(hash(field(body, "code")), client, field(body, "redirect_uri"), hash(verifier), timestamp);
        if (!code) return reject("invalid_grant");
        // A successful consent creates the one active Gemini grant for this deployment.
        db.prepare("DELETE FROM oauth_grants").run();
      } else if (body.grant_type === "refresh_token") {
        const grant = db.prepare("SELECT refresh_expires FROM oauth_grants WHERE client=? AND refresh=? AND refresh_expires>?")
          .get(client, hash(field(body, "refresh_token")), timestamp);
        if (!grant) return reject("invalid_grant");
        horizon = Number(grant.refresh_expires);
      } else {
        return reject("unsupported_grant_type");
      }
      db.prepare(
        `INSERT INTO oauth_grants VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(client) DO UPDATE SET access=excluded.access, refresh=excluded.refresh,
           access_expires=excluded.access_expires, refresh_expires=excluded.refresh_expires`,
      ).run(client, hash(access), hash(refresh), timestamp + accessLifetime, horizon);
      db.exec("COMMIT");
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
    }
    report?.("token_issued");
    return { access_token: access, refresh_token: refresh, expires_in: accessLifetime, token_type: "Bearer", scope };
  });

  app.post(prefix + "/revoke", async (req, reply) => {
    const body = fields(req.body);
    const client = authenticatedClient(body, req.headers.authorization);
    if (!client) return invalid(reply, "invalid_client", 401);
    const digest = hash(field(body, "token"));
    db.prepare("DELETE FROM oauth_grants WHERE client=? AND (access=? OR refresh=?)").run(client, digest, digest);
    return reply.code(200).send();
  });

  return {
    challenge: `Bearer resource_metadata="${origin + resourceDiscovery}", scope="${scope}"`,
    grant(header: string | undefined) {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? "")?.[1];
      const grant = token && db.prepare(
        `SELECT expanded.client IS NOT NULL AS expanded
         FROM oauth_grants AS grant_row
         LEFT JOIN oauth_expanded_grants AS expanded ON expanded.client=grant_row.client
         WHERE access=? AND access_expires>?`,
      )
        .get(hash(token), now());
      return grant ? { expanded: grant.expanded === 1 } : undefined;
    },
  };
}
