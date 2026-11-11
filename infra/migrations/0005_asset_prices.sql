-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE treasury_asset_prices (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "asset_id" uuid NOT NULL,
  "at" timestamptz NOT NULL,
  "price" numeric NOT NULL,
  PRIMARY KEY (owner_id, id)
);
ALTER TABLE treasury_asset_prices ADD CONSTRAINT treasury_asset_prices_asset_id_fk FOREIGN KEY (owner_id, "asset_id") REFERENCES treasury_assets(owner_id, id);
CREATE INDEX treasury_asset_prices_asset_id_idx ON treasury_asset_prices (owner_id, "asset_id") WHERE NOT deleted;
