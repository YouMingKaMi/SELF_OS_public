-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE task_lists (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  PRIMARY KEY (owner_id, id)
);
ALTER TABLE tasks ADD COLUMN "note" text;
ALTER TABLE tasks ADD COLUMN "list_id" text;
ALTER TABLE tasks ADD COLUMN "prerequisite_ids" jsonb;
