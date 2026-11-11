#!/bin/sh
# Copy the newest verified server backup into the iCloud backup folder and keep the newest 7 there.
# The server already proves each dump restores (backup.sh); here we only check the copy is byte-identical.
#   sh infra/deploy/pull-backup.sh            (run from the repository root, or via the LaunchAgent)
# Reads COUNCIL_SSH / COUNCIL_SSH_PORT from infra/deploy/site.env; COUNCIL_BACKUP_DIR overrides the target.
set -eu
cd "$(dirname "$0")/../.."
[ -f infra/deploy/site.env ] && . infra/deploy/site.env
: "${COUNCIL_SSH:?set COUNCIL_SSH in infra/deploy/site.env}"
PORT=${COUNCIL_SSH_PORT:-22}
DEST=${COUNCIL_BACKUP_DIR:-"$HOME/Library/Mobile Documents/com~apple~CloudDocs/SELF OS 备份/数据库"}
KEEP=${COUNCIL_BACKUP_KEEP:-7}
SSH="ssh -p $PORT -o BatchMode=yes -o ConnectTimeout=20"
mkdir -p "$DEST"
stamp() { date "+%Y-%m-%d %H:%M:%S"; }

name=$($SSH "$COUNCIL_SSH" 'ls -1t /var/backups/council-next/council-*.dump 2>/dev/null | head -1 | xargs -r basename')
[ -n "$name" ] || { echo "$(stamp) no verified backup on the server yet" >&2; exit 1; }
if [ -f "$DEST/$name" ]; then
  echo "$(stamp) already have $name"
else
  tmp="$DEST/.$name.part"
  scp -q -P "$PORT" -o BatchMode=yes "$COUNCIL_SSH:/var/backups/council-next/$name" "$tmp"
  remote=$($SSH "$COUNCIL_SSH" "sha256sum /var/backups/council-next/$name" | cut -d' ' -f1)
  local=$(shasum -a 256 "$tmp" | cut -d' ' -f1)
  if [ "$remote" != "$local" ]; then
    rm -f "$tmp"
    echo "$(stamp) checksum mismatch for $name" >&2
    exit 1
  fi
  mv "$tmp" "$DEST/$name"
  echo "$local  $name" >> "$DEST/SHA256SUMS"
  echo "$(stamp) copied $name ($(du -h "$DEST/$name" | cut -f1))"
fi
# Keep the newest $KEEP dumps; drop the rest and their checksum lines.
ls -1t "$DEST"/council-*.dump | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
  echo "$(stamp) removed $(basename "$old")"
done
if [ -f "$DEST/SHA256SUMS" ]; then
  grep -F -f /dev/stdin "$DEST/SHA256SUMS" > "$DEST/.sums" <<EOF || true
$(cd "$DEST" && ls -1 council-*.dump)
EOF
  mv "$DEST/.sums" "$DEST/SHA256SUMS"
fi
