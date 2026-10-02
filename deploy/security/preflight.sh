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

# ── Result ─────────────────────────────────────────────────────────────────
if [ "${FAILURES}" -gt 0 ]; then
  die "${FAILURES} preflight check(s) failed — refusing to proceed"
fi
log "preflight passed"
