# KG-AUTH-INTERFACE v0.2 — 신규회원 API 기술 정본

작업 `KG-AUTH-INTEGRATION-02`, 개발 소유 project-lead 위임 통합 담당. 대응 QA `KG-AUTH-INTEGRATION-02-QA`, 담당 uiux, 다음 회수 부모. **로컬 계약·백엔드 metadata 후보이며 배포/정식 가입/실제 UIX QA 완료가 아니다.** 정책 정본은 `product/MEMBERSHIP-SERVICE-POLICY.md` v0.3이고 그대로 불변이다.

## 1. 읽는 순서와 호환

- 기계 정본: `auth-membership.v0.2.json`. `schemaDefinitions` + 각 `operations[].requestSchema/responses/errors/errorMetadata`를 함께 읽는다. JSON Schema draft07, Unicode regexp, 성공 응답의 미지 추가 필드는 무시한다. 요청 스키마의 추가 필드는 거부한다.
- 기존 `auth-membership.v0.1.json`의 bytes와 core9 선언은 변경하지 않았다. v0.2의 `compatibility.core9PreservedVerbatim`은 그 선언의 정확한 사본이다. `GET /v1/policies/:kind?version=optional`은 실제 path `/v1/policies/:kind` + optional query `version`으로 분해했을 뿐 URL 변경이 아니다.
- core9와 확장12 = 21개 제품 route. OPTIONS는 CORS 보조다. 기존 v1 base URL 유지, v2 prefix 추가 없음. 현재 공개 diagnostic API는 이 후보가 아니며 성능시험 종료·복원 readback·부모 승인 전 source root/image/환경/세션/배포/push를 변경하지 않는다.
- `error.code`는 그대로 유지하고 SMS/rejoin의 한정된 시각 metadata만 추가했다. `Retry-After`는 상대 초, body `retryAfter`는 절대 UTC 문자열이다. 일반 throttle `AUTH_RATE_LIMITED`는 기존 `Retry-After:60`이며 SMS 개별 deadline과 다르다.

## 2. 확장 호출 순서

| 기능 | 확정 method/path | 클라이언트 의무 |
|---|---|---|
| 소셜 시작 | POST `/v1/auth/social/start` | 기기/탭에서 verifier 생성·보호, S256 challenge만 전송. provider 선택/state/pending flow 결합 |
| 기존 회원 소셜 추가 | POST `/v1/me/social/link/start` | 현재 Bearer, `confirmed:true`, 실제 소유 확인; complete에도 같은 회원 Bearer |
| 공급자 완료 | POST `/v1/auth/social/complete` | provider/state/code/codeVerifier; AUTHENTICATED/REGISTRATION_REQUIRED/LINKED를 구분. 실패 후 consumed state를 재사용하지 않음 |
| 문자 발송 | POST `/v1/auth/sms/send` | registrationTicket+010/11자리. challengeId/serverTime/expiresAt/retryAfter 저장; code 응답 없음 |
| 문자 검증 | POST `/v1/auth/sms/verify` | ticket+challengeId+ASCII5자리. 실패는 의도적으로 INVALID_OR_EXPIRED 통합, 성공 재전송도 오류이므로 자동 retry 금지 |
| 신규/재가입 | POST `/v1/auth/signup` | name/email/age14Confirmed/expertRequested/정확 kind+version; 서버 검증·신규 채번. 재가입 별도 공개 조회 없음 |
| 갱신 | POST `/v1/auth/refresh` | refresh 단회 회전. 중복·timeout 자동 재전송 금지, 불확실하면 새 소셜 인증 |
| 동의 저장 | POST `/v1/me/consents` | 현재 문서의 필수2종+선택 MARKETING, 중복 kind 금지; 조회 후 버전 확인 |
| 마케팅 철회 | POST `/v1/me/consents/withdraw` | MARKETING만 성공. 필수종류는409 WITHDRAWAL_CONFIRMATION_REQUIRED |
| 탈퇴 확정 | POST `/v1/me/withdraw` | **confirmed:true만**. 추가 reason/detail/memberId 거부. 명시적 최종 확인 후 호출 |
| 닉네임 변경 | PATCH `/v1/me/profile` | nickname 문자·숫자 Unicode1~10자, GET /me exact readback |
| 고수 신청 | POST `/v1/me/expert` | requested:true. 서버 필수정보/회원상태/유효제재/현재 필수동의 검증 후 즉시활성 |

