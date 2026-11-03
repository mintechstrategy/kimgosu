#!/usr/bin/env bash
# Local PostgreSQL for the membership integration test.
#
# Creates a throwaway cluster under the Hermes scratch dir, applies migrations
# 001-004, and leaves it listening on 127.0.0.1:55432. Never touches Railway.
#
#   ./scripts/local-db.sh start     # init (if needed) + start + migrate
#   ./scripts/local-db.sh stop
#   ./scripts/local-db.sh reset     # drop the cluster and rebuild
#   ./scripts/local-db.sh test      # start, then run the integration suite
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGBIN="$ROOT/.local-toolchains/postgresql-18.6/install/bin"
PGDATA="${KG_TEST_PGDATA:-$HOME/.hermes/profiles/develop/cache/scratch/pgdata}"
PGLOG="${PGDATA}.log"
PORT="${KG_TEST_PGPORT:-55432}"
DB="${KG_TEST_PGDATABASE:-kgtest}"
URL="postgres://postgres@127.0.0.1:${PORT}/${DB}"

start() {
  if [ ! -d "$PGDATA" ]; then
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
  fi
  if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$PGLOG" start
    sleep 2
  fi
  "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname='kg_dev_runtime'" | grep -q 1 || \
    "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -c \
      "CREATE ROLE kg_dev_runtime LOGIN PASSWORD 'devonly';"
  "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || \
    "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE DATABASE $DB OWNER postgres;"
  # 004 is not idempotent (plain ADD COLUMN), so only migrate a cluster that has
  # not reached it yet. Use `reset` to rebuild from scratch.
  local migrated
  migrated="$("$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -tAc \
    "SELECT count(*) FROM pg_attribute WHERE attrelid='kg_membership.policy_documents'::regclass AND attname='content_sealed' AND NOT attisdropped" 2>/dev/null || echo 0)"
  if [ "${migrated:-0}" = "0" ]; then
    for f in 001_membership 002_auth_lifecycle 003_explicit_social_link 004_policy_content_integrity; do
      "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q \
        -f "$ROOT/services/backend/migrations/$f.sql"
    done
  else
    echo "schema already at 004; skipping migrations"
  fi
  echo "ready: $URL"
}

stop() { "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast || true; }

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) stop; rm -rf "$PGDATA"; start ;;
  test) start; cd "$ROOT/services/backend" && KG_TEST_DATABASE_URL="$URL" npm run test:integration ;;
  *) echo "usage: $0 {start|stop|reset|test}" >&2; exit 2 ;;
esac
