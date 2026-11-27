import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const [, , filename, operation, expected] = process.argv;
if (!filename || !["status", "expand", "restrict"].includes(operation) ||
    (operation !== "status" && !/^[a-f0-9]{64}$/.test(expected ?? "")))
  throw new Error("Usage: grant-access.ts <oauth.sqlite> status|expand|restrict [grant fingerprint]");

const db = new DatabaseSync(filename, { readOnly: operation === "status" });
try {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  if (operation !== "status") db.exec("BEGIN IMMEDIATE");
  const rows = db.prepare("SELECT client FROM oauth_grants WHERE refresh_expires>?")
    .all(Math.floor(Date.now() / 1000));
  if (rows.length !== 1) throw new Error("Expected one active Gemini grant");
  const client = String(rows[0].client);
  // Identify the grant without printing a client identifier or a token.
  const fingerprint = createHash("sha256").update(client).digest("hex");
  if (operation !== "status" && expected !== fingerprint)
    throw new Error("Gemini grant changed. Verify the connected account before expanding access.");
  if (operation === "expand")
    db.prepare("INSERT OR IGNORE INTO oauth_expanded_grants (client) VALUES (?)").run(client);
  if (operation === "restrict")
    db.prepare("DELETE FROM oauth_expanded_grants WHERE client=?").run(client);
  const expanded = Boolean(db.prepare("SELECT 1 FROM oauth_expanded_grants WHERE client=?").get(client));
  if (db.isTransaction) db.exec("COMMIT");
  console.log(JSON.stringify({ fingerprint, expanded }));
} finally {
  db.close();
}
