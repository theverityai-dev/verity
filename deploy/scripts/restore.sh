#!/usr/bin/env bash
# Fail-closed full logical restore for the supported PostgreSQL 16 profile.
# The target database is recreated empty; the dump is the schema+data authority.
#
# Mode B (Task 129 B4): a v2 manifest names a recovery SET. Every file in it is checksummed before anything is changed, then
# the Verity database, the Keycloak database and the object-store bytes are restored together, because rows that point at
# files and accounts that were not restored with them are a corrupt system that looks healthy.

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker
require_env_file

DUMP="${1:-}"
[ -n "${DUMP}" ] || die "usage: restore.sh <dump-file>"
[ -f "${DUMP}" ] || die "no such dump file: ${DUMP}"
MANIFEST="${DUMP}.manifest"
[ -f "${MANIFEST}" ] || die "missing backup manifest: ${MANIFEST}"
DB="$(env_value POSTGRES_DB)"; DB="${DB:-verity}"
SET_DIR="$(cd "$(dirname "${DUMP}")" && pwd)"

[ "${VERITY_RESTORE_CONFIRM:-}" = "yes" ] || \
  die "this DROPS the ${DB} database. Re-run with VERITY_RESTORE_CONFIRM=yes."

manifest_value() { sed -n "s/^$1=//p" "${MANIFEST}" | head -n 1; }
FORMAT="$(manifest_value format)"
case "${FORMAT}" in
  verity-full-logical-v1|verity-full-logical-v2) ;;
  *) die "unsupported backup format" ;;
esac
[ "$(manifest_value postgres_major)" = "16" ] || die "backup is not certified for PostgreSQL 16"
EXPECTED_SHA="$(manifest_value database_sha256)"
[ -n "${EXPECTED_SHA}" ] || die "backup manifest has no database checksum"
ACTUAL_SHA="$(sha256sum "${DUMP}" | awk '{print $1}')"
[ "${ACTUAL_SHA}" = "${EXPECTED_SHA}" ] || die "database backup checksum mismatch"

# A v2 set restores the whole deployment, so it only makes sense on a Mode B stack, and a Mode B stack must not be restored
# from a v1 file (it would leave Keycloak and the object store untouched and mismatched).
if [ "${FORMAT}" = "verity-full-logical-v2" ]; then
  mode_b_enabled || die "this is a Mode B recovery set but VERITY_DEPLOYMENT_MODE is not B in ${ENV_FILE}"
  for kind in keycloak object_store config; do
    file="$(manifest_value "${kind}_file")"
    expected="$(manifest_value "${kind}_sha256")"
    [ -n "${file}" ] && [ -n "${expected}" ] || die "backup manifest is missing the ${kind} entry"
    [ -f "${SET_DIR}/${file}" ] || die "recovery set is incomplete: ${SET_DIR}/${file} is missing"
    [ "$(sha256sum "${SET_DIR}/${file}" | awk '{print $1}')" = "${expected}" ] || die "${kind} backup checksum mismatch (${file})"
  done
  KC_DUMP="${SET_DIR}/$(manifest_value keycloak_file)"
  OBJ_ARCHIVE="${SET_DIR}/$(manifest_value object_store_file)"
  CFG_ARCHIVE="${SET_DIR}/$(manifest_value config_file)"
  gzip -t "${OBJ_ARCHIVE}" || die "the object-store archive is corrupt"
  gzip -t "${CFG_ARCHIVE}" || die "the config archive is corrupt"
  log "recovery set verified: database, identity, object store and config all match the manifest"
elif mode_b_enabled; then
  die "this is a Mode A backup (no identity or object-store data) and this deployment is Mode B; refusing a partial restore"
fi

# A rebuilt host starts its databases a moment before this runs; `compose up -d` returns before they accept connections.
wait_ready() {
  local service="$1" user="$2"
  for _ in $(seq 1 60); do
    compose exec -T "${service}" pg_isready -U "${user}" >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "${service} did not accept connections within two minutes"
}
log "waiting for the databases"
wait_ready db postgres
if [ "${FORMAT}" = "verity-full-logical-v2" ]; then wait_ready keycloak-db keycloak; fi

log "verifying archive readability before changing the target"
compose exec -T db sh -c 'cat > /tmp/restore-verify.dump && pg_restore --list /tmp/restore-verify.dump >/dev/null && rm -f /tmp/restore-verify.dump' < "${DUMP}"
if [ "${FORMAT}" = "verity-full-logical-v2" ]; then
  compose exec -T keycloak-db sh -c 'cat > /tmp/restore-verify.dump && pg_restore --list /tmp/restore-verify.dump >/dev/null && rm -f /tmp/restore-verify.dump' < "${KC_DUMP}"
fi

log "stopping web and scheduler; failure leaves both stopped"
compose stop web scheduler >/dev/null 2>&1 || true

restore_failed() {
  warn "restore failed; web and scheduler remain stopped and the target remains quarantined"
}
trap restore_failed ERR

log "recreating empty ${DB}"
compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${DB}\" WITH (FORCE);" \
  -c "CREATE DATABASE \"${DB}\";"

log "restoring schema and data with immediate error termination"
compose exec -T db pg_restore -U postgres -d "${DB}" \
  --exit-on-error --no-owner < "${DUMP}"

# The backup may have recorded `normal`; recovery owns the release decision,
# so overwrite it before any application process can start.
compose exec -T db psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -c \
  "UPDATE public.deployment_state SET status='quarantined', details='{\"reason\":\"restore_verification\"}'::jsonb, updated_at=now() WHERE key='restore';"

