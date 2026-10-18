#!/usr/bin/env bash
# Applies pending database migrations (Task 42).
#
# Runs as the privileged role through DIRECT_URL — migrations create tables and
# policies, which the NOBYPASSRLS runtime role deliberately cannot do. The
# running application never uses this connection.
#
# `prisma migrate deploy` applies only migrations that exist in the repository
# and never generates one, so this cannot invent a schema change on a customer's
# database.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker
require_env_file

log "waiting for the database to accept connections"
for _ in $(seq 1 60); do
  if compose exec -T db pg_isready -U postgres -d "$(env_value POSTGRES_DB || echo verity)" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Never migrate from a stale tools image: it must carry exactly the migrations this checkout has.
EXPECTED="$(find "${REPO_DIR}/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
IN_IMAGE="$(compose --profile tools run --rm --entrypoint "" tools sh -c 'find /app/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l' | tr -d ' \r')"
[ "${EXPECTED}" = "${IN_IMAGE}" ] || die "the tools image has ${IN_IMAGE} migrations but this checkout has ${EXPECTED}; rebuild it (compose --profile tools build tools) and rerun"

log "applying migrations"
compose --profile tools run --rm --entrypoint "" tools npx prisma migrate deploy

log "migrations applied"
