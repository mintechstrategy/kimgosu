# 프로그램 명세서

기준일: 2026-09-28. 실행 코드 기준이며 미구현 업무 기능은 계획으로만 표시한다.

| 프로그램/모듈 | 입력·처리·출력 | 주요 예외/권한 | 상태 | 코드 |
|---|---|---|---|---|
| API 앱 | FastAPI 시작, DB/Redis 연결, `/health/live`, `/health/ready`, 채팅·고객 라우터 등록 | 준비 검사 실패 시 503 | 구현 | `app/main.py` |
| 채팅 인증 | JWT 서명·issuer·audience·만료 검증, subject 등록 scope 검사 | 인증 401, scope 부족 403 | 구현 | `app/chat/auth.py` |
| 채팅 subject/방 | 서비스가 등록한 `(subject_type, subject_id)`와 표시 제목 스냅샷에 대화방 연결; 참여자 검사·방 재사용·목록 커서 | 미존재/비참여 404, 본인 방 생성 403 | 구현 | `app/chat/api.py`, `0009_chat_subject_title.py` |
| 메시지/읽음 | 중복 전송 방지, DB 저장, 읽음 커서 갱신, Redis 실시간 알림 | 중복 내용 충돌 409 | 구현 | `app/chat/api.py` |
| 채팅 첨부 | 참여자 업로드, 메시지 연결, 권한 있는 다운로드, 미연결 파일 정리 | 파일 크기·개수 제한, 비참여 차단 | 구현 | `app/chat/api.py`, `app/tasks/celery_app.py` |
| WebSocket | 일회용 티켓 검증 후 메시지/읽음 이벤트 전달 | 티켓 만료·재사용·Origin 검사 | 구현 | `app/chat/api.py` |
| DB 마이그레이션 | 기동 전 Alembic upgrade | 실패 시 API 기동 차단 | 구현 | `migrations/versions/` |
| 외부 API 진입점 | Nginx가 PC LAN 주소 `192.168.0.213:23912`에서 HTTP를 받아 FastAPI로 프록시; 로컬 `127.0.0.1:8080`도 유지 | TLS 미구성 중 공개 `/api/v1/` 전체 404 차단. HTTP 200/HTTPS TLS 실패 확인 | 구현, TLS 미구성 | `docker-compose.yml`, `deploy/nginx.conf` |
| Android 첫 화면 | 브랜드 스플래시 500ms 후 디버그 T1 계정 선택·LAN 테스트 로그인. 홈과 5개 탭 독바 표시 | 네트워크 실패 시 T1에 머무름; 실제 제공자 인증 미포함 | 구현 | `mobile/app/src/main/java/com/mintechstrategy/kimgosu/MainActivity.java` |
| Android 5개 WebView 내비게이션 | 탭별 WebView를 지연 생성·재사용; 페이지 내 기록 → 이전 탭 → 홈 → 종료 순서. 앱 링크·Android 시스템 뒤로가기가 같은 함수 사용 | 로컬 asset만 탐색하고 WebView 네트워크 로드를 차단해 JavaScript API 브리지가 원격 프레임에 노출되지 않게 함. 일부 에뮬레이터에서 홈/마이의 소프트웨어 렌더링 필요 | 구현 | `MainActivity.java`, `mobile/app/src/main/assets/` |
| 임시 테스트 계정 선택 | 디버그 APK에서 S0 → T1 → 서버 `test-login` → A1. 일반 1–50·고수 1–50 번호를 선택하고 서버가 고객 ID·JWT 발급. 홈 상단에서 재선택 | LAN 테스트 포트 전용. 릴리스 APK는 T1과 합성 CI 제외 | 구현 | `mobile/app/src/debug/java/.../TestAccountGate.java`, `TestLoginClient.java` |
| 고객 식별·프로필 | 합성 CI로 HMAC-SHA256 조회값을 만들고 `customers.ci_lookup_hash` 인덱스에서 조회. 신규 시 `test_무작위32자리hex` ID. 고객 이름·생년월일·주소·전화번호·고수 여부 관리, JWT 발급 및 내 프로필 조회·수정 | 실제 제공자 토큰/CI 진위 검증은 미구현 | 테스트 로그인/API 구현 | `app/accounts/identity.py`, `app/accounts/api.py`, `0005_customer_profile.py` |
| 홈 분야 코드 | DB `service_categories`에서 `is_visible=true` 항목을 `display_order`, `code`순 반환. 명칭·순서·아이콘을 데이터로 관리 | 관리자 쓰기 API/권한은 미구현 | 읽기 API·초기 코드 구현 | `app/catalog/api.py`, `0006_service_categories.py` |
| Android 홈 A1 | 제공된 홈 디자인 PNG를 변경 없이 앱 자산으로 사용. 지역 선택·얇은 문구·정사각형 **4열×2행** 분야. 번들 코드 즉시 표시 후 API 갱신. 최근 서비스 API가 응답하면 카드 제목·가격·이동 대상 갱신 | API 실패 시 번들 표시. API 화면용 JavaScript는 로컬 asset만 허용 | 에뮬레이터 홈 검증, 새 데이터 연동은 격리 API 검증 | `MainActivity.java`, `HomeCategories.java`, `home.html`, `home-feed.js`, `app.css` |
| Android 지역 선택 | 홈 좌상단 지역명·꺾쇠 클릭 → 시·도/시·군·구 체크 목록. 선택값 기기 저장 및 직전 홈 복귀. 목록 API에는 선택 지역·비대면 포함 여부 전달 | 지역 목록은 앱 내장 일부 지역, 전국 마스터는 후속 | 구현 | `MainActivity.java`, `ApiBridge.java`, `market-app.js` |
| 서비스·견적·제안·찜 API | 고수 서비스 작성/수정/숨김/논리 삭제, 견적 작성/수정/마감/논리 삭제, 분야·지역 검색, 찜, 같은 분야 서비스로 제안, 문의·제안 채팅 연결 | 작성자·고수 자격·같은 분야·중복 제안 검사 | 운영 PC 배포·1,000회 시나리오 통과 | `app/marketplace/api.py`, `0007_marketplace.py`, `0008_completion_reviews.py` |
| 양측 완료·리뷰 API | 독립 2인 채팅방 참가자 각각 완료 확인. 양측 확인 뒤 상대방에 방당 1회 평점·본문 작성 | 미완료 409, 비참여 404, 중복 409 | API smoke 통과 | `app/marketplace/reviews.py`, `0008_completion_reviews.py` |
| Android 업무 화면 | 검색·목록·상세, 견적/서비스 등록·수정, 받은/보낸 제안, 커서 기반 채팅 목록 더 보기·대화, 마이·찜, 일반/고수 홈 전환 | 로컬 asset WebView, Java HTTP 어댑터가 JWT 첨부. API 오류는 화면에 표시 | Android 빌드·검색 화면 확인, 전체 경로 실기기 검증 전 | `market-app.js`, `market.css`, `ApiBridge.java`, `expert.html` 등 |
| 알림·고객센터 접수·실제 OAuth | 화면 기반 후속 업무 기능 | 제공자 키·정책 결정 필요 | 미구현 | [API 초안](../API-SPEC.md), [간편인증 가이드](SOCIAL-LOGIN-GUIDE.md) |

각 프로그램의 상세 요청·응답은 [API정의서](../api/API-DEFINITION.md), 영속 데이터는 [테이블정의서](TABLE-DEFINITION.md)를 따른다.
