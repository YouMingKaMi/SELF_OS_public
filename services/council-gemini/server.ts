import { join } from "node:path";
import { createPool } from "../../modules/kernel/server.ts";
import { createCouncilReader } from "../council-query/postgres.ts";
import { buildGeminiApp } from "./app.ts";

const { COUNCIL_GEMINI_ORIGIN, COUNCIL_QUERY_OWNER, STATE_DIRECTORY } = process.env;
if (!COUNCIL_GEMINI_ORIGIN || !COUNCIL_QUERY_OWNER || !STATE_DIRECTORY ||
  !/^[A-Za-z0-9_-]{1,128}$/.test(COUNCIL_QUERY_OWNER))
  throw new Error("Missing Gemini service settings");
const origin = new URL(COUNCIL_GEMINI_ORIGIN);
if (origin.protocol !== "https:" || origin.origin !== COUNCIL_GEMINI_ORIGIN)
  throw new Error("Set the public HTTPS origin without a path");
const pool = createPool({ host: "/var/run/postgresql", database: "council_next", user: "council_gemini" });
const app = buildGeminiApp({
  origin: origin.origin,
  databasePath: join(STATE_DIRECTORY, "oauth.sqlite"),
  read: createCouncilReader(pool, COUNCIL_QUERY_OWNER),
  async isOwnerSession(cookie) {
    const response = await fetch("http://127.0.0.1:8790/v1/session", {
      headers: { cookie }, signal: AbortSignal.timeout(3000), redirect: "error",
    }).catch(() => null);
    return response?.ok === true;
  },
  report: (method, detail) => console.log(JSON.stringify({ event: "gemini_tool_success", method, ...detail })),
  reportAuth: (outcome) => console.log(JSON.stringify({ event: "gemini_authorization", outcome })),
});
app.addHook("onClose", async () => { await pool.end(); });
await app.listen({ host: "127.0.0.1", port: 8792 });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { void app.close(); });
