#!/usr/bin/env bash
# Restore rehearsal for a Verity workspace (Stylified MVP acceptance criterion 10: "a backup is taken and a restore is rehearsed").
#
# Takes a custom-format dump of one database, restores it into a fresh scratch database, then proves the restored copy is the same
# business: the same row counts and the same ledger fingerprint for the tenant, the application role still sees only its own tenant
# under row-level security (and nothing with no tenant set), and the photograph bucket mirrors object for object.
#
# Local use (Docker): defaults below match the local demo stack. It never touches the source database beyond reading it, and it drops
# only the scratch database it creates. Do not point it at production.
#
#   bash scripts/restore-rehearsal.sh
#   DB_CONTAINER=... SRC_DB=verity_stylified TENANT_NAME=Stylified S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=stylified-media \
#     AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... bash scripts/restore-rehearsal.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-verity-baseline-db-1}"
SRC_DB="${SRC_DB:-verity_stylified}"
SCRATCH_DB="${SCRATCH_DB:-${SRC_DB}_restore_rehearsal}"
TENANT_NAME="${TENANT_NAME:-Stylified}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_BUCKET="${S3_BUCKET:-}"
PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -At)

start=$(date +%s)
echo "1. dump $SRC_DB"
docker exec "$DB_CONTAINER" pg_dump -U postgres -Fc -f /tmp/rehearsal.dump "$SRC_DB"
size=$(docker exec "$DB_CONTAINER" sh -c 'stat -c %s /tmp/rehearsal.dump')
echo "   dump written: $size bytes"

echo "2. restore into a fresh scratch database $SCRATCH_DB"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" -c "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null
# --no-owner keeps the restore independent of the original owner; grants are re-applied from the dump. Errors are NOT swallowed.
docker exec "$DB_CONTAINER" pg_restore -U postgres --no-owner -d "$SCRATCH_DB" /tmp/rehearsal.dump
restored=$(( $(date +%s) - start ))
echo "   restored in ${restored}s (dump + restore)"

fingerprint() { # database -> one line per fact about the tenant's business
  "${PSQL[@]}" -d "$1" <<SQL
SELECT 'tenant ' || id FROM tenant WHERE name = '$TENANT_NAME';
SELECT 'lots ' || count(*) FROM piecework_lot WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'bundles ' || count(*) FROM piecework_bundle WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'entries ' || count(*) FROM piecework_entry WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'payments ' || count(*) FROM piecework_payment WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'approvals ' || count(*) FROM piecework_approval WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'day_closes ' || count(*) FROM piecework_day_close WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'stored_files ' || count(*) FROM stored_file WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'users ' || count(*) FROM tenant_membership WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
-- A fingerprint of the whole ledger: any lost, changed or reordered row changes it.
SELECT 'ledger_md5 ' || md5(string_agg(id::text || kind || pieces::text || coalesce(good_pieces,0)::text || coalesce(rate_minor,0)::text || entry_date::text, ',' ORDER BY id))
  FROM piecework_entry WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SELECT 'payments_md5 ' || coalesce(md5(string_agg(id::text || kind || amount_minor::text, ',' ORDER BY id)), 'none')
  FROM piecework_payment WHERE tenant_id = (SELECT id FROM tenant WHERE name = '$TENANT_NAME');
SQL
}

echo "3. compare the business in source and restored copy"
fingerprint "$SRC_DB" > /tmp/rehearsal-src.txt
fingerprint "$SCRATCH_DB" > /tmp/rehearsal-restored.txt
if diff /tmp/rehearsal-src.txt /tmp/rehearsal-restored.txt; then
  echo "   identical:"; sed 's/^/     /' /tmp/rehearsal-restored.txt
else
  echo "   MISMATCH between source and restored copy" >&2; exit 1
fi

echo "4. row-level security still holds in the restored copy, as the application role"
tenant_id=$(grep '^tenant ' /tmp/rehearsal-restored.txt | cut -d' ' -f2)
inside=$("${PSQL[@]}" -d "$SCRATCH_DB" -c "BEGIN; SET LOCAL ROLE verity_app; SELECT set_config('verity.tenant_id', '$tenant_id', true); SELECT count(*) FROM piecework_entry; COMMIT;" | grep -E "^[0-9]+$" | tail -1)
none=$("${PSQL[@]}" -d "$SCRATCH_DB" -c "BEGIN; SET LOCAL ROLE verity_app; SELECT count(*) FROM piecework_entry; COMMIT;" | grep -E "^[0-9]+$" | tail -1)
other=$("${PSQL[@]}" -d "$SCRATCH_DB" -c "BEGIN; SET LOCAL ROLE verity_app; SELECT set_config('verity.tenant_id', '00000000-0000-4000-8000-000000000000', true); SELECT count(*) FROM piecework_entry; COMMIT;" | grep -E "^[0-9]+$" | tail -1)
bypass=$("${PSQL[@]}" -d "$SCRATCH_DB" -c "SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'verity_app'")
echo "   own tenant sees $inside entries; no tenant set sees $none; another tenant sees $other; role bypasses RLS: $bypass"
[ "$none" = "0" ] && [ "$other" = "0" ] && [ "$bypass" = "f" ] && [ "$inside" -gt 0 ] || { echo "   RLS CHECK FAILED" >&2; exit 1; }

echo "5. append-only ledgers still refuse an edit in the restored copy"
if "${PSQL[@]}" -d "$SCRATCH_DB" -c "UPDATE piecework_entry SET pieces = pieces + 1 WHERE id = (SELECT id FROM piecework_entry LIMIT 1)" >/dev/null 2>&1; then
  echo "   APPEND-ONLY TRIGGER MISSING after restore" >&2; exit 1
else
  echo "   refused, as designed"
fi

if [ -n "$S3_ENDPOINT" ] && [ -n "$S3_BUCKET" ]; then
  echo "6. photographs: mirror bucket $S3_BUCKET object for object (a database restore does not include them)"
  aws_cli=(docker run --rm --network host -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -v "${TMPDIR:-/tmp}:/work" amazon/aws-cli --endpoint-url "$S3_ENDPOINT" --region us-east-1)
  "${aws_cli[@]}" s3 mb "s3://${S3_BUCKET}-restore-rehearsal" >/dev/null 2>&1 || true
  "${aws_cli[@]}" s3 sync "s3://$S3_BUCKET" "s3://${S3_BUCKET}-restore-rehearsal" --only-show-errors
  a=$("${aws_cli[@]}" s3 ls "s3://$S3_BUCKET" --recursive | wc -l)
  b=$("${aws_cli[@]}" s3 ls "s3://${S3_BUCKET}-restore-rehearsal" --recursive | wc -l)
  echo "   source $a objects, mirror $b objects"
  [ "$a" = "$b" ] || { echo "   BUCKET MIRROR MISMATCH" >&2; exit 1; }
  "${aws_cli[@]}" s3 rb "s3://${S3_BUCKET}-restore-rehearsal" --force >/dev/null
fi

echo "7. clean up the scratch database"
"${PSQL[@]}" -d postgres -c "DROP DATABASE \"$SCRATCH_DB\"" >/dev/null
docker exec "$DB_CONTAINER" rm -f /tmp/rehearsal.dump
echo "RESTORE REHEARSAL PASSED in $(( $(date +%s) - start ))s"
