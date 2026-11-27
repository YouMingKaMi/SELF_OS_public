-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE practice_events (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "domain_id" uuid NOT NULL,
  "activity_id" uuid,
  "reading_item_id" text,
  "title" text NOT NULL,
  "note" text,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'active', 'resolved', 'discarded')),
  PRIMARY KEY (owner_id, id)
);
ALTER TABLE practice_sessions ADD COLUMN "event_id" uuid;
ALTER TABLE practice_progress ADD COLUMN "event_id" uuid;
ALTER TABLE reading_items ADD COLUMN "tags" jsonb;
ALTER TABLE practice_events ADD CONSTRAINT practice_events_domain_id_fk FOREIGN KEY (owner_id, "domain_id") REFERENCES practice_domains(owner_id, id);
ALTER TABLE practice_events ADD CONSTRAINT practice_events_activity_id_fk FOREIGN KEY (owner_id, "activity_id") REFERENCES practice_activities(owner_id, id);
CREATE INDEX practice_events_domain_id_idx ON practice_events (owner_id, "domain_id") WHERE NOT deleted;
CREATE INDEX practice_events_activity_id_idx ON practice_events (owner_id, "activity_id") WHERE NOT deleted;
ALTER TABLE practice_sessions ADD CONSTRAINT practice_sessions_event_id_fk FOREIGN KEY (owner_id, "event_id") REFERENCES practice_events(owner_id, id);
CREATE INDEX practice_sessions_event_id_idx ON practice_sessions (owner_id, "event_id") WHERE NOT deleted;
ALTER TABLE practice_progress ADD CONSTRAINT practice_progress_event_id_fk FOREIGN KEY (owner_id, "event_id") REFERENCES practice_events(owner_id, id);
CREATE INDEX practice_progress_event_id_idx ON practice_progress (owner_id, "event_id") WHERE NOT deleted;
