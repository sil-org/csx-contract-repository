#!/usr/bin/env bash
# Runs the contract schema + SQL tests against a throwaway local Postgres.
# Usage: supabase/tests/run.sh [path/to/template/supabase/schema.sql]
#   The auth kernel (profiles, linked_accounts, current_profile_id) normally comes
#   from the license-manager / sil-app-template supabase/schema.sql.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
KERNEL="${1:-${AUTH_KERNEL_SQL:-$HERE/../../../sil-app-template/supabase/schema.sql}}"
[ -f "$KERNEL" ] || { echo "auth kernel not found: $KERNEL" >&2; exit 2; }
BIN="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR" 2>/dev/null || true
PGRUN() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
PGRUN "$BIN/initdb -D $DIR/data -A trust >/dev/null"
PGRUN "$BIN/pg_ctl -D $DIR/data -o '-p 54399 -k $DIR -c listen_addresses=' -l $DIR/log -w start >/dev/null"
trap 'PGRUN "$BIN/pg_ctl -D $DIR/data -m immediate stop >/dev/null" || true' EXIT
PSQL="psql -h $DIR -p 54399 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "create database t" 
export PGOPTIONS="-c client_min_messages=warning"
$PSQL -d t -f "$HERE/00_stubs.sql"
$PSQL -d t -f "$KERNEL"
for m in 01_contracts_schema 03_user_search 04_sheet_fields 05_original_exception 06_signatory_and_custom_msa; do   # 02 needs pg_cron/Vault, which only exist on Supabase
  $PSQL -d t -f "$HERE/../contracts/$m.sql"
  $PSQL -d t -f "$HERE/../contracts/$m.sql"          # idempotent re-run
done
for f in "$HERE"/[1-9]*_test.sql; do
  echo "== $(basename "$f")"
  PGOPTIONS="-c client_min_messages=notice" $PSQL -d t -f "$f" 2>&1 \
    | sed -n -e 's/^psql:.*NOTICE:  //p' -e '/ERROR\|FAIL\|CONTEXT\|DETAIL\|HINT/p'
  [ "${PIPESTATUS[0]}" = 0 ] || { echo "TEST FILE FAILED: $f" >&2; exit 1; }
done
echo "ALL SQL TESTS PASSED"
