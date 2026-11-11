import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..", "backups");
await mkdir(root, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = "council-next-" + stamp;
const file = path.join(root, name + ".dump");
async function docker(args, { input, output } = {}) {
  const child = spawn(
    "docker",
    ["exec", ...(input ? ["-i"] : []), "infra-db-1", ...args],
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
const data = await readFile(file);
const metadata = {
  formatVersion: 1,
  environment: "isolated-local-development",
  createdAt: new Date().toISOString(),
  file: name + ".dump",
  size: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
  verifiedRestore: false,
};
if (process.argv.includes("--verify")) {
  const database = "council_restore_test_" + randomUUID().replaceAll("-", "");
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
    const result = await docker([
      "psql",
      "-U",
      "council",
      "-d",
      database,
      "-Atc",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
    ]);
    if (Number(result) < 20) throw new Error("Restored schema incomplete");
    metadata.verifiedRestore = true;
    metadata.restoredTables = Number(result);
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
