# WBS 레인 실행 계획 (L01–L10)

정본: `records/engineering/wbs-20261103/WBS.md`. 이 파일은 각 레인이 자기 구역만 수행하도록 하는 실행 계약이다.

## 이번 웨이브 (재개 — 2026-11-03 23:xx, 기준 `897e033`)

활성 레인 3개(동시 실행 한도 3):
- **L01** — 릴리스 파이프라인: 19:00 빌드·게시 스크립트 실제 1회 실행 검증(AOS APK 빌드→QA→게시→원격 SHA 재조회), 실패 시 게시 금지. dev API 배포는 이미 반영되어 있으므로 재배포는 필요할 때만.
- **L07** — iOS: 로드맵 02·05·06 잔여 화면(프로필 수정, 고수 전환, 서비스 등록/수정, 견적 제안/응답) 실제 API 연결.
- **L08** — Android: 위와 동일 카드(항상 동시 배정). 같은 API·같은 문구·같은 상태.

대기 레인: L02(백엔드 인증 잔여), L03(백엔드 거래 잔여), L04(원장·미디어·알림), L05(관리자 웹), L06(회원 웹), L09(계약 v0.4), L10(QA·게시판). 슬롯이 비면 순서대로 투입한다.

## 추가 레인 (2026-11-04 추가)

- **L11 — 백엔드 발견·검색·찜 (묶음 04)** — 소유: `services/backend/src/discovery.ts`(신규), 마이그레이션 **032–034**. 지역/분류 기준코드, 서비스 검색·정렬·페이지, 찜·최근검색. 근거: `contracts/screens.v0.4.json`의 PLANNED 오퍼레이션. app.ts 등록은 오케스트레이터가 병합 시 처리.
- **L12 — 백엔드 관리자 운영 API (묶음 12·13·14)** — 소유: `services/backend/src/admin-ops.ts`(신규), 마이그레이션 **035–038**. 관리자 서비스/포트폴리오/CS/감사/지역·분류 조회·조치. L05 관리자 웹의 선행.


## 모든 레인 공통 하드 룰

1. **자기 소유 경로만 쓴다.** 소유 밖 파일은 읽기만 한다. `services/backend/src/app.ts`는 오케스트레이터 전용이므로 절대 수정하지 않는다.
   - **테스트 파일은 각 레인이 소유한다**: 백엔드 레인은 `services/backend/tests/<자기도메인>*.test.ts`(신규 생성·수정)를 쓸 수 있고, 다른 레인의 기존 테스트 파일은 읽기만 한다. 앱 레인은 `apps/ios/Tests/**`, `apps/android/app/src/androidTest/**`를 소유한다. 계약 테스트는 L09 소유다.
2. **git commit / push / PR 금지.** 결과는 작업트리에 남긴다.
3. **마이그레이션 번호는 배정된 범위만** 쓴다(아래 표). 범위 밖 번호를 만들면 실패로 간주되고 되돌린다.
4. **프론트 로컬 DB 저장 금지.** 업무 데이터는 백엔드 API를 통해서만 저장한다.
5. **실행하지 않은 검증은 `NOT_RUN`.** 단위 테스트·mock을 실제 거래 증거로 쓰지 않는다.
6. 비밀값(키·토큰·비밀번호)을 출력·문서·로그에 남기지 않는다.
7. 검증 명령: `cd services/backend && npx tsc --noEmit`, `npm test`, `KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest npm run test:integration` (실행은 **직렬**, 동시 실행 금지).
8. 막히면 `BLOCKED` + `reason` + `unblock`을 쓴다. 추측으로 완료 처리하지 않는다.

## 결과 스키마 (`records/engineering/wbs-20261103/<LANE>/RESULT.json`)

```json
{
  "lane": "L03",
  "status": "DONE|PARTIAL|BLOCKED",
  "summary": "한 문장 요약",
  "reason": "PARTIAL/BLOCKED 사유",
  "unblock": "해제 조건 (BLOCKED일 때)",
  "changedFiles": ["..."],
  "migrations": ["020_..."],
  "integration": { "registrations": ["app.ts에 추가해야 할 import/route 등록 라인"] },
  "verification": [{ "check": "", "command": "", "result": "PASS|FAIL|NOT_RUN", "evidence": "" }],
  "open": ["남은 작업"],
  "risks": ["..."]
}
```

## 레인별 배정

| 레인 | 이번 웨이브 작업 | 소유 경로 | 마이그레이션 |
|---|---|---|---|
| L01 | dev DB 마이그레이션 러너, Railway dev 배포 스크립트, 19시 릴리스 스크립트 | `Dockerfile`, `railway.json`, `.github/**`, `services/backend/scripts/**` | — |
| L02 | WS-12 잔여(READY 전환·가입 readiness), 소셜 로그인 클라이언트 계약 | `src/{auth,policies,register,providers,oauth,apple,session,dev-login}.ts` | 016–019 |
| L03 | 견적 모집기간·마감, 채팅 첨부/미읽음, 리뷰 댓글·신고 | `src/{experts,quotes,ledger,chat,reviews}.ts` | 020–023 |
| L04 | 고객원장(09), 미디어(03), 알림(10) API | `src/{media,regions,notifications,cs,ledger-notes}.ts` 신규 | 024–029 |
| L05 | 관리자 웹: 서비스/포트폴리오/CS/감사 화면 | `apps/web/src/admin/**` | — |
| L06 | 회원 웹: 검색·목록·견적·마이페이지 | `apps/web/src/**` (admin 제외) | — |
| L07 | iOS: 프로필·고수전환·서비스등록 화면 | `apps/ios/**` | — |
| L08 | Android: 동일 화면·동일 API | `apps/android/**` | — |
| L09 | API 계약 v0.4 동결 + 계약 테스트 | `contracts/**`, `apps/mobile-shared/**`, `tests/contract/**` | — |
| L10 | QA 하네스 + 게시판 자동 게시 + 동등성 비교 | `qa/**`, `apps/download-board/**` | 031 |

