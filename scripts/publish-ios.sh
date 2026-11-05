#!/usr/bin/env bash
# iOS 릴리스 레코드를 준비하고 dry-run으로 출력한다. 게시(--deploy)는 하지 않는다.
# 실제 게시는 승인 후 사람이 마지막 줄에 출력된 publish_release.py 명령으로 실행한다.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BOARD=$ROOT/apps/download-board
INFO_PLIST=$ROOT/apps/ios/Kimgosu/Info.plist
PLATFORM=ios

usage() {
  cat <<'EOF'
사용법: scripts/publish-ios.sh --artifact <zip|ipa> --candidate <id> \
  --qa-result <qa-json> --source-manifest <json> --qa-completed-at <ISO8601+tz> \
  --qa-accepted --note "<사용자에게 보이는 변경 한 줄>" [--note ...] \
  [--installation-notice "<설치 범위 안내>"] [--device-signature-verified] [--out <record.json>]

.zip은 ios-simulator, .ipa는 ios-device-ipa로 등록한다. .ipa는 실제 서명 검증
(--device-signature-verified)과 설치 범위 안내(--installation-notice)가 있어야 한다.
버전·빌드는 apps/ios/Kimgosu/Info.plist에서 읽는다.
게시판 현재 버전보다 낮으면 exit 78로 거부한다.
EOF
}

artifact= candidate= qa_result= source_manifest= qa_completed_at= out= qa_accepted=
notice= signature_verified=
notes_json='[]'
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact) artifact=${2:-}; shift 2 || shift ;;
    --candidate) candidate=${2:-}; shift 2 || shift ;;
    --qa-result) qa_result=${2:-}; shift 2 || shift ;;
    --source-manifest) source_manifest=${2:-}; shift 2 || shift ;;
    --qa-completed-at) qa_completed_at=${2:-}; shift 2 || shift ;;
    --installation-notice) notice=${2:-}; shift 2 || shift ;;
    --out) out=${2:-}; shift 2 || shift ;;
    --note) notes_json=$(jq -c --arg n "${2:-}" '. + [$n]' <<<"$notes_json"); shift 2 || shift ;;
    --qa-accepted) qa_accepted=1; shift ;;
    --device-signature-verified) signature_verified=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; usage >&2; exit 64 ;;
  esac
done

die() { echo "거부: $*" >&2; exit 64; }
need() { [ -n "$2" ] || die "--$1 이 필요합니다"; }
absolute() { printf '%s/%s' "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")"; }

need artifact "$artifact"
need candidate "$candidate"
need qa-result "$qa_result"
need source-manifest "$source_manifest"
need qa-completed-at "$qa_completed_at"
[ -n "$qa_accepted" ] || die "--qa-accepted 없이는 레코드를 만들지 않습니다(부모 QA 수용 확인 필요)"
jq -e 'length > 0 and all(.[]; type == "string" and (gsub("\\s"; "") | length) > 0)' <<<"$notes_json" >/dev/null \
  || die "--note를 한 개 이상 넣으세요"

[ -f "$artifact" ] || die "아티팩트가 없습니다: $artifact"
case "${artifact##*.}" in
  zip) KIND=ios-simulator ;;
  ipa) KIND=ios-device-ipa ;;
  *) die ".zip(시뮬레이터) 또는 .ipa(실기기 서명)만 됩니다: $artifact" ;;
esac
if [ "$KIND" = ios-device-ipa ]; then
  [ -n "$signature_verified" ] || die ".ipa는 --device-signature-verified(실제 서명 검증)가 필요합니다"
  need installation-notice "$notice"
fi
[ -f "$qa_result" ] || die "QA 결과 파일이 없습니다: $qa_result"
[ -f "$source_manifest" ] || die "소스 매니페스트가 없습니다: $source_manifest"
[ -f "$INFO_PLIST" ] || die "Info.plist가 없습니다: $INFO_PLIST"

