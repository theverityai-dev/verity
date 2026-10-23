#!/usr/bin/env bash
# Local demo environment: DSEW and Stylified side by side, every user with a login you can type.
#
#   bash scripts/demo-env.sh up         start Docker services, create and seed the database, create every login, start the app
#   bash scripts/demo-env.sh up --reset throw the demo database away first and seed both tenants again (about 6 minutes)
#   bash scripts/demo-env.sh logins     print the login table
#   bash scripts/demo-env.sh down       stop the app (the Docker services keep running)
#
# What it makes: one Postgres database (verity_local_demo) holding both demo tenants, one Keycloak realm (dsew) with one login per
# demo user, all with the SAME password, and the application on http://localhost:3000. Sign in there, press "Continue with
# organization sign-in", type a username and the password from the table.
#
# It is local only and refuses anything else: the database URL must point at this machine, and the application is started with every
# Supabase and production variable blank and without the repository's .env files. The password is a throwaway for these local
# logins; it opens nothing outside this computer.
set -euo pipefail
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${DEMO_RUN_DIR:-$ROOT/../verity-demo-run}"
# Kept outside RUN_DIR: the copy step mirrors the repository over RUN_DIR and would delete anything else in it.
STATE_DIR="${DEMO_STATE_DIR:-$ROOT/../.demo-env}"
mkdir -p "$STATE_DIR"
PORT="${DEMO_PORT:-3000}"
DB="${DEMO_DB:-verity_local_demo}"
PASSWORD="${DEMO_PASSWORD:-Demo-1234}"
PG=verity-baseline-db-1
KC=verity-dsew-kc
S3C=sty-minio
BUCKET=stylified-media

# username | first name | last name | email | tenant | role | what this login is for
USERS=(
  "dsew-owner|DS|Owner|dsew-owner@dsew.demo|D & S Electric Works|Owner|Everything: jobs, quotes, production, stock, accounting, HR, documents, reports"
  "dsew-supervisor|DS|Supervisor|dsew-supervisor@dsew.demo|D & S Electric Works|Supervisor|The shop floor plus manufacturing orders, routes, bills of materials and batches. No money, jobs or customers"
  "dsew-worker|DS|Worker|dsew-worker@dsew.demo|D & S Electric Works|Floor worker|Shop floor stages only (winding), built for a phone"
  "stylified-owner|Stylified|Owner|stylified-owner@stylified.demo|Stylified|Owner|Everything: dashboard, approvals above the manager limit, team and limits, wages"
  "stylified-manager|Stylified|Manager|stylified-manager@stylified.demo|Stylified|Manager|Approvals inbox within the owner's limits; lots, karigars, wages"
  "stylified-supervisor-a|Stylified|Supervisor A|stylified-supervisor-a@stylified.demo|Stylified|Supervisor|Floor screens at Collar and Stitching; no money anywhere"
  "stylified-supervisor-b|Stylified|Supervisor B|stylified-supervisor-b@stylified.demo|Stylified|Supervisor|Floor screens at Pasting, Kaj and Finishing; has a closed day with a Hindi note"
  "stylified-munshi|Stylified|Munshi|stylified-munshi@stylified.demo|Stylified|Munshi|Daily entry in Hindi or English, lots, bundles, karigars, wages"
)

die() { echo "demo-env: $*" >&2; exit 1; }
say() { echo "==> $*"; }
pg() { docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -At "$@"; }

print_logins() {
  echo
  echo "Open http://localhost:$PORT, press \"Continue with organization sign-in\", then type:"
  echo "  password for every login: $PASSWORD"
  echo
  printf '  %-24s %-20s %-14s %s\n' "USERNAME" "TENANT" "ROLE" "WHAT IT SEES"
  local spec u f l e t r d
  for spec in "${USERS[@]}"; do
    IFS='|' read -r u f l e t r d <<<"$spec"
    printf '  %-24s %-20s %-14s %s\n' "$u" "$t" "$r" "$d"
  done
  echo
  echo "  The email of each login also works as the username (for example dsew-owner@dsew.demo)."
  echo
}

