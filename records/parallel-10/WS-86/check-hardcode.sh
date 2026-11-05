#!/usr/bin/env bash
# 새 기능 파일에 색·크기 리터럴이 없는지 확인한다. 토큰(DesignTokens.*)만 사용해야 한다.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FILES=(
  "$ROOT/apps/android/app/src/main/java/ai/mintech/kimgosu/customer/ReportBlockScreen.kt"
  "$ROOT/apps/ios/Kimgosu/ReportBlockView.swift"
)
PATTERN='Color\(0x|Color\(red:|Color\.white|UIImage|UIColor|cornerRadius: *[0-9]|lineWidth: *[0-9]|\.font\(\.system|[0-9]+\.dp\b|[0-9]+\.sp\b|padding\([0-9]|size\([0-9]|frame\((width|height|minWidth|minHeight|maxWidth|maxHeight): *[0-9]'
hits=$(grep -nE "$PATTERN" "${FILES[@]}")
if [ -n "$hits" ]; then
  echo "FAIL: hardcoded color/size literals"
  echo "$hits"
  exit 1
fi
echo "PASS: 0 hardcoded color/size literals in $(basename "${FILES[0]}") / $(basename "${FILES[1]}")"
