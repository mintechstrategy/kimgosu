# 프로그램 명세서

기준일: 2026-09-27. 실행 코드 기준이며 미구현 업무 기능은 계획으로만 표시한다.

| 프로그램/모듈 | 입력·처리·출력 | 주요 예외/권한 | 상태 | 코드 |
|---|---|---|---|---|
| API 앱 | FastAPI 시작, DB/Redis 연결, `/health/live`, `/health/ready`, 채팅·고객 라우터 등록 | 준비 검사 실패 시 503 | 구현 | `app/main.py` |
| 채팅 인증 | JWT 서명·issuer·audience·만료 검증, subject 등록 scope 검사 | 인증 401, scope 부족 403 | 구현 | `app/chat/auth.py` |
| 채팅 subject/방 | 서비스가 등록한 `(subject_type, subject_id)`에 대화방 연결; 참여자 검사·방 재사용 | 미존재/비참여 404, 본인 방 생성 403 | 구현 | `app/chat/api.py` |
| 메시지/읽음 | 중복 전송 방지, DB 저장, 읽음 커서 갱신, Redis 실시간 알림 | 중복 내용 충돌 409 | 구현 | `app/chat/api.py` |
| 채팅 첨부 | 참여자 업로드, 메시지 연결, 권한 있는 다운로드, 미연결 파일 정리 | 파일 크기·개수 제한, 비참여 차단 | 구현 | `app/chat/api.py`, `app/tasks/celery_app.py` |
| WebSocket | 일회용 티켓 검증 후 메시지/읽음 이벤트 전달 | 티켓 만료·재사용·Origin 검사 | 구현 | `app/chat/api.py` |
| DB 마이그레이션 | 기동 전 Alembic upgrade | 실패 시 API 기동 차단 | 구현 | `migrations/versions/` |
| 외부 API 진입점 | Nginx가 PC LAN 주소 `192.168.0.213:23912`에서 HTTP를 받아 FastAPI로 프록시; 로컬 `127.0.0.1:8080`도 유지 | 공개 `/api/v1/auth/`, `/api/v1/customers/`는 404 차단. HTTP 200/HTTPS TLS 실패 확인 | 구현, TLS 미구성 | `docker-compose.yml`, `deploy/nginx.conf` |
| Android 첫 화면 | 브랜드 스플래시 500ms 후 디버그 T1 계정 선택·LAN 테스트 로그인. 홈과 5개 탭 독바 표시 | 네트워크 실패 시 T1에 머무름; 실제 제공자 인증 미포함 | 구현 | `mobile/app/src/main/java/com/mintechstrategy/kimgosu/MainActivity.java` |
| Android 5개 WebView 내비게이션 | 탭별 WebView를 지연 생성·재사용; 페이지 내 기록 → 이전 탭 → 홈 → 종료 순서. 앱 링크·Android 시스템 뒤로가기가 같은 함수 사용 | 원격 URL 차단. 일부 에뮬레이터에서 홈/마이의 소프트웨어 렌더링 필요 | 구현 | `MainActivity.java`, `mobile/app/src/main/assets/` |
| 임시 테스트 계정 선택 | 디버그 APK에서 S0 → T1 → 서버 `test-login` → A1. 4개 합성 CI를 전송하고 서버가 고객 ID·JWT 발급. 홈 상단에서 재선택 | LAN 테스트 포트 전용. 릴리스 APK는 T1과 합성 CI 제외 | 구현 | `mobile/app/src/debug/java/.../TestAccountGate.java`, `TestLoginClient.java` |
| 고객 식별·프로필 | 합성 CI로 HMAC-SHA256 조회값을 만들고 `customers.ci_lookup_hash` 인덱스에서 조회. 신규 시 `test_무작위32자리hex` ID. 고객 이름·생년월일·주소·전화번호·고수 여부 관리, JWT 발급 및 내 프로필 조회·수정 | 실제 제공자 토큰/CI 진위 검증은 미구현 | 테스트 로그인/API 구현 | `app/accounts/identity.py`, `app/accounts/api.py`, `0005_customer_profile.py` |
| 홈 분야 코드 | DB `service_categories`에서 `is_visible=true` 항목을 `display_order`, `code`순 반환. 명칭·순서·아이콘을 데이터로 관리 | 관리자 쓰기 API/권한은 미구현 | 읽기 API·초기 코드 구현 | `app/catalog/api.py`, `0006_service_categories.py` |
| Android 홈 C영역 | 앱 번들 코드로 즉시 표시한 뒤 카탈로그 API 응답을 적용. 정사각형 카드 1행 가로 스와이프, 코드별 SVG 아이콘. `기타` 미노출 | API 실패 시 번들 코드 유지, JavaScript 비활성 | 구현 | `HomeCategories.java`, `home.html`, `app.css` |
| Android 지역 선택 | 홈 좌상단 지역명·꺾쇠 클릭 → 첨부 설계와 같은 시·도/시·군·구 체크 목록. 비대면 포함 기본 체크, 검색 하기 클릭 → 선택값 기기 저장 및 직전 홈 복귀 | 한 곳 이상 또는 비대면 선택 필요. 지역별 서비스 필터 API는 후속 | 구현 | `MainActivity.java` |
| 회원/서비스/견적/제안/리뷰 | 화면 기반 업무 기능 | 정책 결정 필요 | 미구현 | [API 초안](../API-SPEC.md) |

각 프로그램의 상세 요청·응답은 [API정의서](../api/API-DEFINITION.md), 영속 데이터는 [테이블정의서](TABLE-DEFINITION.md)를 따른다.
