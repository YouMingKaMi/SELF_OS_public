-- Old clients can still use the unscoped v1 change stream.
ALTER TABLE sync_clock ADD COLUMN dataset_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sync_clock ADD COLUMN generation uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE sync_snapshots (
  owner_id text PRIMARY KEY REFERENCES sync_clock(owner_id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE,
  dataset_id uuid NOT NULL,
  generation uuid NOT NULL,
  watermark bigint NOT NULL,
  total integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sync_snapshots_expiry ON sync_snapshots (expires_at);

CREATE TABLE sync_snapshot_rows (
  snapshot_id uuid NOT NULL REFERENCES sync_snapshots(id) ON DELETE CASCADE,
  position bigint NOT NULL,
  entity jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, position)
);
