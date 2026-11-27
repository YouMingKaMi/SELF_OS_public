#!/bin/sh
# Run from the repository root.
#   sh infra/deploy/deploy.sh [all|api|web|infra|monitor]
# Server details live in infra/deploy/site.env (git-ignored), e.g.
#   COUNCIL_SSH=root@203.0.113.10  COUNCIL_SSH_PORT=22  COUNCIL_SITE=council.example.com:443
set -eu
case "${1:-all}" in
  all) api=true; web=true; infra=true; monitor=false ;;
  api) api=true; web=false; infra=false; monitor=false ;;
  web) api=false; web=true; infra=false; monitor=false ;;
  infra) api=false; web=false; infra=true; monitor=false ;;
  monitor) api=false; web=false; infra=false; monitor=true ;;
  *) echo "usage: $0 [all|api|web|infra|monitor]" >&2; exit 2 ;;
esac
[ -f infra/deploy/site.env ] && . infra/deploy/site.env
: "${COUNCIL_SSH:?set COUNCIL_SSH, e.g. root@example.org}"
PORT=${COUNCIL_SSH_PORT:-22}
SSH="ssh -p $PORT -o BatchMode=yes"

if "$monitor"; then
  rsync -az -e "$SSH" infra/deploy/monitor.ts infra/deploy/install-monitor.sh "$COUNCIL_SSH:/opt/council-next/bin/"
  rsync -az -e "$SSH" infra/deploy/council-next-monitor.service \
    infra/deploy/council-next-monitor.timer "$COUNCIL_SSH:/etc/systemd/system/"
  $SSH "$COUNCIL_SSH" '/bin/sh /opt/council-next/bin/install-monitor.sh'
fi

if "$web"; then npm run build:web; fi
if "$infra"; then
  : "${COUNCIL_SITE:?set COUNCIL_SITE, e.g. council.example.com}"
  rsync -az -e "$SSH" infra/deploy/backup.sh "$COUNCIL_SSH:/opt/council-next/bin/backup.sh"
  rsync -az -e "$SSH" infra/deploy/council-next-api.service infra/deploy/council-next-backup.service \
    infra/deploy/council-next-backup.timer "$COUNCIL_SSH:/etc/systemd/system/"
  sed "s#COUNCIL_SITE#$COUNCIL_SITE#" infra/deploy/council.caddy | $SSH "$COUNCIL_SSH" '
    set -eu
    target=/etc/caddy/council.caddy
    if [ -f "$target" ]; then cp "$target" "$target.rollback"; fi
    cat > "$target.new"
    mv "$target.new" "$target"
    if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || ! systemctl reload caddy; then
      if [ -f "$target.rollback" ]; then mv "$target.rollback" "$target"; else rm -f "$target"; fi
      exit 1
    fi
    systemctl daemon-reload
    systemctl enable --now council-next-backup.timer
  '
fi

if "$api"; then
  candidate=$($SSH "$COUNCIL_SSH" 'mktemp -d /opt/council-next/app.next.XXXXXXXX')
  case "$candidate" in /opt/council-next/app.next.*) ;; *) exit 1 ;; esac
  # Stage the next release while the API serves the prior one.
  rsync -az --chmod=Da+rx,Fa+r -e "$SSH" \
    --include='/package.json' --include='/package-lock.json' \
    --exclude='*/tests/***' \
    --include='/services/***' --include='/modules/***' --include='/packages/***' \
    --include='/infra/' --include='/infra/migrations/***' \
    --exclude='*' \
    ./ "$COUNCIL_SSH:$candidate/"
  $SSH "$COUNCIL_SSH" sh -s -- "$candidate" <<'REMOTE'
set -eu
candidate=$1
base=/opt/council-next
prior=$base/app.previous.${candidate##*.}
failed=$base/app.failed.${candidate##*.}
exec 9>"$base/.api-release.lock"
flock 9
[ -f /etc/council-next/api.env ]
cd "$candidate"
chmod 755 "$candidate"
if [ -d "$base/app/node_modules" ] && cmp -s package-lock.json "$base/app/package-lock.json"; then
  cp -a "$base/app/node_modules" ./
else
  PATH=/opt/council-next/node/bin:$PATH npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
fi
chown -R root:root "$candidate"
api_ready() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    code=$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8790/v1/sync-state || true)
    if [ "$code" = 401 ] && systemctl is-active --quiet council-next-api; then return 0; fi
    attempt=$((attempt+1))
    sleep 1
  done
  return 1
}
restart_services() {
  systemctl restart council-next-api && api_ready || return 1
  if systemctl is-enabled --quiet council-next-query; then
    systemctl restart council-next-query && systemctl is-active --quiet council-next-query || return 1
  fi
}
cd "$base"
mv "$base/app" "$prior"
if ! mv "$candidate" "$base/app"; then
  mv "$prior" "$base/app"
  exit 1
fi
if ! restart_services; then
  mv "$base/app" "$failed"
  mv "$prior" "$base/app"
  restart_services
  echo "API health check failed; previous release restored" >&2
  exit 1
fi
echo "Previous API release: $prior"
REMOTE
fi

if "$web"; then
  # Existing tabs and service workers can still request the preceding build's hashed files.
  # Publish assets first, then replace the entry page and service worker by rename.
  rsync -az --chmod=Da+rx,Fa+r --exclude=/index.html --exclude=/sw.js -e "$SSH" \
    apps/web/dist/ "$COUNCIL_SSH:/opt/council-next/web/"
  rsync -az --chmod=Fa+r -e "$SSH" apps/web/dist/index.html \
    "$COUNCIL_SSH:/opt/council-next/web/index.html.next"
  rsync -az --chmod=Fa+r -e "$SSH" apps/web/dist/sw.js \
    "$COUNCIL_SSH:/opt/council-next/web/sw.js.next"
  $SSH "$COUNCIL_SSH" '
    set -eu
    cd /opt/council-next/web
    if [ -f index.html ] && [ -f sw.js ]; then
      cp index.html index.html.rollback
      cp sw.js sw.js.rollback
    fi
    mv index.html.next index.html
    mv sw.js.next sw.js
  '
fi
echo "deployed ${1:-all}"
