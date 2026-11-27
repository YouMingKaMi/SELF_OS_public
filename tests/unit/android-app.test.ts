import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../..");
const android = path.join(repo, "apps/android");
const main = path.join(android, "app/src/main");
const script = path.join(repo, "scripts/build-android-apk.sh");
const javaSource = "java/org/personalcouncil/next/android";
const read = (file: string) => fs.readFileSync(file, "utf8");

test("Android manifest grants only network permissions and disables global cleartext and backups", () => {
  const manifest = read(path.join(main, "AndroidManifest.xml"));
  const permissions = [...manifest.matchAll(/<uses-permission\b[^>]*\bandroid:name="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(permissions, ["android.permission.ACCESS_NETWORK_STATE", "android.permission.INTERNET"]);
  assert.equal([...manifest.matchAll(/<uses-permission[\w-]*\b/g)].length, permissions.length);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.doesNotMatch(manifest, /android:usesCleartextTraffic="true"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(manifest, /android:enableOnBackInvokedCallback="true"/);
  assert.match(manifest, /android:resource="@xml\/shortcuts"/);
  assert.equal([...manifest.matchAll(/<activity\b/g)].length, 1);
  assert.doesNotMatch(manifest, /<provider\b|<receiver\b|<service\b|android.intent.action.VIEW/);
  const shortcut = read(path.join(main, "res/xml/shortcuts.xml"));
  assert.match(shortcut, /android:action="org\.personalcouncil\.next\.android\.CONNECTION_SETTINGS"/);
  assert.match(shortcut, /android:targetClass="org\.personalcouncil\.next\.android\.MainActivity"/);
});

test("Android cleartext exceptions match the three local endpoints exactly", () => {
  const config = read(path.join(main, "res/xml/network_security_config.xml"));
  assert.match(config, /<base-config cleartextTrafficPermitted="false"\s*\/>/);
  const cleartext = [...config.matchAll(/<domain-config cleartextTrafficPermitted="true">([\s\S]*?)<\/domain-config>/g)];
  assert.equal(cleartext.length, 1);
  assert.equal([...config.matchAll(/cleartextTrafficPermitted="true"/g)].length, 1);
  assert.equal([...config.matchAll(/<domain-config\b/g)].length, 1);
  const domains = [...cleartext[0]![1]!.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)];
  assert.deepEqual(domains.map((match) => match[1]).sort(), ["10.0.2.2", "127.0.0.1", "localhost"]);
  assert.equal([...config.matchAll(/<domain(?=\s|>)/g)].length, domains.length);
  const core = read(path.join(main, javaSource, "SelfOSAndroidCore.kt"));
  assert.match(core, /localHosts = setOf\("127\.0\.0\.1", "localhost", "10\.0\.2\.2"\)/);
  assert.doesNotMatch(core, /^import android\./m);
});

test("Android toolchain, empty endpoint default, bridge and icons match the shell contract", () => {
  const appBuild = read(path.join(android, "app/build.gradle.kts"));
  const rootBuild = read(path.join(android, "build.gradle.kts"));
  const wrapper = read(path.join(android, "gradle/wrapper/gradle-wrapper.properties"));
  const wrapperJar = fs.readFileSync(path.join(android, "gradle/wrapper/gradle-wrapper.jar"));
  assert.equal(createHash("sha256").update(wrapperJar).digest("hex"),
    "2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046");
  assert.notEqual(fs.statSync(path.join(android, "gradlew")).mode & 0o111, 0);
  assert.ok(fs.existsSync(path.join(android, "gradlew.bat")));
  assert.match(rootBuild, /id\("com.android.application"\) version "8\.7\.3"/);
  assert.match(rootBuild, /id\("org.jetbrains.kotlin.android"\) version "2\.0\.21"/);
  assert.match(wrapper, /^distributionUrl=.*gradle-8\.11\.1-bin\.zip$/m);
  assert.match(wrapper, /^distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6$/m);
  assert.match(appBuild, /compileSdk = 35\s+defaultConfig\s+\{\s+applicationId = "org\.personalcouncil\.next\.android"\s+minSdk = 26\s+targetSdk = 35\s+versionCode = 20\s+versionName = "0\.3\.14"/);
  assert.match(appBuild, /gradleProperty\("selfOsEndpoint"\)\)\s+\.orElse\(""\)/);
  assert.match(appBuild, /buildConfigField\("String", "DEFAULT_ENDPOINT",/);
  const activity = read(path.join(main, javaSource, "MainActivity.kt"));
  for (const setting of [
    "allowFileAccess = false", "allowContentAccess = false",
    "mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW",
    "setAcceptThirdPartyCookies(view, false)", "checkUriPermission(",
    "WebViewCompat.addDocumentStartJavaScript", "setOf(origin.toUrl())",
    "if (window !== window.top) return;", "if (capability != token) return fallback",
    "if (!closed && trustedPage(view))", "handler.cancel()",
    "--android-inset-top", "--android-inset-bottom", "window.__selfOSHandleBack",
  ]) assert.ok(activity.includes(setting), setting);
  assert.doesNotMatch(activity, /handler\.proceed\(|allowFileAccess\s*=\s*true|allowContentAccess\s*=\s*true/);
  assert.equal([...activity.matchAll(/@JavascriptInterface/g)].length, 6);

  const publicHosts = new Set(["schemas.android.com", "services.gradle.org"]);
  for (const source of [appBuild, rootBuild, wrapper, activity, read(path.join(main, javaSource, "SelfOSAndroidCore.kt")), read(script)]) {
    for (const match of source.replaceAll("\\:", ":").matchAll(/https?:\/\/([\w.-]+)/gi)) {
      assert.ok(publicHosts.has(match[1]!), "Android build sources contain a hard-coded server hostname");
    }
  }

  for (const [density, legacy, adaptive] of [
    ["mdpi", 48, 108], ["hdpi", 72, 162], ["xhdpi", 96, 216], ["xxhdpi", 144, 324], ["xxxhdpi", 192, 432],
  ] as const) {
    for (const [icon, size] of [["ic_launcher", legacy], ["ic_launcher_round", legacy], ["ic_launcher_foreground", adaptive]] as const) {
      const data = fs.readFileSync(path.join(main, "res", "mipmap-" + density, icon + ".png"));
      assert.equal(data.toString("ascii", 12, 16), "IHDR");
      assert.equal(data.readUInt32BE(16), size);
      assert.equal(data.readUInt32BE(20), size);
    }
  }
  for (const icon of ["ic_launcher", "ic_launcher_round"]) {
    const drawable = read(path.join(main, "res/mipmap-anydpi-v26", icon + ".xml"));
    assert.match(drawable, /<adaptive-icon\b/);
    assert.match(drawable, /@color\/icon_background/);
    assert.match(drawable, /@mipmap\/ic_launcher_foreground/);
  }
});

function temporaryDirectory(t: { after: (callback: () => void) => void }): string {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "selfos-android-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return temp;
}

function fixture(t: { after: (callback: () => void) => void }) {
  const temp = temporaryDirectory(t);
  const root = path.join(temp, "repo");
  const home = path.join(temp, "home");
  const write = (name: string, value: string, executable = false) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: executable ? 0o700 : 0o600 });
  };
  write("scripts/build-android-apk.sh", read(script));
  write("sdk/platforms/android-35/android.jar", "");
  write("apps/android/gradle/wrapper/gradle-wrapper.jar", "");
  write("jdk/bin/java", "#!/bin/sh\nexit 99\n", true);
  write("jdk/bin/javac", "#!/bin/sh\nexit 99\n", true);
  write("jdk/bin/keytool", `#!/bin/sh
set -eu
printf '%s\\n' keytool >> "$FIXTURE_LOG"
[ -n "$SELF_OS_ANDROID_STORE_PASS" ] && [ -n "$SELF_OS_ANDROID_KEY_PASS" ]
while [ "$#" -gt 0 ]; do
  if [ "$1" = -keystore ]; then printf 'fake keystore' > "$2"; exit 0; fi
  shift
done
exit 1
`, true);
  write("bin/openssl", "#!/bin/sh\nprintf '%064d\\n' 42\n", true);
  write("apps/android/gradlew", `#!/bin/sh
[ -z "$SELF_OS_ANDROID_STORE_PASS" ] && [ -z "$SELF_OS_ANDROID_KEY_PASS" ] || exit 1
set -eu
for arg do
  case "$arg" in
    -PselfOsBuildDirectory=*) dir=\${arg#*=} ;;
    testDebugUnitTest|assembleDebug|assembleRelease) task=$arg ;;
  esac
done
printf '%s:%s\\n' "$task" "$SELF_OS_ANDROID_BUILD_ENDPOINT" >> "$FIXTURE_LOG"
printf '%s\\n' "$SELF_OS_ANDROID_BUILD_ENDPOINT" >&2
case "$task" in
  assembleDebug) mkdir -p "$dir/outputs/apk/debug"; printf debug > "$dir/outputs/apk/debug/app-debug.apk" ;;
  assembleRelease) mkdir -p "$dir/outputs/apk/release"; printf unsigned > "$dir/outputs/apk/release/app-release-unsigned.apk" ;;
esac
`, true);
  write("sdk/build-tools/35.0.0/apksigner", `#!/bin/sh
set -eu
operation=$1
shift
printf '%s\\n' "$operation" >> "$FIXTURE_LOG"
case "$operation" in
  sign)
    [ -n "$SELF_OS_ANDROID_STORE_PASS" ] && [ -n "$SELF_OS_ANDROID_KEY_PASS" ]
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --ks-pass) [ "$2" = env:SELF_OS_ANDROID_STORE_PASS ] ;;
        --key-pass) [ "$2" = env:SELF_OS_ANDROID_KEY_PASS ] ;;
        --out) printf signed > "$2"; exit 0 ;;
      esac
      shift
    done
    exit 1 ;;
  verify) [ -s "$1" ] && [ "\${FIXTURE_REJECT:-0}" != 1 ] ;;
  *) exit 1 ;;
esac
`, true);
  const log = path.join(root, "commands.log");
  const run = (env: NodeJS.ProcessEnv, args: string[] = []) =>
    spawnSync("sh", [path.join(root, "scripts/build-android-apk.sh"), ...args], {
      cwd: root,
      env: {
        PATH: root + "/bin:/usr/bin:/bin",
        HOME: home,
        JAVA_HOME: path.join(root, "jdk"),
        ANDROID_HOME: path.join(root, "sdk"),
        FIXTURE_LOG: log,
        TMPDIR: root,
        ...env,
      },
      encoding: "utf8",
    });
  return { root, write, log, run, home };
}

test("Android build syntax, default endpoint and APK verification work with offline fixtures", (t) => {
  const syntax = spawnSync("sh", ["-n", script], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const { root, log, run } = fixture(t);
  const result = run({ SELF_OS_ANDROID_VARIANT: "debug", ORG_GRADLE_PROJECT_selfOsEndpoint: "do-not-use.example.test" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(log), "testDebugUnitTest:\nassembleDebug:\nverify\n");
  const apk = path.join(root, ".build/android/SELF-OS-0.3.14-debug.apk");
  assert.equal(read(apk), "debug");
  assert.equal(read(apk + ".sha256"), createHash("sha256").update("debug").digest("hex") + "  SELF-OS-0.3.14-debug.apk\n");
  const rejected = run({ SELF_OS_ANDROID_VARIANT: "debug", FIXTURE_REJECT: "1" }, ["--skip-tests"]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /signature verification failed/);
  assert.equal(read(apk), "debug");
});

test("Android build reads site.env as data and conceals private endpoints from logs", (t) => {
  const { root, write, log, run } = fixture(t);
  write("infra/deploy/site.env", [
    "COUNCIL_SITE = 'private-site.example.test:9443' # private",
    "touch forbidden",
    "ANOTHER_SETTING=$(touch forbidden)",
  ].join("\n"));
  const result = run({ SELF_OS_ANDROID_VARIANT: "debug" }, ["--with-site-env", "--skip-tests"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(log), "assembleDebug:https://private-site.example.test:9443\nverify\n");
  assert.doesNotMatch(result.stdout + result.stderr, /private-site\.example\.test/);
  assert.equal(fs.existsSync(path.join(root, "forbidden")), false);

  const leaked = run({ SELF_OS_ANDROID_VARIANT: "debug", SELF_OS_URL: "https://user:credential@private-site.example.test" });
  assert.notEqual(leaked.status, 0);
  assert.doesNotMatch(leaked.stdout + leaked.stderr, /credential|private-site\.example\.test/);

  fs.writeFileSync(log, "");
  const personal = run({ SELF_OS_ANDROID_VARIANT: "debug", SELF_OS_URL: "https://private-site.example.test/path?token=discard" });
  assert.equal(personal.status, 0, personal.stderr);
  assert.equal(read(log), "testDebugUnitTest:https://private-site.example.test\nassembleDebug:https://private-site.example.test\nverify\n");

  write("infra/deploy/site.env", "COUNCIL_SITE=$(touch forbidden)\n");
  const injected = run({ SELF_OS_ANDROID_VARIANT: "debug" }, ["--with-site-env"]);
  assert.notEqual(injected.status, 0);
  assert.equal(fs.existsSync(path.join(root, "forbidden")), false);
});

test("Android release uses a private signing pair and reuses it on the next build", (t) => {
  // Use substitute keytool/apksigner commands in a temporary home.
  const { root, log, run, home } = fixture(t);
  const output = path.join(root, "outputs/SELF OS.apk");
  const first = run({ SELF_OS_OUTPUT_APK: output });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(read(log), "testDebugUnitTest:\nassembleRelease:\nkeytool\nsign\nverify\n");
  assert.equal(read(output), "signed");
  const config = path.join(home, ".config/self-os");
  for (const name of ["android-release.jks", "android-release.env"]) {
    assert.equal(fs.statSync(path.join(config, name)).mode & 0o777, 0o600);
  }
  fs.writeFileSync(log, "");
  const second = run({ SELF_OS_OUTPUT_APK: output }, ["--skip-tests"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(read(log), "assembleRelease:\nsign\nverify\n");
});

const runGradle = process.env.SELF_OS_ANDROID_TEST_GRADLE === "1";
test("Android Kotlin JVM tests pass using the installed SDK and offline Gradle cache", {
  skip: runGradle ? false : "set SELF_OS_ANDROID_TEST_GRADLE=1 with SDK 35 and a populated offline Gradle cache",
}, (t) => {
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle");
  const wrapperCache = path.join(gradleHome, "wrapper/dists/gradle-8.11.1-bin");
  assert.ok(fs.existsSync(wrapperCache) && fs.readdirSync(wrapperCache).some((directory) =>
    fs.existsSync(path.join(wrapperCache, directory, "gradle-8.11.1-bin.zip.ok")) &&
    fs.existsSync(path.join(wrapperCache, directory, "gradle-8.11.1/bin/gradle"))),
  "Prime the Gradle 8.11.1 wrapper cache before enabling the offline test.");
  const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Library/Android/sdk"),
    "/opt/homebrew/share/android-commandlinetools"].find((candidate) =>
    candidate && fs.existsSync(path.join(candidate, "platforms/android-35/android.jar")));
  assert.ok(sdk, "Install SDK Platform 35 or set ANDROID_HOME.");
  assert.ok(fs.existsSync(path.join(android, "gradlew")) && fs.existsSync(path.join(android, "gradle/wrapper/gradle-wrapper.jar")),
    "Generate the Gradle wrapper following work/android-apk.md.");
  const temp = temporaryDirectory(t);
  const result = spawnSync("./gradlew", [
    "--offline", "--no-daemon", "--no-build-cache", "--no-configuration-cache", "--project-cache-dir", path.join(temp, "cache"),
    "-PselfOsBuildDirectory=" + path.join(temp, "app"), "testDebugUnitTest",
  ], {
    cwd: android,
    env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, SELF_OS_ANDROID_BUILD_ENDPOINT: "" },
    encoding: "utf8",
    timeout: 240_000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr + result.stdout);
});
