# 코드인스턴스

기준일: 2026-09-27. 여기서 `코드인스턴스`는 설계 기능이 어떤 **소스 코드와 실행 컨테이너**로 실현되는지 추적하는 목록으로 정의한다. 다른 의미를 의도한 경우 정의를 갱신한다.

| 기능/인스턴스 | 소스 | 실행 단위 | 상태 |
|---|---|---|---|
| HTTP·WebSocket API | `app/main.py`, `app/chat/api.py`, `app/chat/auth.py` | `api` 컨테이너, Uvicorn worker 2개 | 구현 |
| 비동기 작업 | `app/tasks/celery_app.py` | `worker`, `scheduler` 컨테이너 | 채팅 첨부 정리 구현 |
| 스키마 적용 | `migrations/env.py`, `migrations/versions/` | 일회성 `migrate` 컨테이너 | 구현 |
| 리버스 프록시 | `deploy/nginx.conf` | `proxy` 컨테이너 | 구현 |
| 관계형 DB | Alembic SQL, `docker-compose.yml` | `db` (PostgreSQL 17) | 구현 |
| 이벤트·작업 브로커 | `app/main.py`, `app/tasks/celery_app.py`, `docker-compose.yml` | `redis` (Redis 7.4) | 구현 |
| CI 빌드·검증 | `.github/workflows/ci.yml`, `Dockerfile`, `tests/chat_*.py` | GitHub Actions | 구현 |
| 로컬 배포 | `deploy/agent.py`, `deploy/deploy.ps1` | 사용자 PC 배포 에이전트와 Docker Compose | 구현 |
| 모바일 앱·웹 | 해당 코드 없음 | 없음 | 미구현 |

소스 디렉터리 `G:\src\kimgosu`, 배포 디렉터리 `G:\docker\kimgosu`, 영속 저장소 `G:\shared_storage\kimgosu`의 구분은 [스토리지 배치](../../STORAGE-LAYOUT.md)를 따른다.
