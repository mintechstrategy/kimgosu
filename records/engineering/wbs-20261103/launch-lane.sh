#!/bin/bash
# 레인 1개 실행: launch-lane.sh <LANE> <PROFILE> [extra instruction]
# - 작업트리가 없으면 만든다(호출 측에서 순차 생성).
# - 에이전트는 작업트리 안에서 실행되고, 결과는 records/engineering/wbs-20261103/<LANE>/RESULT.json.
set -uo pipefail

LANE="${1:?lane required}"
PROFILE="${2:?profile required}"
EXTRA="${3:-}"
BASE_REPO="/Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu-ci"
WT="/Users/mintech-mac/hermes/dev-profile/shared/projects/wt-${LANE}"
LOG_DIR="$BASE_REPO/records/engineering/wbs-20261103/logs"
mkdir -p "$LOG_DIR"

if [ ! -d "$WT" ]; then
  echo "worktree missing for $LANE" >&2
  exit 2
fi

PROMPT="너는 김고수 개발 레인 ${LANE} 담당이다. 작업 디렉터리는 ${WT} 이다.
먼저 ${WT}/records/engineering/wbs-20261103/PLAN-LANES.md 와 WBS.md 를 읽고, 너의 레인(${LANE}) 섹션만 수행한다.
하드 룰을 반드시 지킨다: 자기 소유 경로만 수정, app.ts 수정 금지, git commit/push 금지, 배정된 마이그레이션 번호만 사용, 프론트 로컬 DB 금지, 비밀값 출력 금지.
검증은 실제로 실행하고 결과를 남긴다(tsc, 단위, 실 PostgreSQL 통합은 직렬 실행). 실행하지 않은 검증은 NOT_RUN.
작업이 끝나면 ${WT}/records/engineering/wbs-20261103/${LANE}/RESULT.json 을 PLAN-LANES.md 의 스키마대로 작성한다.
${EXTRA}"

cd "$WT" || exit 2
HERMES_HOME="/Users/mintech-mac/.hermes/profiles/${PROFILE}" \
  hermes -p "$PROFILE" chat -q "$PROMPT" \
  > "$LOG_DIR/${LANE}.log" 2>&1
echo "lane ${LANE} exit=$?" >> "$LOG_DIR/runner.log"
