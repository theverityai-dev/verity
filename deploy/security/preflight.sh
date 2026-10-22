#!/usr/bin/env bash
# Refuses to start an unsafe deployment (Task 42).
#
# Run by install.sh, and safe to run at any time. Every check here exists
# because the failure it prevents is silent: the deployment works, and is
# wrong.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../scripts/_common.sh"
require_env_file

FAILURES=0
fail() { printf '[verity] PREFLIGHT FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { printf '[verity] preflight ok: %s\n' "$*"; }

ENVIRONMENT="$(env_value VERITY_ENVIRONMENT)"; ENVIRONMENT="${ENVIRONMENT:-production}"

# ── 1. No example credential may reach a running deployment ────────────────
# The example file's placeholders all start CHANGE_ME. A deployment carrying
# one is running on a password published in this repository.
for key in POSTGRES_SUPERUSER_PASSWORD VERITY_APP_PASSWORD VERITY_SESSION_SECRET CRON_SECRET; do
  value="$(env_value "${key}")"
  case "${value}" in
    CHANGE_ME*) fail "${key} is still the example placeholder" ;;
    "")         fail "${key} is empty" ;;
    *)
      minimum=16
      case "${key}" in VERITY_SESSION_SECRET|CRON_SECRET) minimum=32 ;; esac
      [ "${#value}" -ge "${minimum}" ] || fail "${key} is shorter than ${minimum} characters"
      ;;
  esac
done
[ "${FAILURES}" -eq 0 ] && pass "no example or weak credential in ${ENV_FILE}"

# ── 2. The env file must not be world-readable ─────────────────────────────
# Already enforced by require_env_file; stated here so the report is complete.
pass "env file permissions"

# ── 3. Exposure ────────────────────────────────────────────────────────────
BIND="$(env_value VERITY_BIND_ADDRESS)"; BIND="${BIND:-127.0.0.1}"
if [ "${BIND}" = "0.0.0.0" ] && [ "${ENVIRONMENT}" = "production" ]; then
  fail "VERITY_BIND_ADDRESS=0.0.0.0 publishes plain HTTP on every interface; bind to 127.0.0.1 and terminate TLS in a reverse proxy"
else
  pass "application bind address (${BIND})"
fi

# The compose file publishes no database or object-store port at all. This
# check catches an operator who added one by hand.
if grep -qE '^[[:space:]]*-[[:space:]]*"?[0-9.]*:?5432:5432' "${COMPOSE_DIR}/docker-compose.yml"; then
  fail "the compose file publishes the database port"
else
  pass "database publishes no host port"
fi

