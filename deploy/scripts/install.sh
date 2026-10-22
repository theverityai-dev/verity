#!/usr/bin/env bash
# Verity — first install (Task 42).
#
# Idempotent and safe to re-run: it will not overwrite an existing env file,
# and migrate/bootstrap are themselves idempotent.
#
#   ./deploy/scripts/install.sh
#   VERITY_WITH_BUNDLED_STORAGE=1 ./deploy/scripts/install.sh   # with the bundled object store
#   (VERITY_WITH_MINIO=1 still works but is deprecated and warns: the bundled store is SeaweedFS now)
#   VERITY_DEPLOYMENT_MODE=B VERITY_APP_HOST=verity.dsew.lan ./deploy/scripts/install.sh   # Mode B (Task 129): Keycloak + TLS proxy
#     Optional on the first run: VERITY_IDP_HOST, VERITY_FILES_HOST (default idp.<domain>, files.<domain> of the app host),
#     VERITY_HTTPS_PORT (default 443). After that, mode and hosts are read from the env file.

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

  if [ "${VERITY_DEPLOYMENT_MODE:-A}" = "B" ]; then
    [ -n "${VERITY_APP_HOST:-}" ] || die "Mode B needs VERITY_APP_HOST (the name staff type, e.g. verity.dsew.lan)"
    domain="${VERITY_APP_HOST#*.}"
    [ "${domain}" != "${VERITY_APP_HOST}" ] || domain="${VERITY_APP_HOST}"
    idp_host="${VERITY_IDP_HOST:-idp.${domain}}"; files_host="${VERITY_FILES_HOST:-files.${domain}}"
    port="${VERITY_HTTPS_PORT:-443}"; suffix=""; [ "${port}" = "443" ] || suffix=":${port}"
    app_url="https://${VERITY_APP_HOST}${suffix}"; idp_url="https://${idp_host}${suffix}"; files_url="https://${files_host}${suffix}"
    sed       -e "s|^VERITY_DEPLOYMENT_MODE=.*|VERITY_DEPLOYMENT_MODE=B|"       -e "s|^VERITY_APP_HOST=.*|VERITY_APP_HOST=${VERITY_APP_HOST}|"       -e "s|^VERITY_IDP_HOST=.*|VERITY_IDP_HOST=${idp_host}|"       -e "s|^VERITY_FILES_HOST=.*|VERITY_FILES_HOST=${files_host}|"       -e "s|^VERITY_HTTPS_PORT=.*|VERITY_HTTPS_PORT=${port}|"       -e "s|^VERITY_IDP_URL=.*|VERITY_IDP_URL=${idp_url}|"       -e "s|^KEYCLOAK_ADMIN=.*|KEYCLOAK_ADMIN=kcadmin$(secret | cut -c1-8)|"       -e "s|^KEYCLOAK_ADMIN_PASSWORD=.*|KEYCLOAK_ADMIN_PASSWORD=$(secret)|"       -e "s|^KEYCLOAK_DB_PASSWORD=.*|KEYCLOAK_DB_PASSWORD=$(secret)|"       -e "s|^VERITY_AUTH_PROVIDER=.*|VERITY_AUTH_PROVIDER=oidc|"       -e "s|^VERITY_OIDC_ISSUER=.*|VERITY_OIDC_ISSUER=${idp_url}/realms/dsew|"       -e "s|^VERITY_OIDC_CLIENT_ID=.*|VERITY_OIDC_CLIENT_ID=verity-web|"       -e "s|^VERITY_OIDC_REDIRECT_URI=.*|VERITY_OIDC_REDIRECT_URI=${app_url}/api/auth/oidc/callback|"       -e "s|^VERITY_PUBLIC_URL=.*|VERITY_PUBLIC_URL=${app_url}|"       -e "s|^VERITY_OIDC_CLIENT_SECRET=.*|VERITY_OIDC_CLIENT_SECRET=$(secret)|"       -e "s|^VERITY_OIDC_AUDIENCE=.*|VERITY_OIDC_AUDIENCE=verity-web|"       -e "s|^VERITY_STORAGE_DRIVER=.*|VERITY_STORAGE_DRIVER=s3|"       -e "s|^VERITY_S3_ENDPOINT=.*|VERITY_S3_ENDPOINT=${files_url}|"       -e "s|^VERITY_S3_FORCE_PATH_STYLE=.*|VERITY_S3_FORCE_PATH_STYLE=true|"       "${ENV_FILE}" > "${tmp}"
    cat "${tmp}" > "${ENV_FILE}"
    log "Mode B settings written (app ${app_url}, identity ${idp_url}, files ${files_url})"
    log "next: run this command again; it creates the internal CA, renders the Keycloak realm, and installs"
    log "      (to use DSEW's own certificate instead, place server.crt, server.key and root.crt in deploy/config/tls first)"
  fi
  log "generated credentials — back up ${ENV_FILE}; it is not recoverable from the deployment"
  log "configuration initialized; edit provider/storage values in ${ENV_FILE}, then rerun this command"
  exit 0
fi

require_env_file

if mode_b_enabled; then
  # The certificate and the realm file must exist before preflight reads them and before any container mounts them.
  "${SCRIPT_DIR}/make-internal-ca.sh"
  "${SCRIPT_DIR}/render-keycloak-realm.sh"
fi
"${DEPLOY_DIR}/security/preflight.sh"

log "building the application and operator-tools images"
build_images

log "starting the database"
compose up -d db
bundled_storage_enabled && compose up -d objects
if mode_b_enabled; then
  # Identity and the TLS proxy before anything that talks to the object store by its public name (ensure-bucket) or signs in.
  log "starting Keycloak and the TLS proxy (Mode B)"
  compose up -d keycloak-db keycloak proxy
fi

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
