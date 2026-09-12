#!/bin/bash
#
# Backs up the Spaces database and user files to the Hetzner Storage Box.
# Runs on the Spaces host, not inside the app container.
#
# Install:
#   cp scripts/spaces-backup.sh /usr/local/bin/spaces-backup
#   chmod 700 /usr/local/bin/spaces-backup
#   cp scripts/spaces-backup.env.example /root/.spaces-backup.env
#   chmod 600 /root/.spaces-backup.env   # then fill it in
#
# Usage:
#   spaces-backup db      every 6 hours
#   spaces-backup files   daily

set -uo pipefail

CONFIG=/root/.spaces-backup.env
LOG_TAG=spaces-backup

log() { logger -t "$LOG_TAG" -- "$*"; echo "$(date -Is) $*"; }
die() { log "ERROR: $*"; exit 1; }

[ -r "$CONFIG" ] || die "missing config $CONFIG"
# shellcheck disable=SC1090
. "$CONFIG"

: "${PG_CONNECTION_STRING:?not set in $CONFIG}"
: "${SB_HOST:?not set in $CONFIG}"
: "${VOLUME_BASE_PATH:=/data}"
: "${DB_RETENTION_DAYS:=30}"
: "${SSH_KEY:=/root/.ssh/id_ed25519}"

SB_SSH="ssh -p 23 -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

backup_db() {
  local stamp file tmp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="spaces-db-${stamp}.dump"
  tmp="/tmp/${file}"

  log "dumping database"
  /usr/lib/postgresql/17/bin/pg_dump "$PG_CONNECTION_STRING" -Fc -f "$tmp" \
    || die "pg_dump failed"

  [ -s "$tmp" ] || die "dump is empty"

  log "uploading $file ($(du -h "$tmp" | cut -f1))"
  rsync -a -e "$SB_SSH" "$tmp" "$SB_HOST":spaces-backup/db/ \
    || die "upload failed"

  rm -f "$tmp"
  prune_db
  log "database backup complete"
}

prune_db() {
  local cutoff keep
  cutoff=$(date -u -d "${DB_RETENTION_DAYS} days ago" +%Y%m%d)

  $SB_SSH "$SB_HOST" ls spaces-backup/db/ 2>/dev/null \
    | grep '^spaces-db-' \
    | while read -r name; do
        keep=$(echo "$name" | sed -n 's/^spaces-db-\([0-9]\{8\}\)T.*/\1/p')
        [ -n "$keep" ] || continue
        if [ "$keep" -lt "$cutoff" ]; then
          log "pruning $name"
          $SB_SSH "$SB_HOST" rm "spaces-backup/db/$name"
        fi
      done
}

backup_files() {
  [ -d "$VOLUME_BASE_PATH" ] || die "$VOLUME_BASE_PATH does not exist"

  log "syncing $VOLUME_BASE_PATH"
  rsync -aHAX --numeric-ids -M--fake-super --delete \
    -e "$SB_SSH" \
    "$VOLUME_BASE_PATH"/ "$SB_HOST":spaces-backup/data/
  local status=$?

  # 24 = files vanished during transfer, normal on a live system
  if [ $status -ne 0 ] && [ $status -ne 24 ]; then
    die "rsync failed with status $status"
  fi

  log "file backup complete (rsync status $status)"
}

case "${1:-}" in
  db)    backup_db ;;
  files) backup_files ;;
  *)     die "usage: $0 {db|files}" ;;
esac
