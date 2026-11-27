-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE reading_items (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "title" text NOT NULL,
  "source" text,
  "note" text,
  "status" text NOT NULL CHECK ("status" IN ('unread', 'read')),
  PRIMARY KEY (owner_id, id)
);