port_pids() { netstat -ano | grep -E "[:.]$PORT[[:space:]].*LISTENING" | awk '{print $NF}' | tr -d '' | sort -u; }

stop_app() {
  local pid
  for pid in $(port_pids); do taskkill /PID "$pid" /T /F >/dev/null 2>&1 || true; done
  rm -f "$STATE_DIR/app.marker" 2>/dev/null || true
}

cmd="${1:-up}"
shift || true
RESET=0
for a in "$@"; do [ "$a" = "--reset" ] && RESET=1; done

case "$cmd" in
  logins) print_logins; exit 0 ;;
  down) stop_app; say "app stopped"; exit 0 ;;
  reset) cmd=up; RESET=1 ;;
  up) ;;
  *) die "usage: demo-env.sh up [--reset] | logins | down" ;;
esac

# ---- 1. Docker services ------------------------------------------------------------------------------------------------------
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop and run this again."
for c in "$PG" "$KC" "$S3C"; do docker start "$c" >/dev/null 2>&1 || true; done
say "waiting for Postgres"
for _ in $(seq 1 40); do docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 || die "Postgres container $PG is not up"
say "waiting for Keycloak"
for _ in $(seq 1 60); do curl -sf "http://localhost:8080/realms/dsew" >/dev/null 2>&1 && break; sleep 3; done
curl -sf "http://localhost:8080/realms/dsew" >/dev/null 2>&1 || die "Keycloak realm dsew is not reachable on :8080"

# ---- 2. The database: one for both tenants, local only ---------------------------------------------------------------------------
url() { grep -o "^$1=.*" "$ROOT/.env.test" | head -1 | cut -d= -f2- | tr -d '"' | sed "s#/verity\$#/$DB#"; }
DIRECT_URL="$(url DIRECT_URL)"
DATABASE_URL="$(url DATABASE_URL)"
case "$DIRECT_URL$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) die "the database URL from .env.test is not local; refusing to continue" ;;
esac
case "$DIRECT_URL" in *"/$DB") ;; *) die "could not point the database URL at $DB" ;; esac

if [ "$RESET" = 1 ]; then
  say "resetting: dropping $DB"
  stop_app
  pg -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null
fi
if [ -z "$(pg -d postgres -c "select 1 from pg_database where datname='$DB'")" ]; then
  say "creating $DB"
  if [ -n "$(pg -d postgres -c "select 1 from pg_database where datname='verity_clean'")" ]; then
    pg -d postgres -c "CREATE DATABASE \"$DB\" TEMPLATE verity_clean" >/dev/null
  else
    pg -d postgres -c "CREATE DATABASE \"$DB\"" >/dev/null
  fi
fi
say "applying migrations"
(cd "$ROOT" && env DIRECT_URL="$DIRECT_URL" DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy 2>&1 | tail -2)

# ---- 3. One login per user, one password ----------------------------------------------------------------------------------------
say "creating the logins in Keycloak"
KC_ARGS=()
for spec in "${USERS[@]}"; do IFS='|' read -r u f l e _ <<<"$spec"; KC_ARGS+=("$u|$f|$l|$e"); done
declare -A SUB
while read -r u id; do [ -n "${id:-}" ] && SUB["$u"]="$id"; done < <(docker exec -i "$KC" bash -s -- "$PASSWORD" "${KC_ARGS[@]}" <<'REMOTE'
set -e
K=/opt/keycloak/bin/kcadm.sh
PW="$1"; shift
$K config credentials --server http://localhost:8080 --realm master --user admin --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1
find_id() { $K get users -r dsew -q username="$1" -q exact=true --fields id --format csv --noquotes 2>/dev/null | head -1; }
for spec in "$@"; do
  IFS='|' read -r u f l e <<<"$spec"
  id="$(find_id "$u")"
  if [ -z "$id" ]; then
    $K create users -r dsew -s username="$u" -s enabled=true -s emailVerified=true -s email="$e" -s firstName="$f" -s lastName="$l" >/dev/null 2>&1
    id="$(find_id "$u")"
  else
    $K update "users/$id" -r dsew -s enabled=true -s emailVerified=true -s email="$e" -s firstName="$f" -s lastName="$l" >/dev/null 2>&1
  fi
  $K set-password -r dsew --username "$u" --new-password "$PW" >/dev/null 2>&1
  echo "$u $id"
done
REMOTE
)
for spec in "${USERS[@]}"; do IFS='|' read -r u _ <<<"$spec"; [ -n "${SUB[$u]:-}" ] || die "no Keycloak login for $u"; done

