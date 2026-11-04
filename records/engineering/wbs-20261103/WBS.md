# 김고수 전체 개발 WBS — 10레인 병행/순차 (2026-11-03)

- 기준 브랜치: `wave3/integration` @ `6715e6c`
- 입력 정본: `records/product/IMPLEMENTATION-ROADMAP.md` (14묶음 / 140뷰), `contracts/auth-membership.v0.3.json`, `records/engineering/BACKEND-AUTHORITY.md`
- 이 문서는 **작업 배분표**다. 완료 실적이 아니다. 완료는 각 레인의 `RESULT.json`과 실제 검증(타입체크·실 PostgreSQL·실기기/시뮬레이터)으로만 판정한다.
- 개발 완료 기준: 모든 기능은 ①백엔드 DB/API(실 PostgreSQL 저장·재조회) → ②iOS·Android 동시 연결 → ③Cloudflare 경유 실제 거래 → ④자체 QA 순서로 검증한다. 프론트 로컬 DB 저장 금지.

## 1. 10개 레인 — 쓰기 소유권 (중복 배정 금지)

| 레인 | 이름 | 쓰기 소유 경로 | 금지(읽기만) | 마이그레이션 예약 |
|---|---|---|---|---|
| L01 | 인프라·배포·CI | `Dockerfile`, `railway.json`, `.github/**`, `services/backend/scripts/**` | `src/**`, `migrations/**` | — |
| L02 | 백엔드 인증·정책 | `services/backend/src/{auth,policies,register,providers,oauth,apple,session,dev-login}.ts` | `app.ts`(통합 전용) | **016–019** |
| L03 | 백엔드 거래 도메인 | `services/backend/src/{experts,quotes,ledger,chat,reviews}.ts` | `app.ts` | **020–023** |
| L04 | 백엔드 미디어·알림·CS | `services/backend/src/{media,regions,notifications,cs}.ts` (신규) | `app.ts` | **024–029** |
| L05 | 관리자 웹 | `apps/web/src/admin/**` | 회원 웹 파일 | — |
| L06 | 회원 웹 | `apps/web/src/**` (admin 제외), `apps/web/index.html` | `admin/**` | — |
| L07 | iOS 앱 | `apps/ios/**` | Android/웹 | — |
| L08 | Android 앱 | `apps/android/**` | iOS/웹 | — |
| L09 | 공통 계약·모바일 공유 | `contracts/**`, `apps/mobile-shared/**`, `tests/contract/**` | 각 앱 UI | — |
| L10 | QA·릴리스·게시판 | `qa/**`, `apps/download-board/**` | 제품 소스 | **031** |

**공유 파일 규칙**: `services/backend/src/app.ts`는 오케스트레이터 전용 통합 파일이다. L02–L04는 자기 모듈만 만들고, 라우트 등록은 `RESULT.json`의 `integration.registrations` 배열로 제출한다. 병합 시 오케스트레이터가 한 번에 반영한다.
**마이그레이션 번호**는 위 예약 범위만 쓴다. 범위를 벗어난 파일 생성은 규칙 위반으로 되돌린다.

## 2. 현재 기준선 (2026-11-03 실측)

| 영역 | 상태 |
|---|---|
| 백엔드 01 회원가입·정책·세션 | 구현·검증됨 (WS-01/02/12 부분), 소셜 OAuth는 kakao/naver/apple 코드 존재 |
| 백엔드 05 고수·서비스, 06 견적, 07 채팅, 08 리뷰, 12 관리자 | 구현·검증됨 (WS-13~16, 19, 23) |
| 백엔드 03 미디어, 04 지역/검색, 09 고객원장, 10 알림, 13 CS, 14 지역/분류/지표, 11 결제시연 | **미구현** |
| iOS/Android | 회원가입·로그인·A1 메인만 (WS-17/18). 나머지 13묶음 화면 **미구현** |
| 회원 웹 | 정책/연결 점검 수준. 나머지 **미구현** |
| 관리자 웹 | 로그인·회원/원장 조회·제재 (WS-19/23). 나머지 **미구현** |
| 배포 | dev API가 구버전. 신규 코드·마이그레이션 **미적용** |
| 게시판 | 게시 스크립트 존재 (WS-20). 매일 자동 빌드·게시 **미구축** |

