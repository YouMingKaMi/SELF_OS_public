#!/bin/sh
# Install (or reinstall) the daily iCloud backup copy on this Mac. Run from the repository root:
#   sh infra/deploy/install-backup-agent.sh
# Remove with: launchctl bootout gui/$(id -u)/org.personalcouncil.next.backup && rm ~/Library/LaunchAgents/org.personalcouncil.next.backup.plist
set -eu
cd "$(dirname "$0")/../.."
label=org.personalcouncil.next.backup
target="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/Logs/CouncilNext" "$HOME/Library/LaunchAgents"
sed -e "s#REPO#$PWD#g" -e "s#HOME/#$HOME/#g" infra/deploy/$label.plist > "$target"
plutil -lint "$target" >/dev/null
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$target"
sleep 6
tail -3 "$HOME/Library/Logs/CouncilNext/backup.log"
