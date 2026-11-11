import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const env = {
  ...process.env,
  // A fixed token may be passed in (e.g. to seed the demo); otherwise a fresh one per run.
  COUNCIL_DEV_TOKEN: process.env.COUNCIL_DEV_TOKEN ?? randomBytes(32).toString("hex"),
};
const children = [];
for (const args of [
  ["services/api/server.ts"],
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "apps/web/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    "8900",
    "--strictPort",
  ],
]) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  children.push(child);
  child.on("exit", () => {
    for (const other of children) if (other !== child) other.kill();
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
