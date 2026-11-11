#!/bin/sh
# Ship the API, migrations and web bundle to the server and restart. Run from the repository root.
#   sh infra/deploy/deploy.sh
# Server details live in infra/deploy/site.env (git-ignored), e.g.
#   COUNCIL_SSH=root@203.0.113.10  COUNCIL_SSH_PORT=22  COUNCIL_SITE=council.example.com:443
set -eu
[ -f infra/deploy/site.env ] && . infra/deploy/site.env
: "${COUNCIL_SSH:?set COUNCIL_SSH, e.g. root@example.org}"
: "${COUNCIL_SITE:?set COUNCIL_SITE, e.g. council.example.com}"
PORT=${COUNCIL_SSH_PORT:-22}
SSH="ssh -p $PORT -o BatchMode=yes"
npm run build:web
# Only server code, contracts and migrations; never fixtures or local data.
rsync -az --delete --delete-excluded -e "$SSH" \
  --include='/package.json' --include='/package-lock.json' \
  --include='/services/***' --include='/modules/***' --include='/packages/***' \
  --include='/infra/' --include='/infra/migrations/***' \
  --exclude='*/tests/***' --exclude='*' \
  ./ "$COUNCIL_SSH:/opt/council-next/app/"
rsync -az --delete -e "$SSH" apps/web/dist/ "$COUNCIL_SSH:/opt/council-next/web/"
rsync -az -e "$SSH" infra/deploy/backup.sh "$COUNCIL_SSH:/opt/council-next/bin/backup.sh"
rsync -az -e "$SSH" infra/deploy/council-next-api.service infra/deploy/council-next-backup.service \
  infra/deploy/council-next-backup.timer "$COUNCIL_SSH:/etc/systemd/system/"
sed "s#COUNCIL_SITE#$COUNCIL_SITE#" infra/deploy/council.caddy | $SSH "$COUNCIL_SSH" 'cat > /etc/caddy/council.caddy && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy' 
$SSH "$COUNCIL_SSH" '
  set -e
  cd /opt/council-next/app
  PATH=/opt/council-next/node/bin:$PATH npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
  chown -R root:root /opt/council-next/app /opt/council-next/web
  chmod -R a+rX /opt/council-next/web
  [ -f /etc/council-next/api.env ] || { echo "missing /etc/council-next/api.env (see infra/deploy/api.env.example)"; exit 1; }
  systemctl daemon-reload
  systemctl enable --now council-next-backup.timer
  systemctl restart council-next-api
  sleep 2
  systemctl is-active council-next-api
'
echo "deployed"