## iOS/Android 동시성 규칙

L07과 L08은 **항상 같은 카드로 함께 배정**한다. 같은 API·같은 문구·같은 상태(Loading/Empty/Error/Retry)를 구현하고, 한쪽만 끝난 상태로 보고하지 않는다. 화면 차이는 플랫폼 관례 차이만 허용하며 근거를 RESULT에 적는다.

## 사용자 긴급 지시 (6시간 내 테스트) — 2026-11-04

시나리오: ①고수가 이미지 포함 포트폴리오 작성 → ②같은 동네 일반인이 포트폴리오 확인 후 고수에게 채팅 → ③채팅에 파일 업로드.
전제: **이미지 압축은 로컬 폰에서 수행**하고 업로드는 Cloudflare R2로 한다. 압축본만 업로드한다.

- **L13 (백엔드)** — 소유: `services/backend/src/{portfolios,chat}.ts`, `src/media.ts` 수정, 마이그레이션 **038–040**.
  - 고수 본인 포트폴리오 CRUD: `POST /v1/expert/portfolios`, `PATCH/DELETE /v1/expert/portfolios/:id`, `GET /v1/expert/portfolios`(본인), 공개 `GET /v1/experts/:id/portfolios`.
  - 포트폴리오 이미지: media 업로드(complete)된 `mediaId` 목록을 첨부(순서 유지, 최대 5장). 비공개/공개 전환은 서버 판정.
  - 채팅 첨부: `POST /v1/ledgers/:id/messages`에 `attachmentMediaIds` 허용, `GET /v1/media/:id/grants`로 수신자 다운로드 URL 발급. 참여자만.
  - R2 환경변수 별칭: 기존 `R2_PRIVATE_BUCKET`/`R2_ACCOUNT_ID`와 `R2_BUCKET`/`R2_ENDPOINT` 양쪽을 인식. 자격증명 없으면 정직하게 503.
  - 검증: 실 PostgreSQL 통합(업로드 인텐트→complete→포트폴리오 첨부→재조회, 채팅 첨부→수신자 grant, 비참여자 403), 마이그레이션 재실행 안전.
- **L14 (iOS)** — 소유: `apps/ios/**`. 촬영/선택 이미지를 **기기에서 리사이즈(장변 1440px)·JPEG 품질 0.8·EXIF 제거** 후 presigned PUT으로 R2 업로드 → complete → 포트폴리오 저장. 채팅 파일 첨부(이미지/PDF) 동일 경로. 업로드 진행/실패/재시도 상태 포함.
- **L15 (Android)** — 소유: `apps/android/**`. L14와 동일 동작(같은 API·같은 압축 규격·같은 상태). 플랫폼 차이는 근거와 함께 기록.

공통: 앱은 압축본만 업로드하고 원본을 R2에 올리지 않는다. 실패 시 원본을 로컬에 보관하지 않고 재선택을 안내한다.

- **L16 (회원 웹)** — 소유: `apps/web/src/**`(admin 제외). 일반인 시점: 고수 공개 프로필/포트폴리오 이미지 열람 → 고수에게 채팅 시작 → 채팅방에서 파일 업로드/전송 → 상대 수신 확인. 이미지 표시는 원비율 유지, 로딩/빈/오류 상태 포함. 압축은 웹도 클라이언트에서 수행(장변 1440px, JPEG 0.8) 후 업로드.
- **L17 (E2E 하네스)** — 소유: `qa/scenario/**`(신규), `records/engineering/scenario-3steps/**`. 3단계 시나리오(포트폴리오 작성→타인 열람→채팅+파일)를 **dev API 대상으로 실행하는 스크립트**와 증거 저장기. R2 자격증명이 없으면 정직하게 BLOCKED로 기록하고, 자격증명 투입 후 1회 실행으로 통과/실패를 판정한다.

## 웨이브 2 (2026-11-04) — 남은 로드맵 묶음

기준: `wbs/integ` (L13~L16 병합 후). 5레인 동시.

- **L18 (백엔드 잔여)** — 소유: `src/{quotes,notifications,admin-ops,metrics,demo-payment}.ts`, 마이그레이션 **040–043**.
  - 묶음 06: 견적 제안 → 수락/거절 후 채팅 문맥 연결 보강, 마감 후 상태 전이.
  - 묶음 10: 알림 생성 트리거(메시지·견적·리뷰) + 목록/읽음 + 딥링크 대상 권한.
  - 묶음 11: 결제 **시연** API(실결제·PG 호출 없음, 매출/자격 미생성).
  - 묶음 14: 지역/분류 운영 CRUD + 최소 지표 집계(KST 기간, 테스트 계정 제외).
- **L19 (iOS)** — 묶음 04: 지역 설정·검색·목록·정렬·찜 + 빈/오류/재시도. 묶음 10: 알림 목록·읽음.
- **L20 (Android)** — L19와 동일 카드(동일 API·동일 문구·동일 상태).
- **L21 (회원 웹)** — 검색·찜·마이페이지·알림 목록.
- **L22 (QA)** — 양 앱 동등성 하네스: 동일 시나리오를 iOS/Android에서 실행하고 화면·API·DB 결과를 나란히 비교하는 스크립트와 판정 리포트 형식. 독립 QA 아님(자체 QA) 명시.
