import { createPool } from "../modules/kernel/server.ts";

const argument = process.argv[2] ?? "preview";
if (!["preview", "archive", "recover"].includes(argument) || !process.env.DATABASE_URL)
  throw new Error("Specify DATABASE_URL and one of preview, archive, recover");

const eligibility = `
  FROM council.sync_receipts r
  JOIN council.identity_devices d ON d.owner_id=r.owner_id AND d.id::text=r.device_id
  WHERE d.revoked_at < now() - interval '180 days'
    AND r.created_at < now() - interval '180 days'`;
const pool = createPool(process.env.DATABASE_URL);
try {
  const { rows } = await pool.query(
    argument === "preview"
      ? `SELECT (SELECT count(*) ${eligibility}) AS eligible,
           (SELECT count(*) FROM council.sync_receipts_archive) AS archived`
      : argument === "archive"
        ? `WITH selected AS (
             SELECT r.owner_id, r.device_id, r.operation_id ${eligibility}
             ORDER BY r.created_at, r.operation_id LIMIT 5000 FOR UPDATE OF r SKIP LOCKED
           ), moved AS (
             DELETE FROM council.sync_receipts r USING selected s
             WHERE (r.owner_id,r.device_id,r.operation_id) = (s.owner_id,s.device_id,s.operation_id)
             RETURNING r.*
           )
           INSERT INTO council.sync_receipts_archive SELECT * FROM moved`
        : `WITH restored AS (
             DELETE FROM council.sync_receipts_archive RETURNING *
           )
           INSERT INTO council.sync_receipts SELECT * FROM restored`,
    [],
  );
  if (argument === "preview") console.log(JSON.stringify(rows[0]));
  else console.log(JSON.stringify({ operation: argument, status: "complete" }));
} finally {
  await pool.end();
}
