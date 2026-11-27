import { createPool, migrate, rotateRestoredGeneration } from "../modules/kernel/server.ts";

const database = process.env.DATABASE_URL;
if (!database) throw new Error("Set DATABASE_URL to the restored database explicitly.");
const pool = createPool(database);
try {
  await migrate(pool);
  const owners = await rotateRestoredGeneration(pool);
  console.log(JSON.stringify({ restoredOwners: owners }));
} finally {
  await pool.end();
}
