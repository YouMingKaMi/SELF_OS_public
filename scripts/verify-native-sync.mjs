import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
const token = randomBytes(32).toString("hex"),
  owner = "native-test-" + randomUUID();
const env = {
  ...process.env,
  COUNCIL_DEV_TOKEN: token,
  COUNCIL_DEV_OWNER: owner,
  COUNCIL_API_PORT: "8901",
  COUNCIL_TEST_TOKEN: token,
  COUNCIL_TEST_URL: "http://127.0.0.1:8901",
  DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
};
const server = spawn(process.execPath, ["services/api/server.ts"], {
  env,
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("API startup timeout")),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("API exited " + code));
    });
  });
  const code = await new Promise((resolve) =>
    spawn(
      "swift",
      [
        "test",
        "--package-path",
        "apps/ios/CouncilCore",
        "--scratch-path",
        "/tmp/council-next-swift-build",
        "--jobs",
        "4",
      ],
      { env, stdio: "inherit" },
    ).once("exit", resolve),
  );
  if (code !== 0) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  const { createPool, purgeOwner } = await import(
    "../modules/kernel/server.ts"
  );
  const pool = createPool(process.env.DATABASE_URL);
  try {
    await purgeOwner(pool, owner);
  } finally {
    await pool.end();
  }
}