# ── 4. Identity ────────────────────────────────────────────────────────────
PROVIDER="$(env_value VERITY_AUTH_PROVIDER)"; PROVIDER="${PROVIDER:-supabase}"
case "${PROVIDER}" in
  supabase)
    [ -n "$(env_value NEXT_PUBLIC_SUPABASE_URL)" ] || fail "VERITY_AUTH_PROVIDER=supabase but NEXT_PUBLIC_SUPABASE_URL is empty"
    [ -n "$(env_value NEXT_PUBLIC_SUPABASE_ANON_KEY)" ] || fail "VERITY_AUTH_PROVIDER=supabase but NEXT_PUBLIC_SUPABASE_ANON_KEY is empty"
    ;;
  oidc)
    [ -n "$(env_value VERITY_OIDC_ISSUER)" ] || fail "VERITY_AUTH_PROVIDER=oidc but VERITY_OIDC_ISSUER is empty"
    [ -n "$(env_value VERITY_OIDC_CLIENT_ID)" ] || fail "VERITY_AUTH_PROVIDER=oidc but VERITY_OIDC_CLIENT_ID is empty"
    [ -n "$(env_value VERITY_OIDC_REDIRECT_URI)" ] || fail "VERITY_AUTH_PROVIDER=oidc but VERITY_OIDC_REDIRECT_URI is empty"
    issuer="$(env_value VERITY_OIDC_ISSUER)"
    redirect_uri="$(env_value VERITY_OIDC_REDIRECT_URI)"
    case "${issuer}" in
      https://*) ;;
      *) [ "${ENVIRONMENT}" = "production" ] && fail "VERITY_OIDC_ISSUER must be https in production (got ${issuer})" ;;
    esac
    case "${redirect_uri}" in
      https://*/api/auth/oidc/callback) ;;
      *) [ "${ENVIRONMENT}" = "production" ] && fail "VERITY_OIDC_REDIRECT_URI must be the HTTPS Verity callback URL" ;;
    esac
    # ADR-032: the browser-facing origin is configured, never taken from the request.
    public_url="$(env_value VERITY_PUBLIC_URL)"
    if [ -z "${public_url}" ]; then
      fail "VERITY_AUTH_PROVIDER=oidc but VERITY_PUBLIC_URL is empty (set it to the origin browsers use, e.g. https://verity.example.com)"
    else
      case "${public_url}" in
        http://*|https://*) ;;
        *) fail "VERITY_PUBLIC_URL must be an absolute http:// or https:// URL (got ${public_url})" ;;
      esac
      # Origin only: nothing after the host (and optional port) except one optional slash.
      printf '%s' "${public_url}" | grep -Eq '^https?://[^/?#@]+/?$' \
        || fail "VERITY_PUBLIC_URL must be an origin only, with no path, query, fragment or credentials (got ${public_url})"
      case "${public_url}" in
        https://*) ;;
        *) [ "${ENVIRONMENT}" = "production" ] && fail "VERITY_PUBLIC_URL must be https in production (got ${public_url})" ;;
      esac
      case "${redirect_uri}" in
        "${public_url%/}"/*) ;;
        *) fail "VERITY_OIDC_REDIRECT_URI must be on VERITY_PUBLIC_URL (${public_url%/})" ;;
      esac
    fi
    ;;
  *) fail "VERITY_AUTH_PROVIDER must be supabase or oidc (got ${PROVIDER})" ;;
esac
pass "identity provider (${PROVIDER})"

# ── 5. Storage ─────────────────────────────────────────────────────────────
DRIVER="$(env_value VERITY_STORAGE_DRIVER)"; DRIVER="${DRIVER:-supabase}"
if [ "${DRIVER}" = "s3" ]; then
  for key in VERITY_S3_BUCKET VERITY_S3_ACCESS_KEY_ID VERITY_S3_SECRET_ACCESS_KEY; do
    [ -n "$(env_value "${key}")" ] || fail "VERITY_STORAGE_DRIVER=s3 but ${key} is empty"
  done
  s3_secret="$(env_value VERITY_S3_SECRET_ACCESS_KEY)"
  case "${s3_secret}" in
    CHANGE_ME*) fail "VERITY_S3_SECRET_ACCESS_KEY is still the example placeholder" ;;
    *) [ "${#s3_secret}" -ge 16 ] || fail "VERITY_S3_SECRET_ACCESS_KEY is shorter than 16 characters" ;;
  esac
  create_bucket="$(env_value VERITY_STORAGE_CREATE_BUCKET)"
  case "${create_bucket:-true}" in
    true|false) ;;
    *) fail "VERITY_STORAGE_CREATE_BUCKET must be exactly true or false (got ${create_bucket})" ;;
  esac
  endpoint="$(env_value VERITY_S3_ENDPOINT)"
  style="$(env_value VERITY_S3_FORCE_PATH_STYLE)"
  # SignatureDoesNotMatch from a virtual-hosted signature against a path-style
  # server reads exactly like a wrong secret key. Warn where it is guessable.
  if [ -n "${endpoint}" ] && [ "${style}" != "true" ]; then
    warn "VERITY_S3_ENDPOINT is set but VERITY_S3_FORCE_PATH_STYLE is not true — self-hosted S3 servers are usually path-style"
  fi
fi
pass "storage driver (${DRIVER})"

# ── 6. Database timezone ───────────────────────────────────────────────────
# Task 36's finding. Availability and SLA behaviour are subtly wrong on a
# non-UTC database session, and every test still passes. Checked live when the
# database is up, and statically otherwise.
DBNAME="$(env_value POSTGRES_DB)"; DBNAME="${DBNAME:-verity}"
if docker version >/dev/null 2>&1 && compose ps db 2>/dev/null | grep -q db; then
  tz="$(compose exec -T db psql -U postgres -d "${DBNAME}" -tAc 'show timezone' 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "${tz}" ] && [ "${tz}" != "UTC" ]; then
    fail "the database session timezone is ${tz}, not UTC — availability and SLA behaviour will be wrong while every test still passes"
  else
    pass "database session timezone (${tz:-not running, pinned in compose})"
  fi
else
  if grep -q 'timezone=UTC' "${COMPOSE_DIR}/docker-compose.yml"; then
    pass "database timezone pinned to UTC in the compose file"
  else
    fail "the compose file does not pin the database timezone to UTC"
  fi
fi

# ── 7. Mode B (private network) ────────────────────────────────────────────
# Task 129 B1/B3. Only checked when the env file says Mode B. Each check names a failure that is silent: sign-in loops at the
# wrong issuer, an upload that signs for a name no browser can reach, or an identity provider still on its default account.
if mode_b_enabled; then
  app_host="$(env_value VERITY_APP_HOST)"; idp_host="$(env_value VERITY_IDP_HOST)"; files_host="$(env_value VERITY_FILES_HOST)"
  for key in VERITY_APP_HOST VERITY_IDP_HOST VERITY_FILES_HOST VERITY_IDP_URL; do
    [ -n "$(env_value "${key}")" ] || fail "Mode B but ${key} is empty"
  done
  if [ -n "${app_host}" ] && { [ "${app_host}" = "${idp_host}" ] || [ "${app_host}" = "${files_host}" ] || [ "${idp_host}" = "${files_host}" ]; }; then
    fail "VERITY_APP_HOST, VERITY_IDP_HOST and VERITY_FILES_HOST must be three different names"
  fi

  kc_user="$(env_value KEYCLOAK_ADMIN)"
  case "${kc_user}" in
    ""|admin|administrator|root|keycloak|CHANGE_ME*) fail "KEYCLOAK_ADMIN is empty, a default account name, or still the example placeholder" ;;
  esac
  for key in KEYCLOAK_ADMIN_PASSWORD KEYCLOAK_DB_PASSWORD VERITY_OIDC_CLIENT_SECRET; do
    value="$(env_value "${key}")"
    case "${value}" in
      CHANGE_ME*) fail "${key} is still the example placeholder" ;;
      "")         fail "${key} is empty" ;;
      *) [ "${#value}" -ge 24 ] || fail "${key} is shorter than 24 characters" ;;
    esac
  done

  # The three public names must be the ones the settings actually use, or sign-in and uploads fail with a plain "not reachable".
  case "$(env_value VERITY_PUBLIC_URL)" in https://"${app_host}"|https://"${app_host}":*) ;; *) fail "VERITY_PUBLIC_URL must be on VERITY_APP_HOST (${app_host})" ;; esac
  case "$(env_value VERITY_OIDC_ISSUER)" in https://"${idp_host}"/*|https://"${idp_host}":*/*) ;; *) fail "VERITY_OIDC_ISSUER must be on VERITY_IDP_HOST (${idp_host})" ;; esac
  case "$(env_value VERITY_S3_ENDPOINT)" in https://"${files_host}"|https://"${files_host}":*) ;; *) fail "VERITY_S3_ENDPOINT must be the browser-reachable https name on VERITY_FILES_HOST (${files_host}); an internal name such as http://objects:9000 cannot be reached by a phone, so presigned uploads would fail" ;; esac

  TLS_DIR="${DEPLOY_DIR}/config/tls"
  for f in root.crt server.crt server.key; do
    [ -f "${TLS_DIR}/${f}" ] || fail "${TLS_DIR}/${f} is missing (run deploy/scripts/make-internal-ca.sh, or supply your own certificate)"
  done
  if [ -f "${TLS_DIR}/server.key" ]; then
    mode="$(file_mode "${TLS_DIR}/server.key" || true)"
    case "${mode}" in 600|400) ;; *) fail "${TLS_DIR}/server.key is mode ${mode:-unknown}; run: chmod 600 ${TLS_DIR}/server.key" ;; esac
  fi
  if [ -f "${TLS_DIR}/root.key" ]; then
    warn "the CA private key (${TLS_DIR}/root.key) is still on this server; move it to offline storage, nothing needs it after the certificate is issued"
  fi
  if [ -f "${TLS_DIR}/server.crt" ] && command -v openssl >/dev/null 2>&1; then
    openssl x509 -in "${TLS_DIR}/server.crt" -noout -checkend $((30 * 86400)) >/dev/null 2>&1 \
      || fail "the server certificate expires within 30 days or is unreadable"
    for name in "${app_host}" "${idp_host}" "${files_host}"; do
      openssl x509 -in "${TLS_DIR}/server.crt" -noout -ext subjectAltName 2>/dev/null | grep -qE "DNS:${name}(,|$)" \
        || fail "the server certificate does not list ${name}"
    done
  fi
  [ -f "${DEPLOY_DIR}/config/keycloak/realm-dsew.json" ] || fail "the Keycloak realm file is missing (run deploy/scripts/render-keycloak-realm.sh)"
  pass "Mode B (names, Keycloak credentials, certificate, realm)"
else
  pass "deployment mode A (Mode B checks not applicable)"
fi

# ── Result ─────────────────────────────────────────────────────────────────
if [ "${FAILURES}" -gt 0 ]; then
  die "${FAILURES} preflight check(s) failed — refusing to proceed"
fi
log "preflight passed"
