#!/usr/bin/env bash
# Builds a throwaway database from the migrations and runs the integration checks.
# Usage: DB_URL=postgresql://postgres:postgres@localhost:5432/postgres bash supabase/tests/run_local.sh
set -euo pipefail
DB_URL="${DB_URL:?Set DB_URL to a Postgres you can create databases on}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DB="bme_test_$$"
psql "$DB_URL" -qc "create database $TEST_DB"
trap 'psql "$DB_URL" -qc "drop database if exists $TEST_DB" >/dev/null' EXIT
T="${DB_URL%/*}/$TEST_DB"
P="psql $T -v ON_ERROR_STOP=1 -q"
$P -f "$ROOT/supabase/tests/auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migrate $(basename "$f")"; $P -f "$f"; done
$P -f "$ROOT/supabase/seed.sql"
$P -f "$ROOT/supabase/seed_demo.sql"
$P -f "$ROOT/supabase/tests/integration.sql" | grep -q 'ALL INTEGRATION CHECKS PASSED'
echo "Database tests passed"
