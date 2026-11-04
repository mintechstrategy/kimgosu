#!/bin/bash
# 3레인 웨이브 러너 (동시 한도 3)
set -uo pipefail
DIR="/Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu-ci/records/engineering/wbs-20261103"
LOG="$DIR/logs"
mkdir -p "$LOG"
: > "$LOG/runner.log"

for pair in "L01 kg-01" "L07 kg-07" "L08 kg-08"; do
  set -- $pair
  "$DIR/launch-lane.sh" "$1" "$2" &
  echo "started $1 on $2" >> "$LOG/runner.log"
  sleep 2
done
wait
echo "wave finished $(date '+%F %T')" >> "$LOG/runner.log"
