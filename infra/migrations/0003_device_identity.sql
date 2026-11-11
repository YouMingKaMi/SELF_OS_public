-- Hand-written: device identity is protocol state, not a synchronised entity. Applied migrations are immutable.
-- A one-time pairing code is stored only as a hash and is exchanged once for a revocable device credential.
CREATE TABLE identity_pairings (
  code_hash text PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('web', 'phone', 'cli')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The credential is `<deviceId>.<secret>`; only a hash of the secret is kept.
CREATE TABLE identity_devices (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('web', 'phone', 'cli')),
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX identity_devices_owner_idx ON identity_devices (owner_id);
