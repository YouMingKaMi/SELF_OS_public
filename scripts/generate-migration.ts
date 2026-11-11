/**
 * Turns a change of packages/contracts/schema.ts into the next SQL migration.
 *   node scripts/generate-migration.ts <name>   write infra/migrations/NNNN_<name>.sql and update the lock
 *   node scripts/generate-migration.ts --check  fail if the schema and the lock disagree
 *   node scripts/generate-migration.ts --accept update the lock after a hand-written migration
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  diffSql,
  protocolSql,
  storageModel,
} from "../modules/kernel/server.ts";
const folder = new URL("../infra/migrations/", import.meta.url);
const lockFile = new URL("schema.lock.json", folder);
const lock = existsSync(lockFile)
  ? JSON.parse(readFileSync(lockFile, "utf8"))
  : null;
const model = storageModel();
const text = JSON.stringify(model, null, 2) + "\n";
const [argument] = process.argv.slice(2);
if (argument === "--check") {
  if (JSON.stringify(lock) !== JSON.stringify(model))
    throw new Error(
      "Entity schema changed without a migration. Run: npm run db:migration -- <name>",
    );
} else if (argument === "--accept") {
  writeFileSync(lockFile, text);
} else {
  if (!argument || !/^[a-z0-9_]+$/.test(argument))
    throw new Error("Usage: npm run db:migration -- <snake_case_name>");
  const sql = diffSql(lock ?? {}, model);
  if (!sql)
    throw new Error("Schema and lock already agree; nothing to migrate.");
  const next =
    readdirSync(folder).filter((name) => /^\d{4}_/.test(name)).length + 1;
  const name = String(next).padStart(4, "0") + "_" + argument + ".sql";
  writeFileSync(
    new URL(name, folder),
    `-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.\n` +
      (lock ? "" : protocolSql) +
      sql,
  );
  writeFileSync(lockFile, text);
  console.log("Wrote infra/migrations/" + name);
}
