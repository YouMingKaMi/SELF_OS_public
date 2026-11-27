-- Legacy clients may sync until an explicit backup restoration rotates the generation.
ALTER TABLE sync_clock ADD COLUMN scope_required boolean NOT NULL DEFAULT false;
