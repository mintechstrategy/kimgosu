# 회원 API v0.3 — 서버 정책 metadata (KG-BACKEND-POLICY-METADATA-01)

상태: **로컬 기술 후보, 미배포, 정책효력 없음**. 기준은 `MEMBERSHIP-SERVICE-POLICY.md v0.3 DRAFT_NOT_EFFECTIVE`와 기존 v0.2 집행 규칙이다. v0.1/v0.2 원문·클라이언트·DB schema는 변경하지 않았다.

## 호환 사용법
- 기존 GET `/v1/auth/config`, `/v1/policies`, `/v1/policies/:kind?version=...`에 `metadata=policy-v0.3`을 **명시한 경우에만** additive `policySnapshot`을 반환한다. 기존 요청은 동일 v0.2 응답/선택/거절을 유지한다. 지원 여부는 `schemaVersion`과 필수 metadata 존재로 확인하고 조용히 legacy 의미로 fallback하지 않는다.
- snapshot 안에 전체 공개 문서 전문과 hash, ID, current 대상/필수 set/서버 시각이 함께 있다. 통합 소비자는 별도 config/list/detail 응답을 맞추기보다 이 **단일 응답의 snapshot**을 사용한다. 분리 요청은 revision이 다르면 폐기·재조회한다.
- opted-in config의 기존 `documents`와 기본 detail은 **기존 grant 정본 current ID**를 사용한다. 없으면 기존 display 후보를 열람만 시킨다. currentDocuments는 5종 고정 slot이며 currentDocument가 null이면 동의 대상을 임의 선택하지 않는다. DRAFTonly도 읽을 수 있으나 current가 되지 않는다. 특정 version 전문은 과거 READY/RETIRED도 열람 가능하다.
- row `canConsent`는 기존 READY/승인/시행/operator 조건의 **개별 문서 적격성**이고 `isCurrent`는 최종 grant 대상이다. 과거 READY가 canConsent=true여도 최신 동의 대상으로 추론하지 않는다.
- 가입 및 `/v1/me/consents` POST에 optional `expectedPolicyRevision`을 추가한다. v0.3 소비자는 사용자 재확인 후 snapshot revision을 그대로 보낸다. 미제공 legacy 흐름은 동일 집행이다. revision 형식은 `ps3-`+64자리 lowercase SHA256이다. revision은 권한/token/멱등키가 아니다.

## 판정 정본과 정합성
`policy.ts.currentDocumentsSelect`는 원래 auth.ts 최종 집행 SQL을 그대로 추출했다: READY, approved_at not null, effective_at<=DB now(), operator_name not null/PostgreSQL trim 비어있지 않음, kind별 effective_at DESC,id DESC. created_at/문자열 version 정렬로 이를 덮어쓰지 않는다. 기존 display selector는 equal effective_at의 created_at tie 및 operator 적격성에서 다를 수 있어 legacy에만 보존한다. 새 current 권위는 새 사업정책이 아니라 실제 grant 정본 재사용이다.

각 opt-in GET은 **한 SQL statement/MVCC snapshot**에서 전문·current/display flags와 now()를 얻는다. config/list/detail과 revision-bound grant가 같은 SQL selector/metadata builder를 사용한다. grant는 이 한 snapshot의 revision을 비교하고 같은 대상 ID로 기존 필수/중복/버전을 검사한다. 필수 grant는 TERMS+PRIVACY_CONSENT, ready는 이 둘+PRIVACY_POLICY, MARKETING optional, OPERATIONS 의무동의 없음이다. 개인정보처리방침은 grant 입력이 아니다. 닉네임 및 consentInputs의 기존 validation schema 객체를 metadata에 그대로 쓴다. 다른 config 값(14세/필수 이름·email/성별·연령대0/5자리60초/30일/탈퇴부터1년)은 그대로다. 새 권한표는 제공하지 않는다.

`id`는 bigint::text를 opaque string으로 전달하며 숫자로 parse하지 않는다. version도 opaque string이다. bodySha256은 **전문 그대로의 UTF8 바이트** SHA256이며 CRLF/Unicode 정규화/trim을 하지 않는다. 중복 ID/kind-version/current/display, 누락 필수 metadata, hash 손상·현재문서인데 동의불가 등 불정합은503 POLICY_METADATA_UNAVAILABLE로 failclosed한다. 이를 다른 READY나 빈 전문으로 복구하지 않는다. DB constraints의 기존 PostgreSQL trim(기본 space)과 JS Unicode trim을 혼동하지 않는다.

