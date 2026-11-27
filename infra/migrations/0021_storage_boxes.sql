-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE storage_boxes (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "zone" text NOT NULL,
  "name" text NOT NULL,
  "icon" text,
  "location" text,
  "order" double precision,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE storage_items (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('in_box', 'out')),
  "box_id" uuid,
  "home_box_id" uuid,
  "taken_at" timestamptz,
  "quantity" integer,
  "aliases" text,
  "note" text,
  "verified_at" timestamptz,
  PRIMARY KEY (owner_id, id)
);
ALTER TABLE storage_items ADD CONSTRAINT storage_items_box_id_fk FOREIGN KEY (owner_id, "box_id") REFERENCES storage_boxes(owner_id, id);
ALTER TABLE storage_items ADD CONSTRAINT storage_items_home_box_id_fk FOREIGN KEY (owner_id, "home_box_id") REFERENCES storage_boxes(owner_id, id);
CREATE INDEX storage_items_box_id_idx ON storage_items (owner_id, "box_id") WHERE NOT deleted;
CREATE INDEX storage_items_home_box_id_idx ON storage_items (owner_id, "home_box_id") WHERE NOT deleted;
