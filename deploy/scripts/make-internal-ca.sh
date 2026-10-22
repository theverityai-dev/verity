#!/usr/bin/env bash
# Creates the internal certificate authority and the server certificate for Mode B (Task 129 B3).
#
#   ./deploy/scripts/make-internal-ca.sh
#
# Output, in deploy/config/tls (gitignored; mode 0700):
#   root.crt    the CA certificate. Install this on every PC and phone that opens Verity (see deploy/docs/trust-the-ca.md).
#               Public by nature; safe to email.
#   root.key    the CA private key. Used once here to sign, then KEEP OFFLINE (move it off the server). Anyone holding it can
#               mint a certificate every trusting device would accept. Nothing in the deployment reads it after this script.
#   server.crt  the certificate for VERITY_APP_HOST, VERITY_IDP_HOST and VERITY_FILES_HOST (825 days; browsers cap longer).
#   server.key  its private key (mode 0600). Read by the proxy.
#
# Idempotent: refuses to overwrite an existing CA. To rotate the server certificate only, set VERITY_TLS_ROTATE=1 (the CA is
# kept; the CA key must still be present). To use DSEW's own certificate instead, skip this script and place server.crt,
# server.key and root.crt (the chain's root, or the same file as server.crt for a self-signed certificate) in that directory.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_env_file
command -v openssl >/dev/null 2>&1 || die "openssl is required"

TLS_DIR="${DEPLOY_DIR}/config/tls"
APP_HOST="$(env_value VERITY_APP_HOST)"
IDP_HOST="$(env_value VERITY_IDP_HOST)"
FILES_HOST="$(env_value VERITY_FILES_HOST)"
[ -n "${APP_HOST}" ] && [ -n "${IDP_HOST}" ] && [ -n "${FILES_HOST}" ] \
  || die "VERITY_APP_HOST, VERITY_IDP_HOST and VERITY_FILES_HOST must be set in ${ENV_FILE}"

( umask 077; mkdir -p "${TLS_DIR}" )
chmod 700 "${TLS_DIR}"

if [ -f "${TLS_DIR}/root.crt" ] && [ "${VERITY_TLS_ROTATE:-0}" != "1" ]; then
  log "a certificate authority already exists in ${TLS_DIR}; leaving it untouched (set VERITY_TLS_ROTATE=1 to reissue the server certificate)"
  exit 0
fi

if [ ! -f "${TLS_DIR}/root.crt" ]; then
  log "creating the internal root CA"
  ( umask 077; openssl genrsa -out "${TLS_DIR}/root.key" 4096 2>/dev/null )
  openssl req -x509 -new -nodes -key "${TLS_DIR}/root.key" -sha256 -days 3650 \
    -subj "/O=Verity on-premises/CN=Verity internal root CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "${TLS_DIR}/root.crt"
else
  [ -f "${TLS_DIR}/root.key" ] || die "VERITY_TLS_ROTATE=1 needs ${TLS_DIR}/root.key; restore it from the offline copy"
fi

log "issuing the server certificate for ${APP_HOST}, ${IDP_HOST}, ${FILES_HOST}"
( umask 077; openssl genrsa -out "${TLS_DIR}/server.key" 2048 2>/dev/null )
csr="$(mktemp)"; ext="$(mktemp)"; trap 'rm -f "${csr}" "${ext}"' EXIT
openssl req -new -key "${TLS_DIR}/server.key" -subj "/O=Verity on-premises/CN=${APP_HOST}" -out "${csr}"
{
  echo "basicConstraints=critical,CA:FALSE"
  echo "keyUsage=critical,digitalSignature,keyEncipherment"
  echo "extendedKeyUsage=serverAuth"
  echo "subjectAltName=DNS:${APP_HOST},DNS:${IDP_HOST},DNS:${FILES_HOST}"
} > "${ext}"
openssl x509 -req -in "${csr}" -CA "${TLS_DIR}/root.crt" -CAkey "${TLS_DIR}/root.key" -CAcreateserial \
  -out "${TLS_DIR}/server.crt" -days 825 -sha256 -extfile "${ext}" 2>/dev/null
chmod 600 "${TLS_DIR}/server.key"
chmod 644 "${TLS_DIR}/root.crt" "${TLS_DIR}/server.crt"
rm -f "${TLS_DIR}/root.srl"

log "done. Install ${TLS_DIR}/root.crt on every device that opens Verity, then MOVE ${TLS_DIR}/root.key OFF THIS SERVER."
