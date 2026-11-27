import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..", "backups");
const container = process.env.COUNCIL_BACKUP_CONTAINER ?? "infra-db-1";
await mkdir(root, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = "council-next-" + stamp;
const file = path.join(root, name + ".dump");
async function docker(args, { input, output } = {}) {
  const child = spawn(
    "docker",
    ["exec", ...(input ? ["-i"] : []), container, ...args],
    { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] },
  );
  let error = "",
    text = "";
  child.stderr.on("data", (d) => (error += d));
  const streams = [];
  if (output)
    streams.push(
      pipeline(child.stdout, createWriteStream(output, { mode: 0o600 })),
    );
  else child.stdout.on("data", (d) => (text += d));
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || "Database backup command failed")),
    );
  });
  try {
    await Promise.all([completed, ...streams]);
    return text;
  } catch (error) {
    child.kill();
    throw error;
  }
}
await docker(
  [
    "pg_dump",
    "-U",
    "council",
    "-d",
    "council_next",
    "--format=custom",
    "--no-owner",
  ],
  { output: file },
);
const hash = createHash("sha256");
let size = 0;
for await (const chunk of createReadStream(file)) {
  hash.update(chunk);
  size += chunk.length;
}
const metadata = {
  formatVersion: 1,
  environment: "isolated-local-development",
  createdAt: new Date().toISOString(),
  file: name + ".dump",
  size,
  sha256: hash.digest("hex"),
  verifiedRestore: false,
};
if (process.argv.includes("--verify")) {
  const database = "council_restore_test_" + randomUUID().replaceAll("-", "");
  const started = performance.now();
  const digest = (name) => docker(["psql", "-U", "council", "-d", name, "-Atc", `
    SELECT json_build_object(
      'tables', (SELECT count(*) FROM information_schema.tables WHERE table_schema='council'),
      'heads', (SELECT count(*) FROM council.sync_heads),
      'receipts', (SELECT count(*) FROM council.sync_receipts) +
        (SELECT count(*) FROM council.sync_receipts_archive),
      'expenseTotalMinor', (SELECT coalesce(sum(amount_minor - coalesce(recovery_minor, 0)), 0)::text
        FROM council.expense_entries WHERE NOT deleted),
      'documentDigest', (SELECT md5(coalesce(string_agg(md5(body), '' ORDER BY owner_id, id), ''))
        FROM council.documents WHERE NOT deleted)
    );`]);
  try {
    await docker(["createdb", "-U", "council", database]);
    await docker(
      [
        "pg_restore",
        "--exit-on-error",
        "--no-owner",
        "-U",
        "council",
        "-d",
        database,
      ],
      { input: file },
    );
    const [result, source] = await Promise.all([digest(database), digest("council_next")]);
    if (result !== source) throw new Error("Restored totals differ from the local source; pause writes and retry");
    const restored = JSON.parse(result);
    if (restored.tables < 20) throw new Error("Restored schema incomplete");
    metadata.verifiedRestore = true;
    metadata.restoredTables = restored.tables;
    metadata.restoredHeads = restored.heads;
    metadata.restoreMilliseconds = Math.round(performance.now() - started);
  } finally {
    await docker(["dropdb", "--if-exists", "-U", "council", database]);
  }
}
await writeFile(
  path.join(root, name + ".json"),
  JSON.stringify(metadata, null, 2) + "\n",
  { mode: 0o600 },
);
const manifests = (await readdir(root))
  .filter((n) => /^council-next-\d{4}.*\.json$/.test(n))
  .sort()
  .reverse();
for (const older of manifests.slice(3)) {
  const manifest = JSON.parse(await readFile(path.join(root, older), "utf8"));
  if (
    path.basename(manifest.file) === manifest.file &&
    /^council-next-\d{4}.*\.dump$/.test(manifest.file)
  ) {
    await unlink(path.join(root, manifest.file));
    await unlink(path.join(root, older));
  }
}
console.log(JSON.stringify(metadata, null, 2));
