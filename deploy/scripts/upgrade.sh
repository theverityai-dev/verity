#!/usr/bin/env bash
# Upgrades a running deployment (Task 42).
#
# Order matters and is not negotiable:
#
#   backup → build/pull → migrate → restart → verify
#
# The backup is FIRST and a failure there aborts the upgrade. An upgrade path
# whose first action is not a backup is not an upgrade path; it is a hope.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker
require_env_file

log "step 1/5 — backup (an upgrade that cannot be undone is not an upgrade)"
BACKUP="$("${SCRIPT_DIR}/backup.sh" | tail -n 1)" || die "backup failed — upgrade aborted, nothing was changed"
log "backup at ${BACKUP}"

log "step 2/5 — building the new images (application and operator tools)"
build_images

log "step 3/5 — applying migrations"
"${SCRIPT_DIR}/migrate.sh"

log "step 4/5 — restarting the application and scheduler"
compose up -d web scheduler

log "step 5/5 — verifying"
if "${SCRIPT_DIR}/health.sh"; then
  log "upgrade complete"
else
  warn "the deployment is not healthy after upgrade"
  warn "to roll back:  ./deploy/scripts/restore.sh ${BACKUP}   (VERITY_RESTORE_CONFIRM=yes)"
  exit 1
fi
