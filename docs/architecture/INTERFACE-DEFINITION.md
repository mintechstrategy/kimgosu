# 인터페이스 정의서

기준일: 2026-09-27. 시스템 경계와 통신 계약을 기록한다. 개별 URL·필드는 [API정의서](../api/API-DEFINITION.md)를 따른다.

| 경계 | 방향·방식 | 인증/데이터 | 상태 |
|---|---|---|---|
| 모바일 앱 ↔ HTTPS edge ↔ FastAPI | 기준 주소 `https://mt0205.synology.me:23912` (TCP 23912), JSON REST; 채팅은 `wss://mt0205.synology.me:23912` | Bearer JWT, 방 티켓 | HTTPS 진입점 구성. Android 앱 API 호출은 아직 없음; 외부 연결은 포트포워딩/인증서 발급 후 검증 필요 |
| 향후 웹 ↔ FastAPI | 동일 REST·WebSocket 계약 | Bearer JWT, 허용 Origin 설정 | 서버 계약 구현, 웹 미구현 |
| Caddy edge ↔ Nginx ↔ FastAPI | 외부 HTTPS 23912 → Caddy 내부 443 → Docker 내부 HTTP·WebSocket. TCP 80은 인증서 발급. 로컬 점검은 `127.0.0.1:8080` | 공유기 80/23912 포워딩 및 호스트 방화벽 허용 필요; DB/Redis/8000/8080은 외부 미공개 | Compose 구성. 외부 연결 미검증 |
| FastAPI ↔ PostgreSQL | SQLAlchemy/SQL | 채팅·마이그레이션 영속 데이터 | 구현 |
| FastAPI/worker ↔ Redis | 이벤트 pub/sub 및 Celery broker | 실시간 통지·비동기 작업 | 구현 |
| FastAPI/worker ↔ 파일 저장소 | 컨테이너 bind mount | `G:\shared_storage\kimgosu\uploads`; 참여자 권한 검사 후 다운로드 | 구현 |
| GitHub Actions → GHCR → PC 배포 에이전트 | 이미지 빌드·게시·감시·Compose 갱신 | GitHub 인증 및 이미지 digest | 구현 |
| OAuth·SMS·푸시·결제 제공사 | 외부 API | 제공사·인증·오류 정책 미정 | 미결정/미구현 |
| 디버그 APK 계정 선택 → 홈 | 로컬 화면 전환 | 합성 `test_...` ID·CI 4개를 앱 디버그 소스에만 고정 | 구현, 서버 인증 아님 |
| Android 독바 → 탭 WebView 5개 | 앱 내부 화면 전환; 각 탭의 WebView 인스턴스·방문 기록 독립 유지 | 탭을 전환해도 활성 탭 외 기록을 지우지 않음; 앱 내/시스템 뒤로가기는 공통 처리 | 사용자 확정 요구, 다음 빌드 미구현 |
| 향후 간편인증 제공자 → 고객 식별 | 서버가 제공자 응답을 검증한 후 CI 수신 → HMAC 조회 → 고객원장 `user_id` | 클라이언트가 보낸 임의 CI를 신뢰하지 않음; CI 제공 동의·비밀키 운영 필요 | DB·내부 함수 구현, 제공자 연동/토큰 발급 미구현 |

앱의 `일반/고수` UI 모드는 서버 권한의 근거가 아니다. 서버는 리소스 소유권과 채팅 참여 관계를 검사한다. 채팅 `subject` 등록은 신뢰된 도메인 서비스의 `chat:subjects:write` scope가 필요하다.