정확 JSON/길이/정규식/성공 union/오류 HTTP 코드는 기계 정본에만 유지한다. 웹 인계에 있던 `/signup/attempts`, `/social/:provider/start`, `/withdrawal-preview`, `/withdrawal`, `/rejoin-eligibility`, `/social-links/verify` 등의 예시 URI는 채택하지 않았다. 새 surface 없이 실제 backend12로 통일한다. App/Web source는 동결 상태이며 이 계약으로 이미 확장 기능을 구현했다고 주장하지 않는다.

## 3. 서버 시간·CORS

- SMS success의 `serverTime/expiresAt/retryAfter`는 같은 PostgreSQL transaction `now()`와 저장된 expiry에서 만든 UTC ISO8601이다. rate429도 DB에서 계산한 실제 rolling-window deadline과 상대 `retryAfterSeconds`를 준다. rejoin409는 검증된 가입 ticket/동일 principal 맥락의 최장 미경과 `rejoinAfter/serverTime`만 반환한다. 다른 principal의 과거 전화 정보는 `IDENTITY_RECOVERY_REQUIRED`로 차단하고 시각/번호/제재 내역을 노출하지 않는다.
- challenge countdown: `max(0, deadline-serverTime-(continuousMonotonicNow-requestStart))`. 전체 request 경과를 빼는 보수적 규약이므로 lock/발송/전송 지연으로 유효시간을 늘리지 않는다. 표시 숫자는 내림, 내부는 ms. 앱 wall clock을 더하거나 60초를 response 도착부터 새로 시작하지 않는다. 수면 포함 연속 monotonic이 없거나 process 복원으로 anchor를 잃으면 검증 UI를 무효화하고 명시적 재발송을 요구한다.
- `X-Server-Time`은 API onSend 시각이고 DB transaction 시각과 다른 anchor다. 두 시간을 섞지 않는다. 재가입 날짜 표시는 안내일 뿐 서버 authorization을 대체하지 않는다. 서버 verify/rejoin predicate가 최종 판단한다.
- 실제 웹 `apps/web/src/api.ts`는 `Cache-Control:no-store` 요청 헤더를 직접 전송한다. 요청 Cache-Control은 CORS safelist가 아니므로 preflight allowlist에 추가했다. `credentials:omit`, 정확 dev origin만 기본 허용하고 로컬은 `KG_CORS_LOCAL_ORIGINS` 명시 설정 후에만 허용한다. 현재 환경은 변경하지 않았다.
- allowed request headers Authorization/Content-Type/Cache-Control, methods GET/POST/PATCH/OPTIONS, exposed Date/Retry-After/X-Server-Time, Vary:Origin. wildcard/null/운영 origin/credentials cookie는 금지. 허용 origin의 rate429를 포함한 오류에도 ACAO가 먼저 설정된다. 자체 inject 검증이며 원격 edge/CORS가 고쳐졌다는 의미가 아니다.

## 4. 닉네임·탈퇴사유 차이 처리

**닉네임은 signup input에 넣지 않고 기존 profile PATCH 후속 확인을 채택한다.** 원본 extracted-text 43:701과 정책 B03/MP03은 가입 시 자동생성, 수정10자를 정한다. UIX HANDOFF는 빈 수정값은 수정 안 함이라고 명시한다. 자동생성을 대체하는 optional signup 필드를 추가하는 것보다 기존 route를 사용하는 것이 최소 호환안이다.

후속 App/Web 담당: 입력한 비어 있지 않은 닉네임을 pending 변경 intent로 보존하고, signup 성공 후 `/me`에서 서버 자동 닉네임/회원상태를 확인 → 별도 변경임을 명시적으로 확인 → PATCH → GET exact readback한다. 취소/실패 시 자동 닉네임이 남았다는 사실과 미저장 입력을 표시하고, 가입 완료와 닉네임 수정 완료를 별도로 판정한다. 빈 값이면 PATCH하지 않는다. 현재 동결 UI를 이번 작업에서 변경하지 않았으며 후속 표현은 uiux 확인 대상이다. 입력을 조용히 버리거나 한 번의 signup에 원자적으로 저장됐다고 안내하지 않는다.

