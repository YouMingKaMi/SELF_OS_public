-- A change head binds an owner-scoped entity ID to its type for the life of the record.
-- Stop migration before using that binding if historical tables violate it.
DO $$
DECLARE
  sources text;
  ambiguous bigint;
  uncovered bigint;
  entity_table record;
BEGIN
  -- All typed entity tables have these columns. Infrastructure tables do not.
  FOR entity_table IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('owner_id', 'id', 'version', 'deleted', 'updated_at')
    GROUP BY table_name
    HAVING count(*) = 5
    ORDER BY table_name
  LOOP
    EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE', entity_table.table_name);
    sources := concat_ws(' UNION ALL ', sources,
      format('SELECT owner_id, id FROM %I', entity_table.table_name));
  END LOOP;
  IF sources IS NULL THEN
    RAISE EXCEPTION 'Entity identity check found no typed tables';
  END IF;
  EXECUTE 'SELECT count(*) FROM (SELECT owner_id, id FROM (' || sources
      || ') typed_rows GROUP BY owner_id, id HAVING count(*) > 1) collisions'
    INTO ambiguous;
  IF ambiguous > 0 THEN
    RAISE EXCEPTION 'Cross-type entity ID collisions: % (owner, ID) pairs', ambiguous;
  END IF;
  EXECUTE 'SELECT count(*) FROM (' || sources
      || ') typed_rows LEFT JOIN sync_heads h ON h.owner_id=typed_rows.owner_id AND h.entity_id=typed_rows.id WHERE h.entity_id IS NULL'
    INTO uncovered;
  IF uncovered > 0 THEN
    RAISE EXCEPTION 'Entity identity check found % rows without a change head', uncovered;
  END IF;
END $$;
