#!/bin/sh
# Daily: dump, prove the dump restores, keep the newest 3 verified dumps. Runs as postgres.
set -eu
dir=/var/backups/council-next
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp="$dir/.council-$stamp.dump"
umask 077
pg_dump -Fc -d council_next -f "$tmp"
# Verification: restore into a scratch database and compare per-table row counts with the live one.
dropdb --if-exists council_verify
createdb council_verify
pg_restore -d council_verify --no-owner --exit-on-error "$tmp"
count() {
  for t in $(psql -XAtq -d "$1" -c "SELECT tablename FROM pg_tables WHERE schemaname='council' ORDER BY 1"); do
    echo "$t $(psql -XAtq -d "$1" -c "SELECT count(*) FROM council.\"$t\"")"
  done
}
# Restored counts are taken after the dump; rows are never hard-deleted, so each must be ≤ live and the feed non-empty.
restored=$(count council_verify)
live=$(count council_next)
dropdb council_verify
if ! printf '%s\n---\n%s\n' "$restored" "$live" | awk '
  $0=="---" { side=1; next }
  !side { r[$1]=$2; next }
  { l[$1]=$2 }
  END {
    for (t in r) if (!(t in l) || r[t] > l[t]) exit 1
    for (t in l) if (!(t in r)) exit 1
    if (r["sync_heads"] < 1) exit 1
  }'; then
  rm -f "$tmp"
  echo "backup verification failed" >&2
  exit 1
fi
mv "$tmp" "$dir/council-$stamp.dump"
ls -1t "$dir"/council-*.dump | tail -n +4 | xargs -r rm -f
echo "backup ok: council-$stamp.dump ($(du -h "$dir/council-$stamp.dump" | cut -f1))"