## 3. 웨이브 순서

### Wave A — 기반 (선행 필수, L01·L02·L09·L10 + 앱 골격)
| ID | 레인 | 묶음 | 작업 | 수용 기준 |
|---|---|---|---|---|
| A-01 | L01 | 공통 | dev DB 마이그레이션 실행 경로 구축 (Railway 내부 실행 러너) | 007–015가 dev DB에 적용되고 `psql` 재조회로 확인 |
| A-02 | L01 | 공통 | 신규 백엔드를 Railway dev에 배포 | 배포 ID + `GET /health` 응답에 새 release SHA |
| A-03 | L01 | 공통 | 게시판 자동 빌드·게시 파이프라인 (19:00 크론용 스크립트) | 스크립트 1회 실행으로 APK 해시·게시 URL 산출 |
| A-04 | L02 | 01 | WS-12 잔여: READY 전환 경로·가입 readiness 게이트 완성 | 실 PostgreSQL 통합테스트 통과 + 계약 회귀 |
| A-05 | L02 | 01 | 소셜 로그인 클라이언트 계약 확정 (리다이렉트 방식·딥링크) | `contracts/auth-membership.v0.4.json`에 확정, L07/L08 인계 |
| A-06 | L09 | 공통 | 03/04/06/07/08/09/10 화면 계약을 v0.4로 동결 | 계약 테스트 통과 |
| A-07 | L07 | 01·02 | iOS: E1/E2 약관·SMS·프로필 화면 + 실제 API 연결 | 시뮬레이터 실행 + 실 API 저장/재조회 |
| A-08 | L08 | 01·02 | Android: 동일 화면·동일 API | 에뮬레이터 실행 + 실 API 저장/재조회 |
| A-09 | L10 | 12 | 관리자·회원 웹 QA 하네스 | 스크린샷 + API 증거 산출 |

### Wave B — 거래 핵심 (05·06·07·08)
| ID | 레인 | 묶음 | 작업 |
|---|---|---|---|
| B-01 | L03 | 06 | 견적 요청 CRUD·모집기간·마감 상태 완성 |
| B-02 | L03 | 07 | 채팅 목록/미읽음/첨부/재접속 누락복구 |
| B-03 | L03 | 08 | 리뷰 댓글·신고숨김·평점 반영 |
| B-04 | L04 | 09 | 고수별 고객원장 (완전격리·검색·메모) |
| B-05 | L07 | 05·06 | iOS 고수프로필·서비스등록·견적 화면 |
| B-06 | L08 | 05·06 | Android 동일 화면 |
| B-07 | L05 | 12·13 | 관리자 서비스/포트폴리오/CS 화면 |
| B-08 | L06 | 04·06 | 회원 웹 검색·목록·견적 화면 |

### Wave C — 미디어·알림·운영 (03·10·11·14)
| ID | 레인 | 묶음 | 작업 |
|---|---|---|---|
| C-01 | L04 | 03 | R2 업로드·권한분리·썸네일·임시객체 정리 |
| C-02 | L04 | 10 | 알림 저장·읽음·딥링크·고객센터 접수 |
| C-03 | L04 | 14 | 지역/분류 기준코드·지표 집계 |
| C-04 | L07/L08 | 03·10·11 | 양 앱 미디어·알림·결제시연 화면 |
| C-05 | L10 | 전체 | 양 앱 동등성 QA + 최종 빌드·게시 |

## 4. 매일 19:00 빌드·게시
- 크론: 매일 19:00 KST. AOS APK + iOS Simulator 빌드 → 기본 QA → **통과 시에만** `appdownload.mintech.ai` 게시.
- iOS 실기기 서명 IPA는 Apple 회사 가입 승인 전 생성·게시 금지.
- QA 실패 시 게시하지 않고 실패 사유만 보고한다.

## 5. 완료 판정 규칙
- `RESULT.json`의 `status`는 DONE/PARTIAL/BLOCKED만. 검증 항목에 실행 명령과 실제 출력 근거를 남긴다.
- 실행하지 않은 검증은 `NOT_RUN`. 단위 테스트·mock 통과를 실제 거래 통과로 쓰지 않는다.
- FAIL은 수정→동일 기준 재검증으로 연결한다.
