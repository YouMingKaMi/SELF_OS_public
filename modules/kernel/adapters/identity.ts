import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import type {
  Device,
  DeviceKind,
  IdentityStore,
  Secrets,
} from "../application/identity.ts";

const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
export const nodeSecrets: Secrets = {
  secret: () => randomBytes(32).toString("base64url"),
  code: () => {
    const chars = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]);
    return chars.slice(0, 4).join("") + "-" + chars.slice(4).join("");
  },
  id: () => randomUUID(),
  hash: (value) => createHash("sha256").update(value).digest("hex"),
  same: (a, b) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)),
};

const iso = (value: unknown) => (value ? (value as Date).toISOString() : null);
function device(row: Record<string, unknown>): Device & { secretHash: string } {
  return {
    id: String(row.id),
    owner: String(row.owner_id),
    name: String(row.name),
    kind: row.kind as DeviceKind,
    createdAt: (row.created_at as Date).toISOString(),
    lastSeenAt: iso(row.last_seen_at),
    revokedAt: iso(row.revoked_at),
    secretHash: String(row.secret_hash),
  };
}
const publicDevice = ({ secretHash: _secret, ...rest }: Device & { secretHash: string }) => rest;

export class PostgresIdentityStore implements IdentityStore {
  private pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  async addPairing(p: Parameters<IdentityStore["addPairing"]>[0]) {
    await this.pool.query(
      "INSERT INTO identity_pairings(code_hash,owner_id,name,kind,expires_at) VALUES($1,$2,$3,$4,$5)",
      [p.codeHash, p.owner, p.name, p.kind, p.expiresAt],
    );
  }
  async redeem(codeHash: string, now: Date, d: { id: string; secretHash: string }) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query(
        "UPDATE identity_pairings SET used_at=$2 WHERE code_hash=$1 AND used_at IS NULL AND expires_at>$2 RETURNING owner_id,name,kind",
        [codeHash, now],
      );
      if (!rows[0]) {
        await db.query("ROLLBACK");
        return null;
      }
      const created = await db.query(
        "INSERT INTO identity_devices(id,owner_id,name,kind,secret_hash,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *",
        [d.id, rows[0].owner_id, rows[0].name, rows[0].kind, d.secretHash, now],
      );
      await db.query("COMMIT");
      return publicDevice(device(created.rows[0]));
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async device(id: string) {
    const { rows } = await this.pool.query("SELECT * FROM identity_devices WHERE id=$1", [id]);
    return rows[0] ? device(rows[0]) : null;
  }
  async touch(id: string, at: Date) {
    await this.pool.query("UPDATE identity_devices SET last_seen_at=$2 WHERE id=$1", [id, at]);
  }
  async devices(owner?: string) {
    const { rows } = await this.pool.query(
      "SELECT * FROM identity_devices WHERE $1::text IS NULL OR owner_id=$1 ORDER BY created_at",
      [owner ?? null],
    );
    return rows.map((row) => publicDevice(device(row)));
  }
  async revoke(id: string, at: Date) {
    const { rowCount } = await this.pool.query(
      "UPDATE identity_devices SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL",
      [id, at],
    );
    return rowCount === 1;
  }
}

/** Same contract in memory, for tests. */
export class MemoryIdentityStore implements IdentityStore {
  private pairings = new Map<string, { owner: string; name: string; kind: DeviceKind; expiresAt: Date; used: boolean }>();
  private rows = new Map<string, Device & { secretHash: string }>();
  async addPairing(p: Parameters<IdentityStore["addPairing"]>[0]) {
    this.pairings.set(p.codeHash, { ...p, used: false });
  }
  async redeem(codeHash: string, now: Date, d: { id: string; secretHash: string }) {
    const p = this.pairings.get(codeHash);
    if (!p || p.used || p.expiresAt <= now) return null;
    p.used = true;
    const row = {
      id: d.id,
      owner: p.owner,
      name: p.name,
      kind: p.kind,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      revokedAt: null,
      secretHash: d.secretHash,
    };
    this.rows.set(d.id, row);
    return publicDevice(row);
  }
  async device(id: string) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  async touch(id: string, at: Date) {
    const row = this.rows.get(id);
    if (row) row.lastSeenAt = at.toISOString();
  }
  async devices(owner?: string) {
    return [...this.rows.values()].filter((r) => !owner || r.owner === owner).map(publicDevice);
  }
  async revoke(id: string, at: Date) {
    const row = this.rows.get(id);
    if (!row || row.revokedAt) return false;
    row.revokedAt = at.toISOString();
    return true;
  }
}
