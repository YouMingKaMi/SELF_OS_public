import { buildApp, deviceAuth, developmentAuth } from "./app.ts";
import { compose } from "./compose.ts";
import { QuoteService } from "./quotes.ts";

/**
 * Two identities, same routes:
 *   COUNCIL_DEV_TOKEN set      → development (one shared token, owner from COUNCIL_DEV_OWNER)
 *   COUNCIL_PUBLIC_ORIGIN set  → production (paired devices, owner from the device credential)
 */
const token = process.env.COUNCIL_DEV_TOKEN;
const origin = process.env.COUNCIL_PUBLIC_ORIGIN;
const port = Number(process.env.COUNCIL_API_PORT ?? 8899);
const host = process.env.COUNCIL_API_HOST ?? "127.0.0.1";
if (token ? token.length < 24 : !origin?.startsWith("https://"))
  throw new Error(
    "Set COUNCIL_DEV_TOKEN (24+ characters, development) or COUNCIL_PUBLIC_ORIGIN (https://…, paired devices)",
  );
const { pool, sync, identity } = await compose(process.env.DATABASE_URL);
const quotes = new QuoteService();
const app = token
  ? buildApp(sync, developmentAuth(token, process.env.COUNCIL_DEV_OWNER ?? "local-demo"), { quotes })
  : buildApp(sync, deviceAuth(identity), {
      identity,
      quotes,
      publicOrigin: origin,
      trustProxy: "127.0.0.1",
    });
// Never log credentials, bodies, query text or network addresses.
if (process.env.COUNCIL_ACCESS_LOG === "1" || process.env.COUNCIL_DEV_ACCESS_LOG === "1")
  app.addHook("onResponse", async (req, reply) => {
    console.log(
      JSON.stringify({
        event: "request",
        method: req.method,
        route: req.routeOptions.url ?? "unknown",
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      }),
    );
  });
app.addHook("onClose", async () => {
  await pool.end();
});
await app.listen({ host, port });
console.log(
  `API listening on ${host}:${port} (${token ? "development identity" : "paired devices"})`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close();
  });
