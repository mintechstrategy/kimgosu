# 프로그램 명세서

기준일: 2026-09-27. 실행 코드 기준이며 미구현 업무 기능은 계획으로만 표시한다.

| 프로그램/모듈 | 입력·처리·출력 | 주요 예외/권한 | 상태 | 코드 |
|---|---|---|---|---|
| API 앱 | FastAPI 시작, DB/Redis 연결, `/health/live`, `/health/ready`, 채팅 라우터 등록 | 준비 검사 실패 시 503 | 구현 | `app/main.py` |
| 채팅 인증 | JWT 서명·issuer·audience·만료 검증, subject 등록 scope 검사 | 인증 401, scope 부족 403 | 구현 | `app/chat/auth.py` |
| 채팅 subject/방 | 서비스가 등록한 `(subject_type, subject_id)`에 대화방 연결; 참여자 검사·방 재사용 | 미존재/비참여 404, 본인 방 생성 403 | 구현 | `app/chat/api.py` |
| 메시지/읽음 | 중복 전송 방지, DB 저장, 읽음 커서 갱신, Redis 실시간 알림 | 중복 내용 충돌 409 | 구현 | `app/chat/api.py` |
| 채팅 첨부 | 참여자 업로드, 메시지 연결, 권한 있는 다운로드, 미연결 파일 정리 | 파일 크기·개수 제한, 비참여 차단 | 구현 | `app/chat/api.py`, `app/tasks/celery_app.py` |
| WebSocket | 일회용 티켓 검증 후 메시지/읽음 이벤트 전달 | 티켓 만료·재사용·Origin 검사 | 구현 | `app/chat/api.py` |
| DB 마이그레이션 | 기동 전 Alembic upgrade | 실패 시 API 기동 차단 | 구현 | `migrations/versions/` |
| Android 첫 화면 | Android 시스템 스플래시 후 보라색 브랜드 스플래시 500ms, 정적 A1 홈과 5개 탭 독바. 탭 전환 시 홈 View 재사용 | 시작 시 인증/네트워크 없음. 홈 외 탭 본문은 미구현 | 구현 | `mobile/app/src/main/java/com/mintechstrategy/kimgosu/MainActivity.java` |
| 회원/서비스/견적/제안/리뷰 | 화면 기반 업무 기능 | 정책 결정 필요 | 미구현 | [API 초안](../API-SPEC.md) |

각 프로그램의 상세 요청·응답은 [API정의서](../api/API-DEFINITION.md), 영속 데이터는 [테이블정의서](TABLE-DEFINITION.md)를 따른다.
