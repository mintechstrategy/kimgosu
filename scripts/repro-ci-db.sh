#!/bin/bash
# CI 실패 재현: 실제 PostgreSQL 통합 스위트를 로컬 DB에서 돌린다.
set -u
PGBIN=/Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu/.local-toolchains/postgresql-18.6/install/bin
export PATH="$PGBIN:$PATH"
HOST=127.0.0.1; PORT=55432; USER=postgres; DB=kg_local_ci
cd /Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu-ci

echo "== DB 재생성 =="
psql -h $HOST -p $PORT -U $USER -d postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" 2>&1 | tail -2

echo "== 마이그레이션 적용 =="
for f in services/backend/migrations/0*.sql; do
  psql -h $HOST -p $PORT -U $USER -d $DB -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>/tmp/mig.err || {
    echo "FAILED: $f"; tail -3 /tmp/mig.err; }
done
echo "적용 파일: $(ls services/backend/migrations/0*.sql | wc -l | tr -d ' ')개"

echo "== 통합 스위트 =="
cd services/backend
KG_TEST_DATABASE_URL="postgres://$USER@$HOST:$PORT/$DB" npm run test:integration > /tmp/integ.log 2>&1
echo "exit=$?"
grep -E "^# (tests|pass|fail)|not ok" /tmp/integ.log | head -20
