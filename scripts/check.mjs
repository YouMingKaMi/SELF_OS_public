/**
 * Architecture rules, enforced on every file. A violation fails `npm run verify`.
 * The architecture rules (see docs/architecture.md), in executable form.
 */
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const skip = new Set([
  ".git",
  "node_modules",
  "dist",
  ".build",
  "test-results",
]);
const files = [];
(function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(item.name)) continue;
    const p = path.join(dir, item.name);
    item.isDirectory() ? walk(p) : files.push(p);
  }
})(root);
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const read = (file) => fs.readFileSync(file, "utf8");
const problems = [];
const fail = (file, message) => problems.push(`${rel(file)}: ${message}`);

// ---------- 1. Markdown links ----------
for (const file of files.filter((f) => f.endsWith(".md")))
  for (const m of read(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), target)))
      fail(file, `broken link ${target}`);
  }

// ---------- 2. Import graph ----------
const sources = files.filter(
  (f) => /\.(ts|tsx|mjs)$/.test(f) && !f.endsWith(".d.ts"),
);
/** @returns {{spec: string, typeOnly: boolean, target: string | null}[]} */
function imports(file) {
  const text = read(file);
  const found = [];
  for (const m of text.matchAll(
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g,
  ))
    found.push({ spec: m[3], typeOnly: !!m[2] });
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    found.push({ spec: m[1], typeOnly: false });
  return found.map((entry) => ({
    ...entry,
    target: entry.spec.startsWith(".")
      ? rel(path.resolve(path.dirname(file), entry.spec))
      : null,
  }));
}
const graph = new Map(sources.map((file) => [rel(file), imports(file)]));
const isTest = (file) => /(^|\/)tests\//.test(file);
const moduleOf = (file) => file.match(/^modules\/([^/]+)\//)?.[1];
const webPackages = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "idb",
  "lunar-typescript",
  "react-markdown",
];

for (const [file, list] of graph) {
  const mod = moduleOf(file);
  for (const { spec, target } of list) {
    const bare = !target && !spec.startsWith("node:");
    const node = spec.startsWith("node:");
    const targetModule = target ? moduleOf(target) : undefined;

    // The contract package depends on nothing.
    if (file.startsWith("packages/contracts/")) {
      if (!target?.startsWith("packages/contracts/"))
        fail(file, `contracts must be self-contained (imports ${spec})`);
      continue;
    }
    if (isTest(file) || file.startsWith("scripts/")) continue;

    if (mod) {
      // Pure domain: own module's domain + contracts, nothing from the runtime.
      if (file.includes("/domain/")) {
        if (!target) fail(file, `domain must not import ${spec}`);
        else if (
          !target.startsWith(`modules/${mod}/domain/`) &&
          !target.startsWith("packages/contracts/")
        )
          fail(
            file,
            `domain may only import its own domain or contracts (imports ${target})`,
          );
      }
      if (mod === "kernel") {
        // The kernel knows no business module; only its adapters touch drivers.
        if (targetModule && targetModule !== "kernel")
          fail(file, `kernel must not depend on module ${targetModule}`);
        if (bare && !file.includes("/adapters/"))
          fail(file, `only kernel adapters may import packages (${spec})`);
        if (node && file.includes("/domain/"))
          fail(file, `domain must not import ${spec}`);
      } else {
        // Business modules: pure rules behind ports. No drivers, no Node APIs.
        if (bare || node)
          fail(file, `business modules must not import ${spec}`);
        if (targetModule === "kernel" && target !== "modules/kernel/index.ts")
          fail(
            file,
            `modules use the kernel only through modules/kernel/index.ts (imports ${target})`,
          );
        if (
          targetModule &&
          targetModule !== mod &&
          targetModule !== "kernel" &&
          target !== `modules/${targetModule}/index.ts`
        )
          fail(
            file,
            `cross-module import must go through modules/${targetModule}/index.ts (imports ${target})`,
          );
      }
      if (target && !targetModule && !target.startsWith("packages/contracts/"))
        fail(
          file,
          `modules may only import modules and contracts (imports ${target})`,
        );
    }

    if (file.startsWith("apps/web/src/")) {
      if (node) fail(file, `web must not import ${spec}`);
      if (bare && !webPackages.includes(spec) && !spec.endsWith(".css"))
        fail(file, `web package not on the allow-list: ${spec}`);
      if (
        target &&
        !target.startsWith("apps/web/") &&
        !target.startsWith("packages/contracts/")
      ) {
        if (
          !targetModule ||
          targetModule === "kernel" ||
          target !== `modules/${targetModule}/index.ts`
        )
          fail(
            file,
            `web may only use pure rules through modules/<name>/index.ts (imports ${target})`,
          );
      }
      // UI → data API only. Storage and network stay inside apps/web/src/data.
      if (
        /^apps\/web\/src\/(features|ui)\//.test(file) ||
        file === "apps/web/src/main.tsx"
      ) {
        if (spec === "idb") fail(file, "screens must not open IndexedDB");
        if (
          target &&
          /^apps\/web\/src\/data\/(db|store|sync)\.ts$/.test(target)
        )
          fail(
            file,
            `screens use data/entities.ts or data/tasks.ts, not ${target}`,
          );
      }
    }

    if (file.startsWith("services/")) {
      if (
        targetModule &&
        target !== `modules/${targetModule}/index.ts` &&
        target !== "modules/kernel/server.ts"
      )
        fail(
          file,
          `services use modules through their public entry (imports ${target})`,
        );
    }
  }
}

