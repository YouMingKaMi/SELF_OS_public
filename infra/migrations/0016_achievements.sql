-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE achievements (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "scope" text NOT NULL CHECK ("scope" IN ('lifetime', 'annual')),
  "year" text,
  "category" text,
  "icon" text,
  "prev_ids" jsonb,
  "current" double precision,
  "target" double precision,
  "unit" text,
  "completed" boolean,
  "completed_at" date,
  "note" text,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX achievements_completed_at_idx ON achievements (owner_id, "completed_at") WHERE NOT deleted;
