#!/bin/bash
# Wave A 러너 — 10개 레인을 각자 프로필/작업트리에서 병행 실행한다.
# 결과 파일이 완료 신호다. 러너 stdout은 완료 증거가 아니다.
set -uo pipefail
DIR="/Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu-ci/records/engineering/wbs-20261103"
LOG="$DIR/logs"
mkdir -p "$LOG"
: > "$LOG/runner.log"

declare -a LANES=(L01 L02 L03 L04 L05 L06 L07 L08 L09 L10)
declare -a PROFILES=(kg-01 kg-02 kg-03 kg-04 kg-05 kg-06 kg-07 kg-08 kg-09 uiux-sub)

for i in "${!LANES[@]}"; do
  "$DIR/launch-lane.sh" "${LANES[$i]}" "${PROFILES[$i]}" &
  echo "started ${LANES[$i]} on ${PROFILES[$i]}" >> "$LOG/runner.log"
  sleep 2
done
wait
echo "wave finished $(date '+%F %T')" >> "$LOG/runner.log"
