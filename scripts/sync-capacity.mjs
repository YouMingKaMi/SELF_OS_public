import { createPool } from "../modules/kernel/server.ts";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL explicitly");
const pool = createPool(process.env.DATABASE_URL);
const started = performance.now();
try {
  const { rows: [sample] } = await pool.query(`
    SELECT pg_database_size(current_database()) AS "databaseBytes",
      (SELECT coalesce(sum(pg_indexes_size(relid)), 0)::bigint
        FROM pg_stat_user_tables WHERE schemaname = 'council') AS "indexBytes",
      (SELECT count(*) FROM council.sync_heads) AS "changeHeads",
      (SELECT count(*) FROM council.sync_receipts) +
        (SELECT count(*) FROM council.sync_receipts_archive) AS "operationReceipts",
      (SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock') AS "lockWaiters",
      pg_total_relation_size('council.sync_receipts') +
        pg_total_relation_size('council.sync_receipts_archive') AS "receiptBytes",
      pg_total_relation_size('council.sync_snapshot_rows') AS "snapshotBytes"
  `);
  console.log(JSON.stringify({
    ...sample,
    elapsedMilliseconds: Math.round(performance.now() - started),
  }));
} finally {
  await pool.end();
}
