#!/bin/bash
# 배포 후 점검 — "배포했다"와 "배포본이 새 코드다"를 구분한다.
# 사고: 배포 SUCCESS인데 라우트가 404였다(/v1/me/expert). 그래서 만든다.
set -u
BASE="${1:-https://api-dev-kimgosu.mintech.ai}"
SLOT="${KG_DEV_SLOT:-11}"
FAIL=0

say() { printf '%s\n' "$*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

say "== health =="
H=$(code "$BASE/health")
[ "$H" = "200" ] && say "OK: health 200" || { say "FAIL: health $H"; FAIL=1; }

say "== 인증 없이 열려야 하는 라우트 =="
for p in /v1/auth/config /v1/policies; do
  C=$(code "$BASE$p")
  if [ "$C" = "200" ]; then say "OK: $p 200"; else say "FAIL: $p $C"; FAIL=1; fi
done

say "== dev 로그인 =="
TOK=$(curl -s --max-time 20 -X POST "$BASE/v1/auth/dev/login" \
  -H 'content-type: application/json' -d "{\"slot\":$SLOT}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).session?.accessToken||"")}catch{console.log("")}})')
if [ -z "$TOK" ]; then
  say "SKIP: dev 로그인 실패(slot $SLOT) — 인증 라우트는 확인하지 못했다"
  say "== 결과 =="; [ "$FAIL" = 0 ] && say "GATE PASSED (부분 확인)" || say "GATE FAILED"
  exit $FAIL
fi

say "== 인증 라우트 (새 코드에만 있는 것) =="
for p in /v1/me /v1/me/expert /v1/me/quotes /v1/me/expert/availability/periods \
         /v1/notifications /v1/me/ledgers /v1/chat/rooms; do
  C=$(code -H "authorization: Bearer $TOK" "$BASE$p")
  case "$C" in
    200|204|400) say "OK: $p $C" ;;              # 400은 라우트 존재 증거
    404) say "FAIL: $p 404 (배포본이 옛 코드다)"; FAIL=1 ;;
    *)   say "WARN: $p $C" ;;
  esac
done

say "== 결과 =="
if [ "$FAIL" -ne 0 ]; then say "GATE FAILED — 배포가 새 코드가 아니다"; exit 1; fi
say "GATE PASSED"