**탈퇴 선택사유/상세는 미결정이다.** 새 개인정보 저장 목적·필드·접근/보관/동의 범위를 승인 없이 만들지 않았다. 현재 confirmed-only endpoint는 추가 필드를400으로 거부하며 reason을 저장/폐기한 성공을 반환하지 않는다. 후속 App/Web는 사유를 실제 수집·저장할 수 있다고 표시하면 안 된다. 수집 표면 비활성/후속 디자인 수정 vs 승인된 신규 목적/저장 계약 중 부모 정책·UIX 결정을 받아야 해당 표면을 활성화할 수 있다. 이미 입력된 사유를 조용히 지운 뒤 탈퇴 성공으로 표시하는 우회는 금지한다.

## 5. 중복·불확실 결과와 재동의

| 작업 | 실제 보장 | timeout/중복 후 처리 |
|---|---|---|
| 알림 PATCH | expectedVersion CAS, 충돌409, 숫자 version | GET 최신값 비교 → 명시적 재적용 또는 취소. no auto replay |
| 동의 grant | 정확 문서버전 검증·append event, operation idempotency/expectedVersion 없음 | GET consents + 해당 version 전문/현재 문서 재조회. 정확 kind/version/GRANTED가 목표와 같은지 확인. 다른 변경과 동시였다면 미확정으로 두고 사용자 재확인; 무조건 반복 append 금지 |
| MARKETING 철회 | 최신 grant 철회+광고OFF atomic. 반복하면 preference version 증가 가능 | consents/notifications 둘 다 GET. grant 자체가 없는 경우 WITHDRAWN event가 있다고 발명하지 않음. 광고OFF만으로 철회됐다고 판정 금지 |
| 탈퇴 | member lock·탈퇴확정·전체 세션 폐기·알림OFF transaction. 정상 응답은 server clocks 포함 | 옛 Bearer GET /me200이면 읽은 시점에는 활성,401이면 세션 무효만 입증. **401만으로 탈퇴/확정시각/보관기산을 입증할 수 없음.** outcome UNKNOWN을 표시하고 blind retry/가입 우회 금지. 인증된 상태 재확인/운영 복구 설계는 후속 승인; 새 공개 상태조회 endpoint를 만들지 않음 |
| signup/SMS verify/social complete/refresh | 단회 ticket/challenge/state/refresh, receipt 조회·Idempotency-Key 없음 | 유실 응답을 성공으로 합성하지 않음. refresh replay는 family까지 철회하므로 특히 자동 retry 금지. 다시 소셜 인증이 필요한 상태와 확인 중을 구별 |
| profile PATCH | 현재 동의/제재 확인, last-write-wins, expectedVersion 없음 | GET exact nickname readback; 동시 타기기 변경을 방지했다고 주장하지 않음 |

- TERMS·PRIVACY_CONSENT만 필수 grant, MARKETING 선택. PRIVACY_POLICY는 공개/효력문서 준비 조건이지 체크 동의 종류가 아니다. OPERATIONS는 DRAFT 열람 가능하나 필수 재동의를 임의 부과하지 않는다.
- 실제 source는 profile/expert/link 변경 때 현재 필수2문서의 최신 grant를 요구한다. 누락은409 DOCUMENT_NOT_READY, 이전 버전은403 CONSENT_RENEWAL_REQUIRED. `/me.status`가 재동의 필요를 합성해서 주지 않는다. core notifications는 기존 ACTIVE+마케팅ON guard를 그대로 유지한다.
- **중요 변경 분류·changedDocuments·제한업무 matrix·문서 효력 승인 metadata는 현재 없다.** 이 source의 보수적 current-version guard를 승인된 모든 정책변경 재동의 기준이라고 승격하지 않는다. 승인 분류 없는 새로운 필수종류/범용차단/공개 auth 조회를 추가하지 않았다.

## 6. 서버 authoritative 원칙과 검수 경계