revision은 고정 key순서 JSON UTF8 SHA256: selector 의미 ID + required/optional set + 공유 constraints + opaque ID lexical 정렬 문서 목록(원문/hash/상태/title/operator/effective/approved/created 및 SQL current/display/적격 flags). 조회시각·nonce·배포 release/provider/개인회원상태는 제외한다. 같은 version의 본문변경·대상변경·효력경계의 flags 변화는 revision을 바꾼다. 동일업무상태에서 재조회시각/행순서만 달라지면 유지된다. SQL timestamp는 UTC ISO ms로 정규화되므로 원DB의 sub-ms 시각 자체를 완전 보존한 변경원장이라고 주장하지 않는다. current/display/적격 결과가 바뀌면 포함 flags/ID로 바뀐다.

## 시각·cache·복구
- snapshot.serverTime은 판정에 쓰인 **PostgreSQL transaction now()**다. GET 단일 statement에서는 그 transaction anchor, grant의 기존 transaction 안에서는 transaction 시작시각이다. 응답 전송시각/commit시각 아님. X-Server-Time은 별도 onSend API 시각으로 유지되며 두 anchor를 섞지 않는다. 클라이언트 wall clock으로 canConsent를 뒤집지 않는다.
- Cache-Control:no-store, TTL0. ETag/304/시간기반 재사용 없음. If-None-Match를 보내도 매번 DB조회하여 full200 또는 오류다. revision은 HTTP cache validator가 아니라 내용 비교용이다.
- 화면 진입/복귀/resume/최종 동의확인 직전 명시 재조회. ID/version/hash/revision 변경이면 기존 체크·확인을 폐기하고 새 전문을 확인한다. missing/unknown/503/불일치는 허용 추론하지 않고 재조회 상태다. 동의 버튼을 닫았다는 사실이 서버 거절을 대체하지 않는다. 이 소비 동작은 서버 계약이며 앱/웹 구현은 이번에 변경하지 않았다.
- POLICY_VERSION_CHANGED → 최신 snapshot 조회→사용자 재확인. mutation을 자동 재전송하지 않는다. 응답 유실 시 v0.2와 같은 authenticated consents readback만 가능하고 operation receipt/멱등성/탈퇴 결과복구가 추가된 것은 아니다.

## 확정하지 않은 범위 / 열려 있는 게이트
**commitFence=false**: single statement의 일관성과 동의 transaction commit 시점의 동시 정책쓰기 배제는 다르다. snapshot 이후 정책변경·새문서 삽입을 막는 기존 운영 writer lock/protocol/immutable revision schema가 없어 commit까지 최신임을 증명하지 못한다. 현재 범위에서 임의 schema/격리수준/정책쓰기 규칙을 추가하지 않았다. revision 비교 직전 변경은 거절하지만 직후 변경은 fence하지 못한다. 이를 SQL double로 명시 재현하며 원자적 commit PASS라 하지 않는다. real PostgreSQL MVCC/시간·락/동시정책변경 시험이 다음 gate다.

NOT_IMPLEMENTED: 승인된 material-change 재동의 분류, changedDocuments/allowedActions, 법적 보존종료·삭제/익명화, 운영자/시행일/READY 승격, 정책 editor, 클라이언트 소비/배포, idempotency receipt. 현재 config/signupReady는 provider/SMS 연결도 별도로 검사하며 snapshot 적격성이 가입권한을 보장하지 않는다. 기존 알림OFF≠광고철회/제재/연령/보존/즉시고수 규칙 그대로다.

이 로컬 후보는 새 source/helper를 추가하므로 기존 root `.dockerignore`/Docker COPY allowlist에 **자동 포함되지 않는다**. rootDocker/CI/infra를 이번에 변경하지 않았으며 배포 준비/성공이라고 주장하지 않는다. 다음 배포 소유자가 정확 새 계약/source를 수용한 뒤 명시 packaging gate를 수정·검증해야 한다. 실DB/DDL/실API/provider/원격 배포는 이번 NOT_RUN이며 이전 realPG76을 승계하지 않는다.
