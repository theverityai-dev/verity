#!/usr/bin/env bash
# Takes a verified backup (Task 42; procedure from Task 33; Mode B recovery set from Task 129 B4).
#
# Writes a custom-format dump, then immediately reads it back with
# `pg_restore --list`. A dump nobody has ever read is not a backup — it is a
# file, and the difference is discovered at the worst possible moment.
#
# Mode A: one database dump plus its manifest (format verity-full-logical-v1).
# Mode B: a recovery SET, all named from one timestamp and bound together by the manifest (format verity-full-logical-v2):
#   verity-<stamp>.dump           the Verity database
#   verity-<stamp>.keycloak.dump  the identity provider's database (accounts, credentials, the realm)
#   verity-<stamp>.objects.tar.gz the object-store bytes (photos and documents the database rows point at)
#   verity-<stamp>.config.tar.gz  certificates (without the CA private key) and the rendered realm file
#   verity-<stamp>.dump.manifest  checksums and counts for all of the above
# The environment file is NOT in the set (it holds every secret, and a backup may travel). Keep the sealed copy.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker
require_env_file

mkdir -p "${BACKUP_DIR}"
DB="$(env_value POSTGRES_DB)"; DB="${DB:-verity}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/verity-${STAMP}.dump"
MANIFEST="${TARGET}.manifest"

log "dumping ${DB} to ${TARGET}"
# -Fc: custom format, so a restore can be selective and parallel. Written to a
# temporary name and moved on success, so an interrupted run never leaves a
# truncated file that looks like a backup.
compose exec -T db pg_dump -U postgres -d "${DB}" -Fc > "${TARGET}.partial"
mv "${TARGET}.partial" "${TARGET}"
chmod 600 "${TARGET}"

# Verified INSIDE the container, always.
#
# Found in Task 43: the host's pg_restore is whatever the operator happens to
# have installed, and an older one cannot read a newer server's archive —
# `unsupported version (1.15) in file header` from a v14 client against a v16
# dump. That failure says nothing about the backup and everything about the
# host, and it would have taught an operator to distrust a good backup. The
# container's client is the server's own version by construction.
log "verifying the dump is readable"
compose exec -T db sh -c 'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump >/dev/null && rm -f /tmp/verify.dump' < "${TARGET}"

SIZE="$(wc -c < "${TARGET}" | tr -d ' ')"
[ "${SIZE}" -gt 1024 ] || die "backup is only ${SIZE} bytes — refusing to report success"

SHA256="$(sha256sum "${TARGET}" | awk '{print $1}')"
MIGRATIONS="$(compose exec -T db psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -tAc \
  'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL' | tr -d '[:space:]')"
TENANTS="$(compose exec -T db psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -tAc \
  'SELECT count(*) FROM public.tenant' | tr -d '[:space:]')"
COMMIT="$(env_value VERITY_COMMIT)"; COMMIT="${COMMIT:-unknown}"
VERSION="$(env_value VERITY_VERSION)"; VERSION="${VERSION:-unknown}"

FORMAT="verity-full-logical-v1"
OBJECT_STATUS="not_included"
COMPANION_LINES=()

