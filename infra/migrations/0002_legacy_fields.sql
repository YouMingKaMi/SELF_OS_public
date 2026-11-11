-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
ALTER TABLE practice_domains ADD COLUMN "goal" text;
ALTER TABLE practice_problems ADD COLUMN "note" text;
ALTER TABLE documents ADD COLUMN "tags" jsonb;
