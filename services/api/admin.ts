/**
 * Server-side device administration. Run on the server, never exposed over HTTP.
 *   node services/api/admin.ts pair --name "iPhone" --kind phone [--owner personal] [--minutes 10]
 *   node services/api/admin.ts devices
 *   node services/api/admin.ts revoke <deviceId>
 */
import { parseArgs } from "node:util";
import { compose } from "./compose.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    kind: { type: "string", default: "phone" },
    owner: { type: "string", default: "personal" },
    minutes: { type: "string", default: "10" },
  },
});
const [command, argument] = positionals;
const { pool, identity } = await compose(process.env.DATABASE_URL);
try {
  if (command === "pair") {
    const kind = values.kind as "web" | "phone" | "cli";
    if (!["web", "phone", "cli"].includes(kind) || !values.name)
      throw new Error('Usage: pair --name "<device name>" --kind web|phone|cli');
    const { code, expiresAt } = await identity.createPairing({
      owner: values.owner!,
      name: values.name,
      kind,
      minutes: Math.min(60, Math.max(1, Number(values.minutes))),
    });
    console.log(`Pairing code for ${values.name} (${kind}): ${code}\nValid once, until ${expiresAt}.`);
  } else if (command === "devices") {
    for (const d of await identity.devices())
      console.log(
        [d.id, d.owner, d.kind, d.name, "seen " + (d.lastSeenAt ?? "never"), d.revokedAt ? "REVOKED " + d.revokedAt : "active"].join("  "),
      );
  } else if (command === "revoke" && argument) {
    console.log((await identity.revoke(argument)) ? "Revoked." : "No active device with that id.");
  } else throw new Error("Commands: pair | devices | revoke <deviceId>");
} finally {
  await pool.end();
}
