import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const isDarwin = process.platform === "darwin";

function runAsync(
  cmd: string,
  args: string[],
  home: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function listen(
  handler: http.RequestListener,
): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test(
  "macOS WKWebView shell enforces same-origin downloads, safe saves, and window/menu lifecycle",
  { skip: !isDarwin },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selfos-mac-test-"));
    let mountedPoint: string | null = null;
    const servers: http.Server[] = [];

    try {
      let bridgeHits = 0;
      let evilFrameHits = 0;
      let evilDownloadHits = 0;

      const evil = await listen((req, res) => {
        if (req.url === "/evil-frame") {
          evilFrameHits += 1;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<p>evil iframe</p>");
          return;
        }
        if (req.url === "/evil.bin") {
          evilDownloadHits += 1;
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="evil.bin"',
          });
          res.end("MALICIOUS");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("evil");
      });
      servers.push(evil.server);

      const bridge = await listen((req, res) => {
        if (req.url === "/embedded") {
          bridgeHits += 1;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<!doctype html><p>wechat bridge ok</p>");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><p>standalone bridge</p>");
      });
      servers.push(bridge.server);

      const app = await listen((req, res) => {
        if (req.url === "/redirect-to-evil-download") {
          res.writeHead(302, { Location: `${evil.origin}/evil.bin` });
          res.end();
          return;
        }
        if (req.url === "/page2") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<!doctype html><h1>Page 2</h1>");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html data-theme="dark">
<body>
  <input id="editor" value="" />
  <a id="ext-link" href="${evil.origin}/article">External</a>
  <a id="blank-bridge-link" href="${bridge.origin}/" target="_blank" rel="noreferrer">Bridge Tab</a>
  <a id="redirect-dl" href="/redirect-to-evil-download" download="report.bin">Redirect Download</a>
  <a id="page2-link" href="/page2">Page 2</a>
  <iframe id="bridge-frame" src="${bridge.origin}/embedded"></iframe>
  <iframe id="evil-frame" src="${evil.origin}/evil-frame"></iframe>
  <script>
    window.triggerBlobDownload = function(name, content) {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    window.__pageReady = true;
  </script>
</body>
</html>`);
      });
      servers.push(app.server);

      // Mount a tiny temporary disk image to test real cross-volume atomic replacement
      const dmgPath = path.join(tmpDir, "extvol.dmg");
      const mountCandidate = path.join(tmpDir, "mnt");
      fs.mkdirSync(mountCandidate);
      const createRes = spawnSync(
        "hdiutil",
        ["create", "-size", "8m", "-fs", "HFS+", "-volname", "SelfOSTestVol", dmgPath],
        { encoding: "utf8" },
      );
      if (createRes.status === 0) {
        const attachRes = spawnSync(
          "hdiutil",
          ["attach", "-nobrowse", "-mountpoint", mountCandidate, dmgPath],
          { encoding: "utf8" },
        );
        if (attachRes.status === 0) {
          mountedPoint = mountCandidate;
        }
      }

      const verifyApp = path.join(tmpDir, "SelfOSMacVerify.app");
      const verifyMacOSDir = path.join(verifyApp, "Contents/MacOS");
      fs.mkdirSync(verifyMacOSDir, { recursive: true });
      fs.copyFileSync(
        path.join(root, "apps/macos/Info.plist"),
        path.join(verifyApp, "Contents/Info.plist"),
      );
      // AppKit and the theme observer use standard defaults, so the verifier must
      // never run under the installed app's preferences domain or real home.
      const verifierHome = path.join(tmpDir, "home");
      fs.mkdirSync(path.join(verifierHome, "Library/Preferences"), { recursive: true });
      execFileSync("plutil", [
        "-replace", "CFBundleIdentifier", "-string", "org.example.selfos-macos-verifier",
        path.join(verifyApp, "Contents/Info.plist"),
      ]);
      const verifyBin = path.join(verifyMacOSDir, "SelfOSMac");
      const arch = os.arch() === "arm64" ? "arm64" : "x86_64";
      execFileSync(
        "swiftc",
        [
          "-parse-as-library",
          "-D",
          "SELFOS_TESTING_HARNESS",
          "-target",
          `${arch}-apple-macos14.0`,
          "-framework",
          "AppKit",
          "-framework",
          "WebKit",
          path.join(root, "apps/macos/SelfOSMacCore.swift"),
          path.join(root, "apps/macos/SelfOSMacApp.swift"),
          path.join(root, "apps/macos/SelfOSMacVerify.swift"),
          "-o",
          verifyBin,
        ],
        { stdio: "pipe" },
      );
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", verifyApp]);

      const args = [
        "--app-url",
        app.origin,
        "--bridge-url",
        bridge.origin,
        "--evil-url",
        evil.origin,
      ];
      if (mountedPoint) {
        assert.notEqual(fs.statSync(mountedPoint).dev, fs.statSync(tmpDir).dev);
        args.push("--external-volume-dir", mountedPoint);
      } else {
        t.diagnostic("cross-volume save skipped: hdiutil did not mount the test volume");
      }

      const res = await runAsync(verifyBin, args, verifierHome);
      assert.equal(res.code, 0, res.stderr || res.stdout);
      assert.match(res.stdout, /SELFOS_MAC_VERIFY_OK/);
      if (mountedPoint) {
        assert.match(res.stdout, /SELFOS_CROSS_VOLUME_OK/);
        t.diagnostic("cross-volume overwrite verified on a distinct device");
      }
      assert.equal(bridgeHits >= 1, true, "WeChat bridge iframe should load");
      assert.equal(evilFrameHits, 0, "Cross-origin iframe must be blocked before network fetch");
      assert.equal(evilDownloadHits, 0, "Cross-origin download redirect must be cancelled before fetching evil target");
    } finally {
      for (const s of servers) s.close();
      if (mountedPoint) {
        spawnSync("hdiutil", ["detach", mountedPoint, "-force"], { stdio: "ignore" });
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
);

test(
  "build-macos-app.sh preserves existing bundle on failure, supports skip-install output, and refuses foreign targets",
  { skip: !isDarwin },
  () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selfos-mac-install-"));
    try {
      const script = path.join(root, "scripts/build-macos-app.sh");

      // 1. SELF_OS_SKIP_INSTALL=1 writes a persistent, strictly signed bundle
      const skipOut = path.join(tmpDir, "out/SELF OS.app");
      const skipRes = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_SKIP_INSTALL: "1",
          SELF_OS_OUTPUT_APP: skipOut,
          SELF_OS_URL: "https://synthetic.example:9443",
        },
        encoding: "utf8",
      });
      assert.equal(skipRes.status, 0, skipRes.stderr);
      assert.equal(fs.existsSync(path.join(skipOut, "Contents/MacOS/SelfOSMac")), true);
      assert.equal(skipRes.stdout.includes("synthetic.example"), false, "Install log must omit full endpoint URL");
      execFileSync("codesign", ["--verify", "--deep", "--strict", skipOut]);

      // 2. Fresh install + reinstall into synthetic INSTALL_DIR, and preserve old bundle when staging fails
      const installDir = path.join(tmpDir, "Applications");
      fs.mkdirSync(installDir);
      const destApp = path.join(installDir, "SELF OS.app");

      const firstInstall = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_INSTALL_DIR: installDir,
          SELF_OS_URL: "https://synthetic.example:9443",
        },
        encoding: "utf8",
      });
      assert.equal(firstInstall.status, 0, firstInstall.stderr);
      execFileSync("codesign", ["--verify", "--deep", "--strict", destApp]);
      const originalInode = fs.statSync(path.join(destApp, "Contents/MacOS/SelfOSMac")).ino;

      // Simulate mid-copy failure: old bundle must stay intact & signed, zero leftover .stage directories
      const failedReinstall = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_INSTALL_DIR: installDir,
          SELF_OS_URL: "https://synthetic.example:9443",
          SELF_OS_TEST_FAIL_STAGE_COPY: "1",
        },
        encoding: "utf8",
      });
      assert.notEqual(failedReinstall.status, 0);
      assert.equal(
        fs.statSync(path.join(destApp, "Contents/MacOS/SelfOSMac")).ino,
        originalInode,
        "Existing installed binary must remain untouched when stage copy fails",
      );
      execFileSync("codesign", ["--verify", "--deep", "--strict", destApp]);
      const leftovers = fs.readdirSync(installDir).filter((name) => name.startsWith(".selfos-stage."));
      assert.deepEqual(leftovers, [], "Partial stage directories must be cleaned up on failure");

      const failedPublish = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_INSTALL_DIR: installDir,
          SELF_OS_URL: "https://synthetic.example:9443",
          SELF_OS_TEST_FAIL_PUBLISH: "1",
        },
        encoding: "utf8",
      });
      assert.notEqual(failedPublish.status, 0);
      assert.match(failedPublish.stderr, /Could not publish app bundle/);
      assert.equal(fs.statSync(path.join(destApp, "Contents/MacOS/SelfOSMac")).ino, originalInode);
      execFileSync("codesign", ["--verify", "--deep", "--strict", destApp]);
      assert.deepEqual(fs.readdirSync(installDir), ["SELF OS.app"]);

      // Normal reinstall succeeds and replaces cleanly
      const goodReinstall = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_INSTALL_DIR: installDir,
          SELF_OS_URL: "https://synthetic.example:9443",
        },
        encoding: "utf8",
      });
      assert.equal(goodReinstall.status, 0, goodReinstall.stderr);
      execFileSync("codesign", ["--verify", "--deep", "--strict", destApp]);

      // 3. Refuse to overwrite a foreign bundle with another CFBundleIdentifier
      const foreignDir = path.join(tmpDir, "ForeignApps");
      const foreignBundle = path.join(foreignDir, "SELF OS.app/Contents");
      fs.mkdirSync(foreignBundle, { recursive: true });
      fs.writeFileSync(
        path.join(foreignBundle, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.example.unrelated</string>
</dict></plist>`,
      );
      const foreignAttempt = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_INSTALL_DIR: foreignDir,
          SELF_OS_URL: "https://synthetic.example:9443",
        },
        encoding: "utf8",
      });
      assert.notEqual(foreignAttempt.status, 0);
      assert.match(foreignAttempt.stderr, /Refusing to overwrite foreign bundle/);

      // 4. Refuse to overwrite a symbolic link target
      const symlinkDir = path.join(tmpDir, "SymlinkApps");
      fs.mkdirSync(symlinkDir, { recursive: true });
      fs.symlinkSync(destApp, path.join(symlinkDir, "SELF OS.app"));
      const symlinkAttempt = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_INSTALL_DIR: symlinkDir,
          SELF_OS_URL: "https://synthetic.example:9443",
        },
        encoding: "utf8",
      });
      assert.notEqual(symlinkAttempt.status, 0);
      assert.match(symlinkAttempt.stderr, /Refusing to overwrite symbolic link/);

      const unrelated = path.join(tmpDir, "unrelated.app");
      fs.mkdirSync(unrelated);
      const keep = path.join(unrelated, "keep.txt");
      fs.writeFileSync(keep, "preserve");
      const foreignOutput = spawnSync("sh", [script], {
        env: {
          ...process.env,
          SELF_OS_SKIP_INSTALL: "1",
          SELF_OS_OUTPUT_APP: unrelated,
          SELF_OS_URL: "https://synthetic.example:9443",
        },
        encoding: "utf8",
      });
      assert.notEqual(foreignOutput.status, 0);
      assert.match(foreignOutput.stderr, /Refusing to overwrite foreign bundle or non-bundle target/);
      assert.equal(fs.readFileSync(keep, "utf8"), "preserve");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
);
