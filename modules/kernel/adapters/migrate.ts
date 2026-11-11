import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type pg from "pg";
import { databaseSchema } from "./postgres.ts";

export const migrationsFolder = new URL(
  "../../../infra/migrations/",
  import.meta.url,
);

/**
 * Apply every numbered SQL file not yet recorded, each in its own transaction,
 * under an advisory lock. An already-applied file must never change afterwards.
 */
export async function migrate(pool: pg.Pool, folder = migrationsFolder) {
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('council-migrations'))");
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${databaseSchema}`);
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = new Map<string, string>(
      (await db.query("SELECT name,checksum FROM schema_migrations")).rows.map(
        (row) => [row.name, row.checksum],
      ),
    );
    const names = (await readdir(folder))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    const done: string[] = [];
    for (const name of names) {
      const sql = await readFile(new URL(name, folder), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(name)) {
        if (applied.get(name) !== checksum)
          throw new Error(`Applied migration was edited: ${name}`);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await db.query("COMMIT");
        done.push(name);
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
    return done;
  } finally {
    await db
      .query("SELECT pg_advisory_unlock(hashtext('council-migrations'))")
      .catch(() => {});
    db.release();
  }
}
