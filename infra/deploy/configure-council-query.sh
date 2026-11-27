#!/bin/sh
# Run on the production VPS as root after deploying the reader files.
set -eu
app=/opt/council-next/app
node=/opt/council-next/node/bin/node
psql_as_admin() {
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d council_next "$@"
}
owner=$(psql_as_admin -At -c "SELECT owner_id FROM council.sync_clock")
if ! printf '%s\n' "$owner" | awk 'END {exit !(NR == 1 && length($0) <= 128 && $0 ~ /^[A-Za-z0-9_-]+$/)}'; then
  echo "Expected one existing SELF OS owner" >&2
  exit 1
fi
tables=$(cd "$app" && "$node" --input-type=module -e '
    import { schema } from "./packages/contracts/entities.ts";
    import { readableTypes } from "./services/council-query/query.ts";
    console.log(["sync_clock", ...readableTypes.map((type) => schema[type].table)].map((table) => "council." + table).join(", "));
')
getent passwd council_query >/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin council_query
psql_as_admin <<SQL
BEGIN;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'council_query') THEN
    CREATE ROLE council_query LOGIN;
  END IF;
END
\$\$;
ALTER ROLE council_query SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA council TO council_query;
REVOKE ALL ON ALL TABLES IN SCHEMA council FROM council_query;
GRANT SELECT ON $tables TO council_query;
COMMIT;
SQL
umask 077
printf 'COUNCIL_QUERY_OWNER=%s\n' "$owner" > /etc/council-next/query.env
echo 'SELF OS readonly query configured'
