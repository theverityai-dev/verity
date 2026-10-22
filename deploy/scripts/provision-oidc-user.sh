#!/usr/bin/env bash
# Creates a person in Keycloak and links them to a Verity role (Task 129 B2, Mode B).
#
#   ./deploy/scripts/provision-oidc-user.sh "<tenant name>" "<role name>" <email> "<display name>"
#
# Two steps, both idempotent:
#   1. Keycloak: create the account in realm dsew (or find it), with a one-time password the person must change at first
#      sign-in. The password is printed once and is never stored by this script. Supply your own with
#      VERITY_PROVISION_PASSWORD (10+ characters).
#   2. Verity: link the account's subject (a UUID) to a membership in the tenant (prisma/provision-oidc-user.ts, ADR-020).
#
# Verity never calls the Keycloak admin API; this script runs it on the host through `compose exec`, with the administrator
# credential read from the env file inside the container. Offboarding is the reverse and is deliberate: disable the Keycloak
# account (stops new sign-ins) and disable the Verity membership in the application (ADR-049; ends existing sessions).

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker
require_env_file
mode_b_enabled || die "this script is for Mode B deployments (VERITY_DEPLOYMENT_MODE=B)"

TENANT="${1:-}"; ROLE="${2:-}"; EMAIL="${3:-}"; NAME="${4:-}"
[ -n "${TENANT}" ] && [ -n "${ROLE}" ] && [ -n "${EMAIL}" ] && [ -n "${NAME}" ] \
  || die 'usage: provision-oidc-user.sh "<tenant name>" "<role name>" <email> "<display name>"'
case "${EMAIL}" in *@*.*) ;; *) die "'${EMAIL}' does not look like an email address" ;; esac

PASSWORD="${VERITY_PROVISION_PASSWORD:-$(openssl rand -base64 18 | tr -d '\n=+/' | cut -c1-16)}"
[ "${#PASSWORD}" -ge 10 ] || die "VERITY_PROVISION_PASSWORD must be at least 10 characters"

# Refuse before creating anything in Keycloak: a typo in the tenant or role must not leave an account nothing is linked to.
compose --profile tools run --rm --entrypoint "" -e CHECK_ONLY=1 tools   npx tsx prisma/provision-oidc-user.ts "${TENANT}" "${ROLE}" "${EMAIL}" "${NAME}" >/dev/null   || die "nothing was created: fix the tenant or role above and run again"

KC_ADMIN="$(env_value KEYCLOAK_ADMIN)"; KC_ADMIN_PASSWORD="$(env_value KEYCLOAK_ADMIN_PASSWORD)"

# One shell inside the container so kcadm's session file is shared by every call. Credentials travel as environment
# variables of that process, not as arguments on the host.
STATUS_FILE="$(mktemp)"; trap 'rm -f "${STATUS_FILE}"' EXIT
SUB="$(
  compose exec -T -e KC_ADMIN="${KC_ADMIN}" -e KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD}" \
    -e U_EMAIL="${EMAIL}" -e U_NAME="${NAME}" -e U_PASSWORD="${PASSWORD}" keycloak sh -c '
      set -e
      K=/opt/keycloak/bin/kcadm.sh
      $K config credentials --server http://localhost:8080 --realm master --user "$KC_ADMIN" --password "$KC_ADMIN_PASSWORD" >/dev/null
      ID="$($K get users -r dsew -q "email=$U_EMAIL" -q exact=true --fields id --format csv --noquotes | head -n 1)"
      if [ -z "$ID" ]; then
        FIRST="${U_NAME%% *}"; LAST="${U_NAME#* }"; [ "$LAST" = "$U_NAME" ] && LAST="-"
        ID="$($K create users -r dsew -s "username=$U_EMAIL" -s "email=$U_EMAIL" -s "firstName=$FIRST" -s "lastName=$LAST" -s enabled=true -s emailVerified=true -i)"
        $K set-password -r dsew --username "$U_EMAIL" --new-password "$U_PASSWORD" --temporary
        echo "created" >&2
      else
        echo "exists" >&2
      fi
      printf "%s" "$ID"
    ' 2>"${STATUS_FILE}" | tr -d '\r'
)"
KC_STATUS="$(grep -E '^(created|exists)' "${STATUS_FILE}" | tail -n 1 | tr -d '\r')"
case "${SUB}" in
  [0-9a-f]*-*-*-*-*) ;;
  *) die "could not obtain the Keycloak account id (got '${SUB}')" ;;
esac

compose --profile tools run --rm --entrypoint "" -e OIDC_SUB="${SUB}" tools \
  npx tsx prisma/provision-oidc-user.ts "${TENANT}" "${ROLE}" "${EMAIL}" "${NAME}"

log "Keycloak account ${EMAIL} (subject ${SUB})"
if [ "${KC_STATUS}" = "created" ]; then
  log "one-time password (change at first sign-in): ${PASSWORD}"
else
  log "the Keycloak account already existed; its password was not changed"
fi
