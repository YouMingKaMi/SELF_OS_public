#!/bin/sh
# Runs as postgres. Every published archive has restored successfully into an empty database.
set -eu
umask 077
dir=${COUNCIL_BACKUP_DIR:-/var/backups/council-next}
database=${COUNCIL_BACKUP_DATABASE:-council_next}
started=$(date +%s)
exec 9>"$dir/.backup.lock"
flock 9
stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot_started=$(date +%s)
status_dir=${COUNCIL_BACKUP_STATUS_DIRECTORY:-${STATE_DIRECTORY:-}}

work=$(mktemp -d "$dir/.verify.XXXXXXXX")
scratch="council_verify_$$"
scratch_created=false
status_stage=
cleanup() {
  if "$scratch_created"; then dropdb --if-exists "$scratch"; fi
  if [ -n "$status_stage" ]; then rm -f "$status_stage"; fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

cat > "$work/check.sql" <<'SQL'
SELECT jsonb_build_array(
  (SELECT count(*) FROM council.sync_heads),
  (SELECT count(*) FROM council.sync_receipts) +
    (SELECT count(*) FROM council.sync_receipts_archive),
  (SELECT count(*) FROM council.expense_entries WHERE NOT deleted),
  (SELECT coalesce(sum(amount_minor), 0) FROM council.expense_entries WHERE NOT deleted),
  (SELECT coalesce(sum(coalesce(recovery_minor, 0)), 0) FROM council.expense_entries WHERE NOT deleted),
  (SELECT count(*) FROM council.documents WHERE NOT deleted),
  (SELECT md5(coalesce(string_agg(md5(jsonb_build_array(id, body)::text), '' ORDER BY owner_id, id), ''))
     FROM council.documents WHERE NOT deleted)
);
SQL
COUNCIL_SOURCE_DB=$database COUNCIL_CHECK_SQL="$work/check.sql" COUNCIL_TEMP_DUMP="$work/archive.dump" \
  psql -XqAt -v ON_ERROR_STOP=1 -d "$database" > "$work/source" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS backup_snapshot \gset
\setenv COUNCIL_BACKUP_SNAPSHOT :backup_snapshot
\! pg_dump -Fc -d "$COUNCIL_SOURCE_DB" --snapshot="$COUNCIL_BACKUP_SNAPSHOT" -f "$COUNCIL_TEMP_DUMP"
\if :SHELL_ERROR
  \quit 1
\endif
\getenv check_sql COUNCIL_CHECK_SQL
\i :check_sql
COMMIT;
SQL

test -s "$work/archive.dump"
test -s "$work/source"
createdb "$scratch"
scratch_created=true
restore_started=$(date +%s)
pg_restore -d "$scratch" --no-owner --exit-on-error "$work/archive.dump"
psql -XqAt -v ON_ERROR_STOP=1 -d "$scratch" -f "$work/check.sql" > "$work/restored"
restore_seconds=$(( $(date +%s) - restore_started ))
if ! cmp -s "$work/source" "$work/restored"; then
  echo "backup verification failed" >&2
  exit 1
fi

name="council-$stamp.dump"
size=$(wc -c < "$work/archive.dump" | tr -d ' ')
hash=$(sha256sum "$work/archive.dump" | cut -d ' ' -f 1)
printf '%s  %s\n' "$hash" "$name" > "$work/archive.sha256"
mv "$work/archive.sha256" "$dir/$name.sha256"
mv "$work/archive.dump" "$dir/$name"
duration_seconds=$(( $(date +%s) - started ))
if [ -n "$status_dir" ]; then
  # Publish aggregate timing only, after verifying and publishing the actual dump.
  status_stage=$(mktemp "$status_dir/.latest.XXXXXXXX")
  printf '{"snapshotAt":%s,"archiveBytes":%s,"restoreSeconds":%s,"durationSeconds":%s}\n' \
    "$snapshot_started" "$size" "$restore_seconds" "$duration_seconds" > "$status_stage"
  chmod 0644 "$status_stage"
  mv "$status_stage" "$status_dir/latest.json"
fi

# Keep three recent archives plus the most recent from each of four UTC weeks and six UTC months.
find "$dir" -maxdepth 1 -type f -name 'council-????????T??????Z.dump' -printf '%f\n' |
  LC_ALL=C sort -r | (
    recent=0
    weeks=0; last_week=
    months=0; last_month=
    while IFS= read -r archive; do
      day=${archive#council-}
      day=${day%%T*}
      week=$(date -u -d "$day" +%G%V 2>/dev/null) || continue
      month=$(date -u -d "$day" +%Y%m)
      keep=false
      if [ "$recent" -lt 3 ]; then recent=$((recent + 1)); keep=true; fi
      if [ "$weeks" -lt 4 ] && [ "$week" != "$last_week" ]; then
        weeks=$((weeks + 1)); last_week=$week; keep=true
      fi
      if [ "$months" -lt 6 ] && [ "$month" != "$last_month" ]; then
        months=$((months + 1)); last_month=$month; keep=true
      fi
      if ! "$keep"; then rm -f "$dir/$archive.sha256" "$dir/$archive"; fi
    done
  )
echo "backup_ok bytes=$size restore_seconds=$restore_seconds duration_seconds=$duration_seconds"
