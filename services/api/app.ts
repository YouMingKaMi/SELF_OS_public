import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { Caller, IdentityService, SyncService } from "../../modules/kernel/server.ts";
import type { QuoteService } from "./quotes.ts";
import {
  commandSchema,
  type Command,
} from "../../packages/contracts/entities.ts";

/** What a request presents. Exactly one of bearer / cookie is used. */
export type Presented = {
  bearer?: string;
  cookie?: string;
  deviceHeader?: string;
};
/** Resolves the caller; owner and device always come from here, never from the body. */
export type Authenticate = (
  presented: Presented,
) => Promise<Caller | null> | Caller | null;

/** Development only: one shared token, one owner; a device may name itself in a header (reads and event streams need not). */
export function developmentAuth(token: string, owner: string): Authenticate {
  const expected = Buffer.from(token);
  return ({ bearer, deviceHeader }) => {
    const given = Buffer.from(bearer ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected)
      ? { owner, device: deviceHeader ?? "development" }
      : null;
  };
}

/** Production: paired devices. Phones and tools send a bearer credential, the browser a session cookie. */
export const deviceAuth =
  (identity: IdentityService): Authenticate =>
  ({ bearer, cookie }) =>
    identity.authenticate(bearer ?? cookie);

export const sessionCookie = "council_device";
const cookieOf = (header: string | undefined) =>
  header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(sessionCookie + "="))
    ?.slice(sessionCookie.length + 1);

/** Fixed-window counters, enough for one process. */
class Limiter {
  private windows = new Map<string, { count: number; until: number }>();
  private limit: number;
  private ms: number;
  constructor(limit: number, ms: number) {
    this.limit = limit;
    this.ms = ms;
  }
  allow(key: string, now = Date.now()) {
    if (this.windows.size > 10_000)
      for (const [k, w] of this.windows) if (w.until <= now) this.windows.delete(k);
    const w = this.windows.get(key);
    if (!w || w.until <= now) {
      this.windows.set(key, { count: 1, until: now + this.ms });
      return true;
    }
    return ++w.count <= this.limit;
  }
}

/** "Something changed" hints for open event streams. Correctness never depends on them: clients pull by cursor. */
export class ChangeHub {
  private listeners = new Map<string, Set<(revision: string) => void>>();
  subscribe(owner: string, listener: (revision: string) => void) {
    const set = this.listeners.get(owner) ?? new Set();
    set.add(listener);
    this.listeners.set(owner, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(owner);
    };
  }
  count(owner: string) {
    return this.listeners.get(owner)?.size ?? 0;
  }
  publish(owner: string, revision: string) {
    for (const listener of this.listeners.get(owner) ?? []) listener(revision);
  }
}

