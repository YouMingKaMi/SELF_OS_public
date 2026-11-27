CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION council.search_tags(tags jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN CASE WHEN jsonb_typeof(tags) = 'array' THEN (
  SELECT string_agg(value, ',' ORDER BY position)
  FROM jsonb_array_elements_text(tags) WITH ORDINALITY AS elements(value, position)
) END;

CREATE INDEX documents_title_search_idx ON documents USING gin (title gin_trgm_ops);
CREATE INDEX documents_body_search_idx ON documents USING gin (body gin_trgm_ops);
CREATE INDEX documents_tags_search_idx ON documents USING gin (council.search_tags(tags) gin_trgm_ops);
CREATE INDEX journal_body_search_idx ON journal_entries USING gin (body gin_trgm_ops);
