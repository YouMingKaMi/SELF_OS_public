-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
ALTER TABLE preparation_checklists ADD COLUMN "item_ids" jsonb;
ALTER TABLE preparation_runs ADD COLUMN "item_ids" jsonb;
ALTER TABLE preparation_runs ADD COLUMN "item_labels" jsonb;
ALTER TABLE preparation_runs ADD COLUMN "checked_item_ids" jsonb;
ALTER TABLE preparation_runs ADD COLUMN "ambiguous_checked" jsonb;
