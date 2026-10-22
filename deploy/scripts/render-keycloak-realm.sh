#!/usr/bin/env bash
# Renders the Keycloak realm import file from the template and the env file (Task 129 B1).
#
#   ./deploy/scripts/render-keycloak-realm.sh
#
# The output (deploy/config/keycloak/realm-dsew.json) holds the confidential client's secret, so it is created 0600 and is
# gitignored. Keycloak imports it on first start only; changing it later does not change a realm that already exists (use the
# admin console or kcadm for that). The values come from the env file so the issuer, redirect URI and client secret cannot
# disagree between Keycloak and Verity.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_env_file

TEMPLATE="${DEPLOY_DIR}/keycloak/realm-dsew.json.tmpl"
OUT_DIR="${DEPLOY_DIR}/config/keycloak"
OUT="${OUT_DIR}/realm-dsew.json"

APP_ORIGIN="$(env_value VERITY_PUBLIC_URL)"; APP_ORIGIN="${APP_ORIGIN%/}"
CLIENT_SECRET="$(env_value VERITY_OIDC_CLIENT_SECRET)"
[ -n "${APP_ORIGIN}" ] || die "VERITY_PUBLIC_URL is empty in ${ENV_FILE}"
[ "${#CLIENT_SECRET}" -ge 24 ] || die "VERITY_OIDC_CLIENT_SECRET must be set and at least 24 characters in ${ENV_FILE}"
case "${CLIENT_SECRET}" in *[\|\&\\\"]*) die "VERITY_OIDC_CLIENT_SECRET contains a character that cannot be rendered safely" ;; esac

( umask 077; mkdir -p "${OUT_DIR}" )
tmp="$(mktemp)"; trap 'rm -f "${tmp}"' EXIT
sed -e "s|@@APP_ORIGIN@@|${APP_ORIGIN}|g" -e "s|@@CLIENT_SECRET@@|${CLIENT_SECRET}|g" "${TEMPLATE}" > "${tmp}"
if grep -q '@@' "${tmp}"; then die "the realm template still has an unresolved placeholder"; fi
( umask 077; cat "${tmp}" > "${OUT}" )
chmod 600 "${OUT}"
log "rendered ${OUT}"
