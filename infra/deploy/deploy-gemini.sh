#!/bin/sh
# Run from the repository root, with the ordinary SELF OS deployment settings.
set -eu
[ -f infra/deploy/site.env ] && . infra/deploy/site.env
: "${COUNCIL_SSH:?set the SELF OS server}"
: "${COUNCIL_SITE:?set the SELF OS HTTPS host}"
case "$COUNCIL_SITE" in *[!A-Za-z0-9.:-]*) exit 2 ;; esac
port=${COUNCIL_SSH_PORT:-22}
ssh_run="ssh -p $port -o BatchMode=yes"
stage=$($ssh_run "$COUNCIL_SSH" 'mktemp -d /opt/council-next/gemini.next.XXXXXXXX')
case "$stage" in /opt/council-next/gemini.next.*) ;; *) exit 1 ;; esac
rsync -az -e "$ssh_run" --chmod=Da+rx,Fa+r \
  --include='/package.json' --include='/modules/***' --include='/packages/***' \
  --include='/services/' --include='/services/council-query/***' --include='/services/council-gemini/***' \
  --exclude='*' ./ "$COUNCIL_SSH:$stage/"
rsync -az -e "$ssh_run" infra/deploy/council-gemini.service infra/deploy/gemini.caddy "$COUNCIL_SSH:$stage/"
$ssh_run "$COUNCIL_SSH" sh -s -- "$stage" "$COUNCIL_SITE" <<'REMOTE'
set -eu
stage=$1
instance=https://$2
base=/opt/council-next
active=$base/gemini
conf=/etc/caddy/council.caddy
connector_dir=/etc/caddy/self-os-connectors
backup_suffix=${stage##*.}
previous=$base/gemini.previous.$backup_suffix
exec 9>"$base/.gemini-release.lock"
flock 9
test -f /etc/council-next/query.env
test -d "$base/app/node_modules/fastify"
test -f "$conf"
expected=$(sed -n 's/^COUNCIL_QUERY_OWNER=//p' /etc/council-next/query.env)
actual=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d council_next -c 'SELECT owner_id FROM council.sync_clock')
test -n "$expected" && test "$expected" = "$actual"
getent passwd council_gemini >/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin council_gemini
ln -s "$base/app/node_modules" "$stage/node_modules"
tables=$(cd "$stage" && "$base/node/bin/node" --input-type=module -e '
  import { schema } from "./packages/contracts/entities.ts";
  import { expandedTypes } from "./services/council-gemini/sections.ts";
  console.log(["sync_clock", ...expandedTypes.map((type) => schema[type].table)].map((table) => "council." + table).join(", "));
')
runuser -u postgres -- psql -Xq -v ON_ERROR_STOP=1 -d council_next <<SQL
BEGIN;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='council_gemini') THEN
    CREATE ROLE council_gemini LOGIN;
  END IF;
END \$\$;
ALTER ROLE council_gemini SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA council TO council_gemini;
REVOKE ALL ON ALL TABLES IN SCHEMA council FROM council_gemini;
GRANT SELECT ON $tables TO council_gemini;
COMMIT;
SQL
chmod 755 "$stage"
install -m 644 "$stage/council-gemini.service" /etc/systemd/system/council-gemini.service
umask 077
printf 'COUNCIL_GEMINI_ORIGIN=%s\n' "$instance" >/etc/council-next/gemini.env
systemctl daemon-reload
if [ -d "$active" ]; then mv "$active" "$previous"; fi
mv "$stage" "$active"

ready=false
if systemctl restart council-gemini; then
  remaining=12
  while [ "$remaining" -gt 0 ]; do
    if [ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8792/ai/gemini/mcp)" = 401 ]; then
      ready=true
      break
    fi
    remaining=$((remaining-1))
    sleep 1
  done
fi
if ! "$ready"; then
  systemctl stop council-gemini
  mv "$active" "$stage"
  if [ -d "$previous" ]; then
    mv "$previous" "$active"
    systemctl start council-gemini
  fi
  echo 'Gemini listener failed readiness' >&2
  exit 1
fi

install -d -m 755 "$connector_dir"
cp -p "$conf" "$conf.before-gemini.$backup_suffix"
if [ -f "$connector_dir/gemini.caddy" ]; then
  cp -p "$connector_dir/gemini.caddy" "$connector_dir/gemini.caddy.previous.$backup_suffix"
fi
install -m 644 "$active/gemini.caddy" "$connector_dir/gemini.caddy"
if ! grep -Fq 'import /etc/caddy/self-os-connectors/*.caddy' "$conf"; then
  awk '/^[[:space:]]*handle \/v1\/\* \{/ && !done {print "\timport /etc/caddy/self-os-connectors/*.caddy"; done=1}
       {print} END {if(!done) exit 1}' "$conf" > "$conf.next"
  chmod 644 "$conf.next"
  mv "$conf.next" "$conf"
fi
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || ! systemctl reload caddy; then
  mv "$conf.before-gemini.$backup_suffix" "$conf"
  if [ -f "$connector_dir/gemini.caddy.previous.$backup_suffix" ]; then
    mv "$connector_dir/gemini.caddy.previous.$backup_suffix" "$connector_dir/gemini.caddy"
  else
    rm "$connector_dir/gemini.caddy"
  fi
  echo 'Gemini Caddy configuration rolled back' >&2
  exit 1
fi
systemctl enable council-gemini
systemctl is-active council-gemini council-next-api council-next-query
REMOTE
