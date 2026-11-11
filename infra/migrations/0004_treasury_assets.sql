-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE treasury_assets (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "symbol" text,
  "kind" text NOT NULL CHECK ("kind" IN ('crypto', 'stock')),
  "quote_id" text,
  "currency" text,
  "manual_price" numeric,
  "order" double precision,
  PRIMARY KEY (owner_id, id)
);
ALTER TABLE treasury_entries ADD COLUMN "asset_id" uuid;
ALTER TABLE treasury_entries ADD CONSTRAINT treasury_entries_asset_id_fk FOREIGN KEY (owner_id, "asset_id") REFERENCES treasury_assets(owner_id, id);
CREATE INDEX treasury_entries_asset_id_idx ON treasury_entries (owner_id, "asset_id") WHERE NOT deleted;
