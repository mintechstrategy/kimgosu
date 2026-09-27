# 인터페이스 정의서

기준일: 2026-09-27. 시스템 경계와 통신 계약을 기록한다. 개별 URL·필드는 [API정의서](../api/API-DEFINITION.md)를 따른다.

| 경계 | 방향·방식 | 인증/데이터 | 상태 |
|---|---|---|---|
| 모바일 앱 ↔ FastAPI | 향후 HTTPS JSON REST; 실시간 수신 WebSocket | Bearer JWT, 방 티켓 | Android 첫 화면만 구현. 현재 API 요청 없음; 채팅 서버 계약은 구현 |
| 향후 웹 ↔ FastAPI | 동일 REST·WebSocket 계약 | Bearer JWT, 허용 Origin 설정 | 서버 계약 구현, 웹 미구현 |
| Nginx ↔ FastAPI | Docker 내부 HTTP·WebSocket 프록시 | 외부 로컬 포트 8080 기본 | 구현 |
| FastAPI ↔ PostgreSQL | SQLAlchemy/SQL | 채팅·마이그레이션 영속 데이터 | 구현 |
| FastAPI/worker ↔ Redis | 이벤트 pub/sub 및 Celery broker | 실시간 통지·비동기 작업 | 구현 |
| FastAPI/worker ↔ 파일 저장소 | 컨테이너 bind mount | `G:\shared_storage\kimgosu\uploads`; 참여자 권한 검사 후 다운로드 | 구현 |
| GitHub Actions → GHCR → PC 배포 에이전트 | 이미지 빌드·게시·감시·Compose 갱신 | GitHub 인증 및 이미지 digest | 구현 |
| OAuth·SMS·푸시·결제 제공사 | 외부 API | 제공사·인증·오류 정책 미정 | 미결정/미구현 |

앱의 `일반/고수` UI 모드는 서버 권한의 근거가 아니다. 서버는 리소스 소유권과 채팅 참여 관계를 검사한다. 채팅 `subject` 등록은 신뢰된 도메인 서비스의 `chat:subjects:write` scope가 필요하다.