if mode_b_enabled; then
  FORMAT="verity-full-logical-v2"
  OBJECT_STATUS="included"
  BASE="${TARGET%.dump}"

  log "dumping the Keycloak database"
  KC_TARGET="${BASE}.keycloak.dump"
  compose exec -T keycloak-db pg_dump -U keycloak -d keycloak -Fc > "${KC_TARGET}.partial"
  mv "${KC_TARGET}.partial" "${KC_TARGET}"
  chmod 600 "${KC_TARGET}"
  compose exec -T keycloak-db sh -c 'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump >/dev/null && rm -f /tmp/verify.dump' < "${KC_TARGET}"
  KC_SIZE="$(wc -c < "${KC_TARGET}" | tr -d ' ')"
  [ "${KC_SIZE}" -gt 1024 ] || die "the Keycloak dump is only ${KC_SIZE} bytes — refusing to report success"
  KC_REALMS="$(compose exec -T keycloak-db psql -U keycloak -d keycloak -tAc "SELECT count(*) FROM realm WHERE name='dsew'" | tr -d '[:space:]')"
  [ "${KC_REALMS}" = "1" ] || die "the dsew realm is not in the Keycloak database (found ${KC_REALMS}) — refusing to report success"

  # The object store is stopped for the length of the copy: its volumes are append-only files and a copy taken while a write
  # is in flight can be torn. Uploads in that window fail with a clear error; take the backup in a quiet hour.
  log "snapshotting the object store (uploads pause while it is copied)"
  OBJ_TARGET="${BASE}.objects.tar.gz"
  OBJ_CONTAINER="$(compose ps -q objects)"
  [ -n "${OBJ_CONTAINER}" ] || die "the object store is not running"
  # The volume mounted on THIS project's object store, never a name search: another deployment (or an earlier attempt) on the
  # same host has a volume with a similar name, and snapshotting the wrong one produces a backup that restores someone else's files.
  OBJ_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "${OBJ_CONTAINER}")"
  [ -n "${OBJ_VOLUME}" ] || die "could not determine the object-store volume from its container"
  OBJ_IMAGE="$(docker inspect --format '{{.Config.Image}}' "${OBJ_CONTAINER}")"
  restart_objects() { compose start objects >/dev/null 2>&1 || warn "could not restart the object store; run: compose start objects"; }
  trap restart_objects EXIT
  compose stop objects >/dev/null
  # Streamed to stdout so the archive is created by THIS user, not by root inside the container: a root-owned file in the
  # backup directory could not be chmodded, moved off the host by the operator, or removed by retention.
  docker run --rm --user 0 --entrypoint tar -v "${OBJ_VOLUME}:/data:ro" "${OBJ_IMAGE}" czf - -C /data . > "${OBJ_TARGET}.partial"
  restart_objects
  trap - EXIT
  mv "${OBJ_TARGET}.partial" "${OBJ_TARGET}"
  chmod 600 "${OBJ_TARGET}"
  gzip -t "${OBJ_TARGET}"
  OBJ_FILES="$(tar -tzf "${OBJ_TARGET}" | grep -vc '/$' || true)"

  # Certificates and the rendered realm, without the CA private key (kept offline) and without the env file.
  log "archiving certificates and the Keycloak realm file"
  CFG_TARGET="${BASE}.config.tar.gz"
  tar -czf "${CFG_TARGET}" -C "${DEPLOY_DIR}/config" --exclude='tls/root.key' tls keycloak
  chmod 600 "${CFG_TARGET}"

  COMPANION_LINES=(
    "keycloak_file=$(basename "${KC_TARGET}")"
    "keycloak_sha256=$(sha256sum "${KC_TARGET}" | awk '{print $1}')"
    "object_store_file=$(basename "${OBJ_TARGET}")"
    "object_store_sha256=$(sha256sum "${OBJ_TARGET}" | awk '{print $1}')"
    "object_store_files=${OBJ_FILES}"
    "config_file=$(basename "${CFG_TARGET}")"
    "config_sha256=$(sha256sum "${CFG_TARGET}" | awk '{print $1}')"
    "env_file=excluded_keep_the_sealed_copy"
  )
fi

# Values above are generated identifiers/numbers, not free-form data. The
# manifest deliberately contains no environment file or live credential.
( umask 077; printf '%s\n' \
  "format=${FORMAT}" \
  "created_at=${STAMP}" \
  "postgres_major=16" \
  "artifact_version=${VERSION}" \
  "source_commit=${COMMIT}" \
  "database_file=$(basename "${TARGET}")" \
  "database_sha256=${SHA256}" \
  "database_bytes=${SIZE}" \
  "migration_count=${MIGRATIONS}" \
  "tenant_count=${TENANTS}" \
  "object_store_status=${OBJECT_STATUS}" \
  "encryption_status=operator_managed" \
  ${COMPANION_LINES[@]+"${COMPANION_LINES[@]}"} > "${MANIFEST}" )

if ! mode_b_enabled; then
  warn "object-store bytes are not included in a Mode A backup; pair this database artifact with a provider snapshot before treating it as a complete recovery set"
fi

log "backup complete and verified: ${TARGET} (${SIZE} bytes; manifest ${MANIFEST})"
printf '%s\n' "${TARGET}"