log "verifying migration, constraints, role, RLS, policies, and timezone"
compose exec -T db psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  role_ok boolean;
  invalid_constraints integer;
  rls_tables integer;
  policy_count integer;
  failed_migrations integer;
  runtime_can_read boolean;
BEGIN
  SELECT NOT rolsuper AND NOT rolbypassrls INTO role_ok FROM pg_roles WHERE rolname = 'verity_app';
  IF role_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'verity_app is missing or can bypass RLS'; END IF;
  SELECT has_table_privilege('verity_app', 'public.tenant', 'SELECT') INTO runtime_can_read;
  IF runtime_can_read IS DISTINCT FROM true THEN RAISE EXCEPTION 'verity_app runtime grants were not restored'; END IF;

  SELECT count(*) INTO invalid_constraints FROM pg_constraint WHERE NOT convalidated;
  IF invalid_constraints <> 0 THEN RAISE EXCEPTION '% constraints are not validated', invalid_constraints; END IF;

  SELECT count(*) INTO rls_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
  SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname='public';
  IF rls_tables = 0 OR policy_count = 0 THEN RAISE EXCEPTION 'RLS policies are absent'; END IF;

  SELECT count(*) INTO failed_migrations FROM public._prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL;
  IF failed_migrations <> 0 THEN RAISE EXCEPTION '% migrations are incomplete', failed_migrations; END IF;

  IF current_setting('TimeZone') <> 'UTC' THEN RAISE EXCEPTION 'database timezone is not UTC'; END IF;
END $$;
SQL

EXPECTED_TENANTS="$(manifest_value tenant_count)"
ACTUAL_TENANTS="$(compose exec -T db psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -tAc 'SELECT count(*) FROM public.tenant' | tr -d '[:space:]')"
[ "${ACTUAL_TENANTS}" = "${EXPECTED_TENANTS}" ] || die "tenant count mismatch after restore"

if [ "${FORMAT}" = "verity-full-logical-v2" ]; then
  log "restoring the Keycloak database"
  compose stop keycloak >/dev/null 2>&1 || true
  compose exec -T keycloak-db psql -U keycloak -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS keycloak WITH (FORCE);" \
    -c "CREATE DATABASE keycloak;"
  compose exec -T keycloak-db pg_restore -U keycloak -d keycloak --exit-on-error --no-owner < "${KC_DUMP}"
  KC_REALMS="$(compose exec -T keycloak-db psql -U keycloak -d keycloak -tAc "SELECT count(*) FROM realm WHERE name='dsew'" | tr -d '[:space:]')"
  [ "${KC_REALMS}" = "1" ] || die "the dsew realm is missing after the Keycloak restore"

  log "restoring the object store"
  OBJ_CONTAINER="$(compose ps -aq objects)"
  [ -n "${OBJ_CONTAINER}" ] || die "the object store container does not exist; start it first (compose up -d objects)"
  # The volume mounted on THIS project's object store, never a name search (see backup.sh): wiping the wrong volume would
  # destroy another deployment's files.
  OBJ_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "${OBJ_CONTAINER}")"
  [ -n "${OBJ_VOLUME}" ] || die "could not determine the object-store volume from its container"
  OBJ_IMAGE="$(docker inspect --format '{{.Config.Image}}' "${OBJ_CONTAINER}")"
  compose stop objects >/dev/null 2>&1 || true
  # Emptied first so the volume holds exactly the backed-up bytes; counted before the store starts, because starting it
  # writes index files of its own.
  docker run --rm --user 0 --entrypoint sh -v "${OBJ_VOLUME}:/data" -v "${SET_DIR}:/in:ro" "${OBJ_IMAGE}" \
    -c "find /data -mindepth 1 -delete && tar xzf /in/$(manifest_value object_store_file) -C /data && chown -R 1000:1000 /data"
  RESTORED_FILES="$(docker run --rm --user 0 --entrypoint sh -v "${OBJ_VOLUME}:/data:ro" "${OBJ_IMAGE}" -c "find /data -type f | wc -l" | tr -d '[:space:]')"
  [ "${RESTORED_FILES}" = "$(manifest_value object_store_files)" ] \
    || die "object-store file count mismatch after restore (${RESTORED_FILES} restored, manifest says $(manifest_value object_store_files))"

  # Certificates are restored only where they are missing (a rebuilt host). On the same host they already match; a
  # difference is reported, never silently overwritten, because replacing a live certificate is the operator's decision.
  TMP_CFG="$(mktemp -d)"; trap 'rm -rf "${TMP_CFG}"; restore_failed' ERR
  tar -xzf "${CFG_ARCHIVE}" -C "${TMP_CFG}"
  for item in tls keycloak; do
    if [ ! -d "${DEPLOY_DIR}/config/${item}" ]; then
      ( umask 077; mkdir -p "${DEPLOY_DIR}/config" ); cp -a "${TMP_CFG}/${item}" "${DEPLOY_DIR}/config/${item}"
      log "restored ${item} configuration"
    elif ! diff -rq -x root.key "${TMP_CFG}/${item}" "${DEPLOY_DIR}/config/${item}" >/dev/null 2>&1; then
      warn "deploy/config/${item} differs from the backup; left as it is"
    fi
  done
  rm -rf "${TMP_CFG}"
  trap restore_failed ERR

  compose up -d objects keycloak
fi

log "database verification passed; releasing quarantine and restarting services"
compose exec -T db psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -c \
  "UPDATE public.deployment_state SET status='normal', details='{}'::jsonb, updated_at=now() WHERE key='restore';"
trap - ERR
compose up -d web scheduler
"${SCRIPT_DIR}/health.sh"
log "restore complete and verified"
