-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
ALTER TABLE storage_boxes ADD COLUMN "parent_id" uuid;
ALTER TABLE storage_boxes ADD CONSTRAINT storage_boxes_parent_id_fk FOREIGN KEY (owner_id, "parent_id") REFERENCES storage_boxes(owner_id, id);
CREATE INDEX storage_boxes_parent_id_idx ON storage_boxes (owner_id, "parent_id") WHERE NOT deleted;
