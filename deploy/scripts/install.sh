#!/usr/bin/env bash
# Verity — first install (Task 42).
#
# Idempotent and safe to re-run: it will not overwrite an existing env file,
# and migrate/bootstrap are themselves idempotent.
#
#   ./deploy/scripts/install.sh
#   VERITY_WITH_BUNDLED_STORAGE=1 ./deploy/scripts/install.sh   # with the bundled object store
#   (VERITY_WITH_MINIO=1 still works but is deprecated and warns: the bundled store is SeaweedFS now)

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker

secret() { openssl rand -base64 32 | tr -d '\n=+/' | cut -c1-40; }

if [ -f "${ENV_FILE}" ]; then
  log "env file already exists at ${ENV_FILE} — leaving it untouched"
else
  log "generating ${ENV_FILE}"
  mkdir -p "$(dirname "${ENV_FILE}")"
  # Created 0600 before anything is written to it, not after: a window in which
  # the credentials are world-readable is still a window.
  ( umask 077; cp "${DEPLOY_DIR}/config/verity.env.example" "${ENV_FILE}" )
  chmod 600 "${ENV_FILE}"

  tmp="$(mktemp)"; trap 'rm -f "${tmp}"' EXIT
  sed \
    -e "s|^POSTGRES_SUPERUSER_PASSWORD=.*|POSTGRES_SUPERUSER_PASSWORD=$(secret)|" \
    -e "s|^VERITY_APP_PASSWORD=.*|VERITY_APP_PASSWORD=$(secret)|" \
    -e "s|^VERITY_SESSION_SECRET=.*|VERITY_SESSION_SECRET=$(secret)|" \
    -e "s|^CRON_SECRET=.*|CRON_SECRET=$(secret)|" \
    -e "s|^VERITY_S3_ACCESS_KEY_ID=.*|VERITY_S3_ACCESS_KEY_ID=verity$(secret | cut -c1-12)|" \
    -e "s|^VERITY_S3_SECRET_ACCESS_KEY=.*|VERITY_S3_SECRET_ACCESS_KEY=$(secret)|" \
    -e "s|^VERITY_COMMIT=.*|VERITY_COMMIT=$(git -C "${REPO_DIR}" rev-parse --short HEAD 2>/dev/null || echo unknown)|" \
    "${ENV_FILE}" > "${tmp}"
  cat "${tmp}" > "${ENV_FILE}"
  log "generated credentials — back up ${ENV_FILE}; it is not recoverable from the deployment"
  log "configuration initialized; edit provider/storage values in ${ENV_FILE}, then rerun this command"
  exit 0
fi

require_env_file
"${DEPLOY_DIR}/security/preflight.sh"

log "building the application image"
compose build

log "starting the database"
compose up -d db
bundled_storage_enabled && compose up -d objects

# Explicit, ordered, visible. Never an image entrypoint: baking migration into
# container start makes every restart — including an autoscaler's — a potential
# schema change (Task 30's decision, kept).
"${SCRIPT_DIR}/migrate.sh"
"${SCRIPT_DIR}/bootstrap.sh" || warn "bootstrap did not complete — see above; the application is still installed"

# The bucket must exist before the readiness check below, which fails without it
# (drill finding F5). No `|| warn`: a deployment that cannot reach or provision its
# storage must stop here with the reason, not at a health check that only says 503.
"${SCRIPT_DIR}/ensure-bucket.sh"

log "starting the application and scheduler"
compose up -d web scheduler

"${SCRIPT_DIR}/health.sh"
log "install complete"
