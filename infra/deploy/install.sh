#!/bin/sh
# One-time, idempotent server preparation (Debian 12, run as root). Installs nothing but
# PostgreSQL 18 (official PGDG packages) and a pinned Node.js (official tarball, checksum verified).
set -eu
NODE_VERSION=24.21.0

if [ ! -x /usr/lib/postgresql/18/bin/postgres ]; then
  apt-get update
  apt-get install -y postgresql-common rsync curl xz-utils
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt-get install -y postgresql-18
fi
# Small machine: modest memory, local socket only.
cat > /etc/postgresql/18/main/conf.d/council.conf <<CONF
shared_buffers = 48MB
max_connections = 20
work_mem = 2MB
maintenance_work_mem = 32MB
effective_cache_size = 256MB
listen_addresses = ''
CONF
systemctl restart postgresql

id council >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin council
su postgres -c "psql -XtAc \"SELECT 1 FROM pg_roles WHERE rolname='council'\"" | grep -q 1 || su postgres -c "createuser council"
su postgres -c "psql -XtAc \"SELECT 1 FROM pg_database WHERE datname='council_next'\"" | grep -q 1 || su postgres -c "createdb -O council council_next"

if [ "$(/opt/council-next/node/bin/node -v 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  work=$(mktemp -d)
  file=node-v$NODE_VERSION-linux-x64.tar.xz
  curl -fsSL -o "$work/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSL -o "$work/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$work" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /opt/council-next/node
  mkdir -p /opt/council-next/node
  tar -xJf "$work/$file" -C /opt/council-next/node --strip-components=1
  rm -rf "$work"
fi

install -d -m 755 /opt/council-next /opt/council-next/app /opt/council-next/web /opt/council-next/bin
install -d -m 750 -o root -g council /etc/council-next
install -d -m 700 -o postgres -g postgres /var/backups/council-next
echo "install ok: $(/opt/council-next/node/bin/node -v), $(su postgres -c 'psql -XtAc "SHOW server_version"')"