사용자 확정 기본 아키텍처의 상세 정본은 `engineering/BACKEND-AUTHORITY.md` 한 곳이다. 본 계약은 그 원칙의 회원 모듈 구현/제한을 명세한다. 서버가 권한·회원상태·고객번호·유효제재·SMS 검증·효력/버전 동의·30일/1년 기산·CAS의 최종 판정자다. canConsent/verified/status/customerNumber/기산값을 client가 POST하여 권한으로 승격시키지 않으며 서버 session/DB predicate를 다시 확인한다. 가격/거래조건도 같은 원칙이나 해당 도메인은 이번 회원 source에 구현되지 않았고 신규 범위를 추가하지 않았다.

변경 가능한 정책값/제약/허용행동/기한·버전은 서버 설정·구현과 API 응답을 정본으로 소비한다. 현재 config와 policy/member/preference/timing 응답에 있는 metadata와 아직 없는 변경분류/전체 allowed-action/minimum-client protocol은 JSON `businessAuthority`에서 구분했다. core9 호환, 정확 문서버전 충돌·재조회, no-store와 오래된 클라이언트의 서버 재검증을 유지한다. 정상 호환정책은 가급적 서버 설정/배포로 바꾸되 새 UI·OS·callback binding/비호환 API에는 클라이언트 배포가 여전히 필요할 수 있다. 원칙 문서 반영은 기존 전체 코드 준수 판정이 아니고 위반 수정은 별도 승인범위+uiux 회귀 세트다.

정확 source 연결·차이/미결정은 `engineering/auth-integration-02/CONTRACT-DECISIONS.json`의 sourceRefs와 findings를 따른다. 독립 read-only 감사 `engineering/business-logic-audit-01/**`는 다른 담당 소유이며 이 작업에서 수정하지 않는다. 감사자는 `CANDIDATE.json`의 최종 content hash와 비교해야 하며 이전574cee 후보 결과를 새 metadata 후보의 실제 DB 검증으로 소급할 수 없다.

## 7. provider/callback 필수 선행조건 — 현재 미실행

현재 `configuredProviders`는 명시 enabled+client ID/secret+HTTPS dev 웹 호스트 redirect 설정만 받는다. Google adapter만 공급자 단계 S256+nonce를 전송하며 Kakao/Naver에는 이 코드의 client verifier 결합이 있어도 공급자 PKCE가 구현됐다고 말하지 않는다. callback exact URI 등록·client 유형/플랫폼 binding·공급자별 지원은 실제 등록과 공식 spec 대조가 필요하다.

웹: callback code/state/오류의 정상/취소 수신, 단회 pending verifier와 state/provider 결합, query 즉시 제거/no-referrer/분석·서버 URL 로그 방지, 신뢰 origin/opener binding, reload·다중탭·실패 종료를 구현·검증해야 한다. 원시 access/refresh/registrationTicket/codeVerifier를 URL·postMessage wildcard·localStorage에 넣지 않는다. 현재 memory-only 세션은 reload 지속로그인이 없고 XSS로부터 안전하다고 주장하지 않는다. BFF+cookie는 별도 보안설계이지 이번 Bearer 계약에 몰래 추가한 기능이 아니다.

앱: 외부 시스템 인증 세션/브라우저, 검증된 App/Universal Link 또는 승인된 callback scheme·플랫폼/앱ID/서명 binding·단회 pending state+verifier·취소/재진입/중복 callback 차단이 필요하다. 현재 서버는 임의 native redirect/handoff를 제공하지 않으며 Android manifest/iOS associated-domain/provider 앱 등록은 본 작업에서 변경하지 않았다. 안전한 웹→앱 code handoff 또는 native client 등록 방식 결정·실제 검증 전 앱 real OAuth 활성화 금지. client secret을 앱에 내장하거나 SSR/API adapter PASS를 client 완주로 대체하지 않는다.

실 SMS 제공사/발신번호/비용·외부발송 승인과 runtime adapter는 미준비다. READY 문서/사업자·문의/효력일/법무·소셜 보안/삭제정책도 미확정이며 DRAFT를 효력문서로 바꾸지 않았다.

확인 1차 기준(기술 검토 자료, 실제 제공사 성공의 대체 아님): RFC9700 §2.1/4.1(PKCE·redirect), RFC8252 §6/7/8(외부 user-agent·native binding), WHATWG Fetch CORS safelist/preflight/exposed headers. URL·조회 제한은 `SOURCE-REFERENCES.json`에 기록한다.