# ---- 4. Seed both tenants, once ---------------------------------------------------------------------------------------------------
seed() { (cd "$ROOT" && env DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" SUPABASE_URL="" SUPABASE_SERVICE_ROLE_KEY="" "$@"); }
has_tenant() { [ "$(pg -d "$DB" -c "select count(*) from tenant where name='$1'")" != "0" ]; }

if has_tenant "D & S Electric Works"; then
  say "DSEW already seeded"
else
  say "seeding DSEW (about 4 minutes: the platform rate-limits a seed like any client)"
  export DSEW_OWNER_SUB="${SUB[dsew-owner]}" DSEW_SUPERVISOR_SUB="${SUB[dsew-supervisor]}" DSEW_WORKER_SUB="${SUB[dsew-worker]}"
  for s in seed-dsew seed-dsew-roles seed-dsew-people seed-dsew-profile seed-dsew-billing seed-dsew-ledger seed-dsew-hero seed-dsew-passport seed-dsew-documents seed-dsew-crm; do
    say "  $s"
    seed node prisma/run-seed.cjs "$s.ts" > "$STATE_DIR/seed-$s.log" 2>&1 || { tail -15 "$STATE_DIR/seed-$s.log"; die "$s failed (full log: $ROOT/../.demo-env-$s.log)"; }
  done
fi

if has_tenant "Stylified"; then
  say "Stylified already seeded"
else
  say "seeding Stylified (about 1 minute)"
  seed env \
    STYLIFIED_OWNER_SUB="${SUB[stylified-owner]}" STYLIFIED_MANAGER_SUB="${SUB[stylified-manager]}" \
    STYLIFIED_SUPERVISOR_A_SUB="${SUB[stylified-supervisor-a]}" STYLIFIED_SUPERVISOR_B_SUB="${SUB[stylified-supervisor-b]}" \
    STYLIFIED_MUNSHI_SUB="${SUB[stylified-munshi]}" \
    node prisma/run-seed.cjs seed-stylified.ts > "$STATE_DIR/seed-stylified.log" 2>&1 \
    || { tail -15 "$STATE_DIR/seed-stylified.log"; die "seed-stylified failed"; }
fi

# ---- 5. Photographs: a local S3 server and bucket, when the container exists -------------------------------------------------------
S3_ENV=""
if docker ps --format '{{.Names}}' | grep -qx "$S3C"; then
  docker run --rm --network host -e AWS_ACCESS_KEY_ID=styminio -e AWS_SECRET_ACCESS_KEY=styminio-local-secret amazon/aws-cli \
    --endpoint-url http://127.0.0.1:9000 --region us-east-1 s3 mb "s3://$BUCKET" >/dev/null 2>&1 || true
  S3_ENV="1"
else
  echo "   (no $S3C container: photographs will say that file storage is not set up; everything else works)"
fi

# ---- 6. The application ---------------------------------------------------------------------------------------------------------------
say "preparing the application copy in $RUN_DIR"
mkdir -p "$RUN_DIR"
robocopy "$(cygpath -w "$ROOT")" "$(cygpath -w "$RUN_DIR")" /MIR /NFL /NDL /NJH /NJS /NP \
  /XD node_modules .next .git graphify-out clients taskplans verity-bible verity-spec design docs \
  /XF ".env" ".env.*" >/dev/null || true
if [ ! -e "$RUN_DIR/node_modules" ]; then
  powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$(cygpath -w "$RUN_DIR")\\node_modules' -Target '$(cygpath -w "$ROOT")\\node_modules' | Out-Null"
fi
KC_CLIENT_ID="$(docker exec "$KC" bash -c '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1 && /opt/keycloak/bin/kcadm.sh get clients -r dsew -q clientId=verity-web --fields id --format csv --noquotes' | head -1)"
KC_SECRET="$(docker exec "$KC" bash -c "/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password \"\$KC_BOOTSTRAP_ADMIN_PASSWORD\" >/dev/null 2>&1 && /opt/keycloak/bin/kcadm.sh get clients/$KC_CLIENT_ID/client-secret -r dsew --fields value --format csv --noquotes" | head -1)"
[ -n "$KC_SECRET" ] || die "could not read the Keycloak client secret"

export DATABASE_URL DIRECT_URL PORT S3_ENV BUCKET KC_SECRET
app_env() {
  env DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" \
    SUPABASE_URL="" SUPABASE_SERVICE_ROLE_KEY="" NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" \
    VERITY_AUTH_PROVIDER=oidc VERITY_ENVIRONMENT=staging \
    VERITY_OIDC_ISSUER="http://localhost:8080/realms/dsew" VERITY_OIDC_JWKS_URI="http://localhost:8080/realms/dsew/protocol/openid-connect/certs" \
    VERITY_OIDC_CLIENT_ID=verity-web VERITY_OIDC_CLIENT_SECRET="$KC_SECRET" VERITY_OIDC_AUDIENCE=verity-web \
    VERITY_OIDC_PRINCIPAL_CLAIM=sub VERITY_OIDC_EMAIL_CLAIM=email VERITY_OIDC_SCOPES="openid profile email" \
    VERITY_OIDC_REDIRECT_URI="http://localhost:$PORT/api/auth/oidc/callback" VERITY_PUBLIC_URL="http://localhost:$PORT" \
    VERITY_SESSION_SECRET="$(echo local-demo-env-session-secret | sha256sum | cut -c1-48)" \
    ${S3_ENV:+VERITY_STORAGE_DRIVER=s3 VERITY_S3_BUCKET=$BUCKET VERITY_S3_REGION=us-east-1 VERITY_S3_ENDPOINT=http://127.0.0.1:9000 VERITY_S3_ACCESS_KEY_ID=styminio VERITY_S3_SECRET_ACCESS_KEY=styminio-local-secret VERITY_S3_FORCE_PATH_STYLE=true} \
    "$@"
}

if [ ! -f "$RUN_DIR/.next/BUILD_ID" ] || [ -n "$(find "$ROOT/src" "$ROOT/prisma/schema.prisma" "$ROOT/public" -newer "$RUN_DIR/.next/BUILD_ID" -type f 2>/dev/null | head -1)" ]; then
  say "building the application (a few minutes)"
  stop_app
  (cd "$RUN_DIR" && rm -rf .next && app_env npx next build --webpack > "$STATE_DIR/build.log" 2>&1) || { tail -20 "$STATE_DIR/build.log"; die "build failed"; }
fi

if [ -n "$(port_pids)" ] && [ ! -f "$STATE_DIR/app.marker" ]; then
  die "port $PORT is used by something else; stop it or set DEMO_PORT"
fi
stop_app
say "starting the application on http://localhost:$PORT"
touch "$STATE_DIR/app.marker"
(cd "$RUN_DIR" && nohup bash -c "$(declare -f app_env); KC_SECRET='$KC_SECRET' app_env npx next start -p $PORT" > "$STATE_DIR/app.log" 2>&1 &)
code=000
for _ in $(seq 1 45); do
  code="$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" "http://localhost:$PORT/sign-in" || true)"
  case "$code" in 2*|3*) break ;; esac
  sleep 2
done
case "$code" in 2*|3*) ;; *) tail -20 "$STATE_DIR/app.log"; die "the application did not start (last answer: $code)" ;; esac
say "ready"
print_logins
