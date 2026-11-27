#!/bin/sh
# Runs on the server only when the monitor deployment mode is requested.
set -eu
if ! id council-monitor >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin council-monitor
fi
# Peer authentication. The collector reads PostgreSQL catalog statistics as an
# ordinary login. It needs neither a database password nor access to app tables.
runuser -u postgres -- psql -Xq -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'council-monitor') THEN
    CREATE ROLE "council-monitor" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
SQL
systemctl daemon-reload
systemctl enable --now council-next-monitor.timer
