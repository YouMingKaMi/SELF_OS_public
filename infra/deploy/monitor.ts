import { execFile } from "node:child_process";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const hour = 60 * 60;
const historySeconds = 7 * 24 * hour;
const historyLimit = 7 * 24 * 4;

const capacitySQL = `
SELECT jsonb_build_object(
  'databaseBytes', pg_database_size(current_database()),
  'indexBytes', coalesce(sum(pg_indexes_size(relid)), 0),
  'receiptBytes', coalesce(sum(pg_total_relation_size(relid)) FILTER (
    WHERE relname IN ('sync_receipts', 'sync_receipts_archive')
  ), 0),
  'snapshotBytes', coalesce(sum(pg_total_relation_size(relid)) FILTER (WHERE relname = 'sync_snapshot_rows'), 0),
  'estimatedReceipts', coalesce(sum(n_live_tup) FILTER (
    WHERE relname IN ('sync_receipts', 'sync_receipts_archive')
  ), 0),
  'estimatedSyncHeads', coalesce(sum(n_live_tup) FILTER (WHERE relname = 'sync_heads'), 0),
  'observedTupleReads', coalesce(sum(coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)), 0),
  'activeLockWaits', (
    SELECT count(*) FROM pg_locks
    WHERE NOT granted AND pid IN (SELECT pid FROM pg_stat_activity WHERE datname = current_database())
  )
) FROM pg_stat_user_tables WHERE schemaname = 'council'
HAVING count(*) FILTER (WHERE relname IN ('sync_receipts', 'sync_heads')) = 2
`;

function integerSetting(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env["COUNCIL_MONITOR_" + key] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid monitor setting " + key);
  return value;
}

export function configuration(env: NodeJS.ProcessEnv) {
  const number = (...args: [string, number, number, number]) => integerSetting(env, ...args);
  return {
    stateDirectory: env.STATE_DIRECTORY ?? "/var/lib/council-next-monitor",
    backupStatus: env.COUNCIL_MONITOR_BACKUP_STATUS ?? "/var/lib/council-next-backup-status/latest.json",
    dataDisk: env.COUNCIL_MONITOR_DATA_DISK ?? "/var/lib/postgresql",
    backupDisk: env.COUNCIL_MONITOR_BACKUP_DISK ?? "/var/backups",
    database: env.COUNCIL_MONITOR_DB ?? "council_next",
    port: number("API_PORT", 8790, 1, 65535),
    limits: {
      apiMilliseconds: number("API_MAX_MS", 1500, 1, 3500),
      backupSeconds: number("BACKUP_MAX_HOURS", 36, 1, 720) * hour,
      diskUsedPercent: number("DISK_MAX_PERCENT", 85, 1, 100),
      lockWaits: number("LOCK_WAIT_LIMIT", 2, 0, 1000),
      consecutive: number("BREACH_SAMPLES", 2, 1, 20),
      cooldownSeconds: number("ALERT_COOLDOWN_MINUTES", 60, 1, 10080) * 60,
    },
  };
}

type Configuration = ReturnType<typeof configuration>;
type Limits = Configuration["limits"];
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const capacityFields = [
  "databaseBytes", "indexBytes", "receiptBytes", "snapshotBytes", "estimatedReceipts",
  "estimatedSyncHeads", "observedTupleReads", "activeLockWaits",
] as const;
type ApiSample = { status: number | null; milliseconds: number | null };
type DatabaseSample = Record<(typeof capacityFields)[number], number> & { milliseconds: number };
type DiskSample = { usedPercent: number; availableBytes: number };
type BackupSample = { ageSeconds: number; archiveBytes: number; durationSeconds: number; restoreSeconds: number };
export type Sample = {
  at: number;
  api: ApiSample;
  database: DatabaseSample | null;
  dataDisk: DiskSample | null;
  backupDisk: DiskSample | null;
  backup: BackupSample | null;
};
type Active = Record<string, { consecutive: number; lastAlertAt: number | null }>;
type Previous = { samples: Sample[]; active: Active };

async function probeAPI(port: number): Promise<ApiSample> {
  const started = performance.now();
  try {
    // This protected endpoint responds with 401 without touching personal data.
    const response = await fetch(`http://127.0.0.1:${port}/v1/sync-state`, {
      redirect: "manual",
      signal: AbortSignal.timeout(3500),
    });
    const milliseconds = Math.round(performance.now() - started);
    await response.body?.cancel();
    return { status: response.status, milliseconds };
  } catch {
    return { status: null, milliseconds: null };
  }
}

async function probeDatabase(database: string): Promise<DatabaseSample | null> {
  const started = performance.now();
  try {
    const { stdout } = await execute("psql", [
      "-XqAt", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", capacitySQL,
    ], {
      timeout: 6000,
      maxBuffer: 8192,
      env: {
        ...process.env,
        PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=4000",
        PGCONNECT_TIMEOUT: "3",
      },
    });
    const row = JSON.parse(stdout);
    if (capacityFields.some((field) => !isCount(row[field]))) return null;
    return {
      ...Object.fromEntries(capacityFields.map((field) => [field, row[field]])),
      milliseconds: Math.round(performance.now() - started),
    } as DatabaseSample;
  } catch {
    // psql errors may contain connection details.
    return null;
  }
}

