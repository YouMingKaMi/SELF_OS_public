// Removes tasks left behind by browser tests (reserved synthetic title prefixes) and seeds three demo tasks.
import { compose } from "../services/api/compose.ts";
const { pool, sync } = await compose(process.env.DATABASE_URL);
try {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const ids = (
      await db.query(
        "DELETE FROM tasks WHERE owner_id='local-demo' AND title ~ '^(离线测试|排期验证) [0-9]{13}' RETURNING id",
      )
    ).rows.map((row) => row.id);
    for (const table of ["sync_heads", "sync_receipts"])
      await db.query(
        `DELETE FROM ${table} WHERE owner_id='local-demo' AND entity_id=ANY($1::uuid[])`,
        [ids],
      );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  for (const [id, title] of [
    ["11111111-1111-4111-8111-111111111111", "整理下一阶段的学习安排"],
    ["22222222-2222-4222-8222-222222222222", "试试离线记下一件事"],
    ["33333333-3333-4333-8333-333333333333", "读一篇一直想看的文章"],
  ])
    await sync.execute("local-demo", "demo-seed", {
      operationId: id,
      entityId: id,
      entityType: "task",
      baseVersion: 0,
      action: "put",
      data: { title, status: "pending", scheduleKind: "unscheduled" },
      occurredAt: "2026-11-07T00:00:00Z",
    });
  console.log("Synthetic demo tasks ready; no personal records imported.");
} finally {
  await pool.end();
}
