-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE memoir_entries (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "period" text NOT NULL CHECK ("period" IN ('high_school', 'middle_school', 'primary_and_below')),
  "title" text NOT NULL,
  "approx_time" text,
  "detail" text,
  "order" double precision,
  PRIMARY KEY (owner_id, id)
);