async function probeDisk(path: string): Promise<DiskSample | null> {
  try {
    const { blocks, bavail, bsize } = await statfs(path);
    if (blocks <= 0) return null;
    return {
      usedPercent: Math.max(0, Math.ceil(100 * (blocks - bavail) / blocks)),
      availableBytes: Math.max(0, bavail * bsize),
    };
  } catch {
    return null;
  }
}

async function probeBackup(path: string, at: number): Promise<BackupSample | null> {
  try {
    const { snapshotAt, archiveBytes, durationSeconds, restoreSeconds } =
      JSON.parse(await readFile(path, "utf8"));
    if (![snapshotAt, archiveBytes, durationSeconds, restoreSeconds].every(isCount) ||
        snapshotAt === 0 || archiveBytes === 0 || snapshotAt > at || restoreSeconds > durationSeconds) {
      return null;
    }
    return { ageSeconds: at - snapshotAt, archiveBytes, durationSeconds, restoreSeconds };
  } catch {
    return null;
  }
}

export async function collect(config: Configuration): Promise<Sample> {
  const at = Math.floor(Date.now() / 1000);
  const [api, database, dataDisk, backupDisk, backup] = await Promise.all([
    probeAPI(config.port), probeDatabase(config.database), probeDisk(config.dataDisk),
    probeDisk(config.backupDisk), probeBackup(config.backupStatus, at),
  ]);
  return { at, api, database, dataDisk, backupDisk, backup };
}

function breaches(sample: Sample, limits: Limits) {
  const { api, database, dataDisk, backupDisk, backup } = sample;
  const checks = {
    api_unavailable: api.status !== 401,
    api_slow: api.status === 401 && (api.milliseconds ?? 0) > limits.apiMilliseconds,
    database_unavailable: database === null,
    database_lock_waits: (database?.activeLockWaits ?? 0) > limits.lockWaits,
    data_disk_unavailable: dataDisk === null,
    data_disk_full: (dataDisk?.usedPercent ?? 0) >= limits.diskUsedPercent,
    backup_disk_unavailable: backupDisk === null,
    backup_disk_full: (backupDisk?.usedPercent ?? 0) >= limits.diskUsedPercent,
    backup_missing: backup === null,
    backup_stale: backup !== null && backup.ageSeconds > limits.backupSeconds,
  };
  return Object.entries(checks).filter(([, triggered]) => triggered).map(([name]) => name);
}

function latencies(values: (number | null | undefined)[]) {
  const ordered = values.filter(isCount).sort((a, b) => a - b);
  return ordered.length ? {
    samples: ordered.length,
    p50Milliseconds: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95Milliseconds: ordered[Math.ceil(ordered.length * 0.95) - 1],
  } : { samples: 0, p50Milliseconds: null, p95Milliseconds: null };
}

export function update(previous: Previous, sample: Sample, limits: Limits) {
  const active: Active = {};
  const alerts: { state: "alert" | "recovered"; name: string }[] = [];
  for (const name of breaches(sample, limits)) {
    const prior = previous.active[name];
    const state = { consecutive: (prior?.consecutive ?? 0) + 1, lastAlertAt: prior?.lastAlertAt ?? null };
    if (state.consecutive >= limits.consecutive &&
        (state.lastAlertAt === null || sample.at - state.lastAlertAt >= limits.cooldownSeconds)) {
      state.lastAlertAt = sample.at;
      alerts.push({ state: "alert", name });
    }
    active[name] = state;
  }
  for (const [name, prior] of Object.entries(previous.active)) {
    if (!Object.hasOwn(active, name) && prior.lastAlertAt !== null) alerts.push({ state: "recovered", name });
  }
  const samples = [...previous.samples.filter((row) => row.at > sample.at - historySeconds && row.at <= sample.at), sample]
    .slice(-historyLimit);
  const lastDay = samples.filter((row) => row.at > sample.at - 24 * hour);
  return {
    history: {
      version: 1,
      samples,
      active,
      latency: {
        api: latencies(lastDay.map((row) => row.api.status === 401 ? row.api.milliseconds : null)),
        database: latencies(lastDay.map((row) => row.database?.milliseconds)),
      },
    },
    alerts,
  };
}

async function monitor() {
  const config = configuration(process.env);
  const stateFile = join(config.stateDirectory, "history.json");
  let previous: Previous = { samples: [], active: {} };
  try {
    const json = JSON.parse(await readFile(stateFile, "utf8"));
    if (json.version !== 1 || !Array.isArray(json.samples) || typeof json.active !== "object" || !json.active)
      throw new Error("Invalid monitor state");
    previous = json;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sample = await collect(config);
  const { history, alerts } = update(previous, sample, config.limits);
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  const staged = stateFile + ".new";
  await writeFile(staged, JSON.stringify(history) + "\n", { mode: 0o600 });
  await rename(staged, stateFile);
  for (const { state, name } of alerts) {
    const severity = state === "alert" ? 4 : 6;
    console.log("<" + severity + ">selfos_monitor " + state + " " + name);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  monitor().catch(() => {
    console.error("<3>selfos_monitor failed to collect or persist state");
    process.exitCode = 1;
  });
}
