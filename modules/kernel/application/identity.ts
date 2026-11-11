/**
 * Who is calling. A device pairs once with a short one-time code and receives a revocable credential;
 * every request then derives owner and device from that credential, never from the request body.
 */
export type DeviceKind = "web" | "phone" | "cli";
export type Caller = { owner: string; device: string };
export type Device = {
  id: string;
  owner: string;
  name: string;
  kind: DeviceKind;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type IdentityStore = {
  addPairing(p: {
    codeHash: string;
    owner: string;
    name: string;
    kind: DeviceKind;
    expiresAt: Date;
  }): Promise<void>;
  /** Atomically mark an unexpired, unused pairing as used and create its device; null if none matched. */
  redeem(
    codeHash: string,
    now: Date,
    device: { id: string; secretHash: string },
  ): Promise<Device | null>;
  device(id: string): Promise<(Device & { secretHash: string }) | null>;
  touch(id: string, at: Date): Promise<void>;
  devices(owner?: string): Promise<Device[]>;
  revoke(id: string, at: Date): Promise<boolean>;
};

/** Randomness and hashing come from the adapter so this file stays free of runtime APIs. */
export type Secrets = {
  /** A credential secret: at least 256 random bits, URL-safe. */
  secret(): string;
  /** A pairing code from an unambiguous alphabet, e.g. `K7QX-M2PD`. */
  code(): string;
  id(): string;
  hash(value: string): string;
  same(a: string, b: string): boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Codes are typed by hand: ignore case, spaces and dashes. */
export const normalizeCode = (code: string) =>
  code.toUpperCase().replace(/[\s-]/g, "");

export class IdentityService {
  private store: IdentityStore;
  private secrets: Secrets;
  private now: () => Date;
  constructor(store: IdentityStore, secrets: Secrets, now: () => Date) {
    this.store = store;
    this.secrets = secrets;
    this.now = now;
  }

  /** Server-side only (the admin command). The code is shown once and never stored in clear. */
  async createPairing(input: {
    owner: string;
    name: string;
    kind: DeviceKind;
    minutes?: number;
  }) {
    const code = this.secrets.code();
    const expiresAt = new Date(
      this.now().getTime() + (input.minutes ?? 10) * 60_000,
    );
    await this.store.addPairing({
      codeHash: this.secrets.hash("pair:" + normalizeCode(code)),
      owner: input.owner,
      name: input.name,
      kind: input.kind,
      expiresAt,
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** Exchange a code for a credential. Returns null for any unknown, used or expired code. */
  async pair(code: string) {
    const normalized = normalizeCode(code);
    if (!/^[A-Z0-9]{6,16}$/.test(normalized)) return null;
    const id = this.secrets.id();
    const secret = this.secrets.secret();
    const device = await this.store.redeem(
      this.secrets.hash("pair:" + normalized),
      this.now(),
      { id, secretHash: this.secrets.hash("device:" + secret) },
    );
    return device ? { device, credential: id + "." + secret } : null;
  }

  async authenticate(credential: string | undefined): Promise<Caller | null> {
    if (!credential) return null;
    const dot = credential.indexOf(".");
    const id = credential.slice(0, dot);
    const secret = credential.slice(dot + 1);
    if (dot < 0 || !uuid.test(id) || secret.length < 32 || secret.length > 128)
      return null;
    const device = await this.store.device(id);
    if (!device || device.revokedAt) return null;
    if (!this.secrets.same(device.secretHash, this.secrets.hash("device:" + secret)))
      return null;
    // Last-seen is informational; write it at most hourly.
    const now = this.now();
    if (
      !device.lastSeenAt ||
      now.getTime() - Date.parse(device.lastSeenAt) > 3_600_000
    )
      await this.store.touch(id, now);
    return { owner: device.owner, device: device.id };
  }

  devices(owner?: string) {
    return this.store.devices(owner);
  }
  revoke(id: string) {
    return uuid.test(id) ? this.store.revoke(id, this.now()) : Promise.resolve(false);
  }
}