artifact=$(absolute "$artifact")
qa_result=$(absolute "$qa_result")
source_manifest=$(absolute "$source_manifest")

version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST")
built_at=$(date -r "$artifact" +%Y-%m-%dT%H:%M:%S%z | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')

compare_version() { # $1 vs $2 → -1 / 0 / 1 (숫자 3자리, 접미사 무시)
  local IFS=. i ai bi
  local -a a b
  read -r -a a <<<"${1%%-*}"
  read -r -a b <<<"${2%%-*}"
  for i in 0 1 2; do
    ai=$((10#${a[i]:-0})); bi=$((10#${b[i]:-0}))
    if [ "$ai" -lt "$bi" ]; then echo -1; return 0; fi
    if [ "$ai" -gt "$bi" ]; then echo 1; return 0; fi
  done
  echo 0
}

board_version= board_build=
while read -r v b; do
  [ -n "$v" ] || continue
  if [ -z "$board_version" ]; then board_version=$v; board_build=$b; continue; fi
  cmp=$(compare_version "$v" "$board_version")
  if [ "$cmp" = 1 ] || { [ "$cmp" = 0 ] && [ "${b:-0}" -gt "${board_build:-0}" ]; }; then
    board_version=$v; board_build=$b
  fi
done < <(jq -r '.releases[] | select(.platform == "'"$PLATFORM"'" and .status == "published") | "\(.version) \(.build)"' "$BOARD/site/releases.json")

if [ -n "$board_version" ]; then
  cmp=$(compare_version "$version" "$board_version")
  if [ "$cmp" = -1 ] || { [ "$cmp" = 0 ] && [ "$((10#$build))" -lt "$((10#${board_build:-0}))" ]; }; then
    echo "거부: 게시판 현재 ${board_version} b${board_build} 보다 낮은 ${version} b${build} (역행 게시 금지)" >&2
    exit 78
  fi
fi

sha=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
qa_sha=$(shasum -a 256 "$qa_result" | cut -d' ' -f1)
source_sha=$(shasum -a 256 "$source_manifest" | cut -d' ' -f1)

record=$(jq -n \
  --arg candidate "$candidate" \
  --arg qa_completed_at "$qa_completed_at" \
  --arg built_at "$built_at" \
  --arg artifact "$artifact" \
  --arg artifact_sha "$sha" \
  --arg platform "$PLATFORM" \
  --arg kind "$KIND" \
  --arg version "$version" \
  --arg build "$build" \
  --argjson notes "$notes_json" \
  --arg qa_path "$qa_result" --arg qa_sha "$qa_sha" \
  --arg source_path "$source_manifest" --arg source_sha "$source_sha" \
  '{stage:"post-qa-final",qaAccepted:true,candidate:$candidate,qaCompletedAt:$qa_completed_at,
    builtAt:$built_at,artifact:$artifact,artifactSHA256:$artifact_sha,platform:$platform,kind:$kind,
    version:$version,build:$build,notes:$notes,
    qaResult:{path:$qa_path,sha256:$qa_sha},sourceManifest:{path:$source_path,sha256:$source_sha}}')
if [ "$KIND" = ios-device-ipa ]; then
  record=$(jq --arg n "$notice" '. + {deviceSignatureVerified:true,installationNotice:$n}' <<<"$record")
fi

out=${out:-$ROOT/records/publish/ios-$version-b$build.release-record.json}
mkdir -p "$(dirname "$out")"
printf '%s\n' "$record" > "$out"

echo "DRY-RUN — 게시하지 않았습니다. site/·원격은 변경되지 않았습니다."
if [ -n "$board_version" ]; then echo "게시판 현재: ${board_version} b${board_build} / 이번 레코드: ${version} b${build}"; else echo "게시판 현재: iOS 게시 없음 / 이번 레코드: ${version} b${build}"; fi
echo "레코드: $out"
printf '%s\n' "$record" | jq .
echo "승인 후 사람이 실행: python3 apps/download-board/publish_release.py --release-record $out --deploy"