// What the browser bundle can reach must be free of server code, transitively.
const resolveTs = (target) =>
  graph.has(target)
    ? target
    : graph.has(target + ".ts")
      ? target + ".ts"
      : null;
const reached = new Set();
(function visit(file) {
  if (reached.has(file)) return;
  reached.add(file);
  for (const { spec, target, typeOnly } of graph.get(file) ?? []) {
    if (typeOnly) continue;
    if (spec.startsWith("node:") || ["pg", "fastify"].includes(spec))
      fail(
        root + "/" + file,
        `reachable from the web bundle but imports ${spec}`,
      );
    const next = target && resolveTs(target);
    if (next) visit(next);
  }
})("apps/web/src/main.tsx");
for (const file of [...graph.keys()].filter((f) =>
  f.startsWith("apps/web/src/"),
))
  if (!reached.has(file) && !file.endsWith(".d.ts"))
    fail(root + "/" + file, "not reachable from main.tsx (dead file)");

// ---------- 3. Purity and forbidden patterns ----------
for (const file of sources.map(rel)) {
  const text = read(path.join(root, file));
  if (
    /^modules\/[^/]+\/domain\//.test(file) &&
    /Date\.now|new Date\(\)|fetch\(|process\.env|Math\.random/.test(text)
  )
    fail(
      root + "/" + file,
      "domain reads the clock, network, environment or randomness",
    );
  if (
    /^modules\/(?!kernel\/)/.test(file) &&
    !isTest(file) &&
    /\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/.test(text)
  )
    fail(
      root + "/" + file,
      "business modules must not contain SQL; ask through the Reader port",
    );
  if (
    /^apps\/web\/src\/(features|ui)\//.test(file) &&
    /\bfetch\(|indexedDB\b/.test(text)
  )
    fail(
      root + "/" + file,
      "screens must not call the network or IndexedDB directly",
    );
}
for (const file of files.map(rel).filter((f) => f.endsWith(".swift"))) {
  const text = read(path.join(root, file));
  if (
    file.startsWith("apps/ios/CouncilApp/Features/") &&
    /import GRDB|URLSession|DatabaseQueue/.test(text)
  )
    fail(
      root + "/" + file,
      "views must not touch the database or network; go through AppModel",
    );
  if (
    /^apps\/ios\/CouncilCore\/Sources\/CouncilCore\/\w*(Rules|Math|Fraction)\.swift$/.test(
      file,
    ) &&
    /import GRDB|URLSession/.test(text)
  )
    fail(root + "/" + file, "rules must stay pure");
}

// ---------- 4. Schema ownership ----------
const schemaText = read(path.join(root, "packages/contracts/schema.ts"));
const owners = new Set(
  [...schemaText.matchAll(/entity\(\s*"([a-z]+)"/g)].map((m) => m[1]),
);
for (const owner of owners)
  if (!fs.existsSync(path.join(root, "modules", owner)))
    fail(
      path.join(root, "packages/contracts/schema.ts"),
      `entity owner module "${owner}" does not exist`,
    );
for (const dir of fs.readdirSync(path.join(root, "modules")))
  if (dir !== "kernel" && !dir.startsWith(".") && !owners.has(dir))
    fail(
      path.join(root, "modules", dir),
      "module owns no entity in the schema",
    );

// ---------- 5. HTTP contract shape ----------
const contract = JSON.parse(
  read(path.join(root, "packages/contracts/openapi.json")),
);
const contractFile = path.join(root, "packages/contracts/openapi.json");
if (contract.openapi !== "3.1.1") fail(contractFile, "expected OpenAPI 3.1.1");
const operations = new Set();
for (const entry of Object.values(contract.paths))
  for (const [method, operation] of Object.entries(entry)) {
    if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
    if (!operation.operationId || operations.has(operation.operationId))
      fail(contractFile, "missing or duplicate operationId");
    operations.add(operation.operationId);
    if (!operation.responses)
      fail(contractFile, `${operation.operationId}: responses missing`);
  }
(function refs(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    let p = contract;
    for (const key of value.$ref.slice(2).split("/")) p = p?.[key];
    if (!value.$ref.startsWith("#/") || !p)
      fail(contractFile, `unresolved ref ${value.$ref}`);
  }
  for (const child of Object.values(value)) refs(child);
})(contract);

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} architecture violation(s).`);
  process.exit(1);
}
console.log(
  `Architecture checks passed: ${graph.size} source files, ${reached.size} reachable from the web entry, ${owners.size} modules, ${operations.size} API operations, Markdown links.`,
);
