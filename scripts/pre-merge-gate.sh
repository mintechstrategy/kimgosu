#!/bin/bash
# 병합 후 푸시 전 게이트 — 오늘 발생한 사고 3종을 자동 검출한다.
#   1. 해결되지 않은 충돌 표시
#   2. Xcode 프로젝트가 가리키는 파일이 실제로 없음
#   3. Xcode 프로젝트 오브젝트 ID 중복
# 실패하면 exit 1. 통과하지 않으면 푸시하지 않는다.
set -u
cd "$(dirname "$0")/.." || exit 2
FAIL=0
say() { printf '%s\n' "$*"; }

# 1) 충돌 표시
say "== 1. 충돌 표시 =="
MARKED=$(grep -rln '^<<<<<<< ' apps services tests contracts scripts 2>/dev/null | grep -v node_modules)
if [ -n "$MARKED" ]; then
  say "FAIL: 해결되지 않은 충돌 표시가 있다"
  printf '  %s\n' $MARKED
  FAIL=1
else
  say "OK: 충돌 표시 없음"
fi

# 2) Xcode 프로젝트 참조 파일 존재
say "== 2. Xcode 참조 파일 존재 =="
PBX=apps/ios/Kimgosu.xcodeproj/project.pbxproj
if [ -f "$PBX" ]; then
  MISSING=$(grep -oE 'path = (Kimgosu|KimgosuUITests)/[^;]+\.swift' "$PBX" \
    | sed 's/^path = //' | sort -u \
    | while read -r rel; do [ -f "apps/ios/$rel" ] || echo "$rel"; done)
  if [ -n "$MISSING" ]; then
    say "FAIL: 프로젝트가 가리키는 파일이 없다"
    printf '  %s\n' $MISSING
    FAIL=1
  else
    say "OK: 참조 파일 전부 존재"
  fi
else
  say "SKIP: pbxproj 없음"
fi

# 3) pbxproj ID 중복
say "== 3. Xcode ID 중복 =="
if [ -f "$PBX" ]; then
  DUPS=$(grep -oE '^\t\t[A-F0-9]{24} = \{isa' "$PBX" | awk '{print $1}' | sort | uniq -d)
  if [ -n "$DUPS" ]; then
    say "FAIL: 같은 ID를 두 번 정의했다 (파일이 조용히 사라진다)"
    printf '  %s\n' $DUPS
    FAIL=1
  else
    say "OK: ID 중복 없음"
  fi
fi

say "== 결과 =="
if [ "$FAIL" -ne 0 ]; then
  say "GATE FAILED — 푸시 금지"
  exit 1
fi
say "GATE PASSED"