const deviceHeader = {
  type: "object",
  properties: {
    "x-device-id": { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

/** Rules report failures as `CODE` or `CODE:field`; anything else is a server fault. */
function clientError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (!/^[A-Z][A-Z_]+(:\w+)?$/.test(code)) return null;
  return {
    status: ["OPERATION_REUSED", "NOT_FOUND"].includes(code) ? 409 : 400,
    code,
  };
}

export type AppOptions = {
  /** Enables pairing, sessions and revocation. */
  identity?: IdentityService;
  /** e.g. https://example.org:9443 — checked against Origin on cookie requests. */
  publicOrigin?: string;
  /** Proxies whose X-Forwarded-For is believed (for per-address limits). */
  trustProxy?: string;
  hub?: ChangeHub;
  /** Seconds between keep-alive comments on event streams. */
  heartbeat?: number;
  /** Market data; routes are absent without it. */
  quotes?: QuoteService;
};

/** HTTP adapter only: authenticate, validate the envelope, call the use case, map errors. */
export function buildApp(
  sync: SyncService,
  authenticate: Authenticate,
  options: AppOptions = {},
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: options.trustProxy ?? false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const hub = options.hub ?? new ChangeHub();
  const callers = new WeakMap<object, Caller>();
  const pairingByAddress = new Limiter(10, 15 * 60_000);
  const pairingOverall = new Limiter(60, 60 * 60_000);
  const perDevice = new Limiter(1200, 60_000);
  const secure = options.publicOrigin?.startsWith("https://") ?? false;

  /** Cookie-borne requests must prove they come from our own page: a custom header forces a CORS preflight we never grant. */
  const forged = (req: FastifyRequest) => {
    if (req.method === "GET" || req.method === "HEAD") return false;
    if (req.headers["x-council-request"] !== "1") return true;
    const origin = req.headers.origin;
    return Boolean(origin && options.publicOrigin && origin !== options.publicOrigin);
  };

  app.addHook("onRequest", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (req.routeOptions.url === "/v1/pair") return;
    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : undefined;
    const cookie = bearer ? undefined : cookieOf(req.headers.cookie);
    if (cookie && forged(req)) return reply.code(403).send({ error: "FORBIDDEN" });
    const device = req.headers["x-device-id"];
    const caller = await authenticate({
      bearer,
      cookie,
      deviceHeader: typeof device === "string" ? device : undefined,
    });
    if (!caller) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!perDevice.allow(caller.owner + "/" + caller.device))
      return reply.code(429).send({ error: "RATE_LIMITED" });
    callers.set(req, caller);
  });
  app.setErrorHandler((error, _req, reply) => {
    const known = clientError(error);
    if (known) return reply.code(known.status).send({ error: known.code });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({ error: "INVALID_REQUEST" });
    console.error(
      JSON.stringify({ event: "request-failed", name: (error as Error).name }),
    );
    return reply.code(500).send({ error: "INTERNAL" });
  });
  const caller = (req: FastifyRequest) => callers.get(req)!;

  app.post<{ Body: Command }>(
    "/v1/commands",
    { schema: { headers: deviceHeader, body: commandSchema } },
    async (req) => {
      const { owner, device } = caller(req);
      const receipt = await sync.execute(owner, device, req.body);
      if (receipt.outcome === "accepted") hub.publish(owner, receipt.revision);
      return receipt;
    },
  );
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    "/v1/changes",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", pattern: "^[0-9]{1,18}$" },
            limit: { type: "integer", minimum: 1, maximum: 500 },
          },
        },
      },
    },
    (req) => sync.changes(caller(req).owner, req.query.cursor, req.query.limit),
  );

  const streams = new Set<() => void>();
  // Server-sent "changed" hints. A client reconnects with backoff and always pulls by cursor afterwards.
  app.get("/v1/events", (req, reply: FastifyReply) => {
    const { owner } = caller(req);
    if (hub.count(owner) >= 16) return reply.code(429).send({ error: "RATE_LIMITED" });
    reply.hijack();
    const out = reply.raw;
    out.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    out.write("retry: 5000\n\nevent: ready\ndata: {}\n\n");
    const stop = hub.subscribe(owner, (revision) =>
      out.write(`event: changed\ndata: ${JSON.stringify({ revision })}\n\n`),
    );
    const beat = setInterval(() => out.write(": keep-alive\n\n"), (options.heartbeat ?? 25) * 1000);
    const close = () => {
      clearInterval(beat);
      stop();
    };
    const end = () => {
      close();
      out.end();
    };
    streams.add(end);
    req.raw.once("close", () => {
      streams.delete(end);
      close();
    });
  });
  app.addHook("preClose", async () => {
    for (const end of streams) end();
    streams.clear();
  });

  const quotes = options.quotes;
  if (quotes) {
    app.get<{ Querystring: { ids: string } }>(
      "/v1/quotes",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["ids"],
            additionalProperties: false,
            properties: { ids: { type: "string", maxLength: 4000 } },
          },
        },
      },
      (req) => quotes.quotes(req.query.ids.split(",")),
    );
    app.get<{ Querystring: { q: string; kind: "crypto" | "stock" } }>(
      "/v1/quotes/search",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["q", "kind"],
            additionalProperties: false,
            properties: {
              q: { type: "string", minLength: 1, maxLength: 40 },
              kind: { type: "string", enum: ["crypto", "stock"] },
            },
          },
        },
      },
      async (req, reply) => {
        try {
          return { results: await quotes.search(req.query.q, req.query.kind) };
        } catch {
          return reply.code(502).send({ error: "QUOTES_UNAVAILABLE" });
        }
      },
    );
  }

  const identity = options.identity;
  if (identity) {
    app.post<{ Body: { code: string } }>(
      "/v1/pair",
      {
        schema: {
          body: {
            type: "object",
            required: ["code"],
            additionalProperties: false,
            properties: { code: { type: "string", minLength: 4, maxLength: 32 } },
          },
        },
      },
      async (req, reply) => {
        if (req.headers["x-council-request"] !== "1")
          return reply.code(403).send({ error: "FORBIDDEN" });
        if (!pairingByAddress.allow(req.ip) || !pairingOverall.allow("all"))
          return reply.code(429).send({ error: "RATE_LIMITED" });
        const paired = await identity.pair(req.body.code);
        if (!paired) return reply.code(400).send({ error: "INVALID_CODE" });
        const { id, name, kind } = paired.device;
        if (kind !== "web") return { device: { id, name, kind }, credential: paired.credential };
        // The browser never sees its credential: an HttpOnly, same-site cookie scoped to the API.
        reply.header(
          "set-cookie",
          `${sessionCookie}=${paired.credential}; Path=/v1; HttpOnly; SameSite=Strict; Max-Age=${400 * 86400}` +
            (secure ? "; Secure" : ""),
        );
        return { device: { id, name, kind } };
      },
    );
    app.get("/v1/session", async (req) => {
      const { device } = caller(req);
      const found = (await identity.devices(caller(req).owner)).find((d) => d.id === device);
      return { device: found ? { id: found.id, name: found.name, kind: found.kind } : { id: device } };
    });
    /** A device can always disconnect itself. */
    app.post("/v1/session/revoke", async (req, reply) => {
      await identity.revoke(caller(req).device);
      reply.header(
        "set-cookie",
        `${sessionCookie}=; Path=/v1; HttpOnly; SameSite=Strict; Max-Age=0` + (secure ? "; Secure" : ""),
      );
      return { revoked: true };
    });
  }
  return app;
}
