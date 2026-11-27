// Runs the system on your real data (owner "personal"), separate from the demo stack:
//   web  http://127.0.0.1:8800   api  :8799 on all interfaces, so the iPhone on the same network can sync.
// The device credential persists outside the repository (~/Library/Application Support/CouncilNext, 0600)
// so the phone stays connected across restarts.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import path from "node:path";
const folder = path.join(homedir(), "Library/Application Support/CouncilNext");
mkdirSync(folder, { recursive: true, mode: 0o700 });
const tokenFile = path.join(folder, "device-token");
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString("hex"), { mode: 0o600 });
const token = readFileSync(tokenFile, "utf8").trim();
const env = {
  ...process.env,
  COUNCIL_DEV_TOKEN: token,
  COUNCIL_DEV_OWNER: "personal",
  COUNCIL_API_HOST: "0.0.0.0",
  COUNCIL_API_PORT: "8799",
};
const address = Object.values(networkInterfaces()).flat().find((a) => a?.family === "IPv4" && !a.internal)?.address;
console.log(`Web: http://127.0.0.1:8800   Phone endpoint: http://${address ?? "<this Mac>"}:8799   Token file: ${tokenFile}`);
const children = [];
const build = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "apps/web/vite.config.ts"], { env, stdio: "inherit" });
build.once("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  for (const args of [
    ["services/api/server.ts"],
    ["node_modules/vite/bin/vite.js", "preview", "--config", "apps/web/vite.config.ts", "--host", "127.0.0.1", "--port", "8800", "--strictPort"],
  ]) {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    children.push(child);
    child.on("exit", () => children.forEach((c) => c !== child && c.kill()));
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => children.forEach((c) => c.kill(signal)));
