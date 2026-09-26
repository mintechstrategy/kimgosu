# 김고수 Docker 구성

FastAPI 상태 확인 API, Celery worker/beat, Alembic 초기 마이그레이션과 Dockerfile을 포함합니다. 실제 김고수 업무 기능은 아직 구현하지 않았습니다. 로컬 이미지 `kimgosu-backend:local`로 실행을 검증했습니다. GHCR 게시 및 PC Runner 자동 배포는 아직 연결하지 않았습니다.

## 준비

1. Docker Desktop을 Linux 컨테이너 모드로 실행합니다.
2. `.env.example`을 `.env`로 복사하고 `BACKEND_IMAGE`를 실제 빌드된 이미지의 커밋 태그 또는 digest로 변경합니다.
3. `secrets/db_password.txt`와 `secrets/jwt_secret.txt`에 서로 다른 충분히 긴 임의의 비밀값을 저장합니다. 파일은 UTF-8로 저장하고 Git에 추가하지 않습니다.
4. 비공개 GHCR 이미지라면 배포 계정에서 레지스트리에 로그인합니다.

## 백엔드 이미지가 구현해야 하는 계약

- 작업 디렉터리 `/app`, Python 및 uvicorn, Celery, Alembic 포함.
- FastAPI 진입점 `app.main:app`.
- `GET /health/ready`: DB와 Redis 연결이 준비되면 HTTP 200, 그렇지 않으면 503.
- Celery 진입점 `app.tasks.celery_app:celery_app`. Beat 주기 작업도 코드에서 정의합니다.
- Alembic 설정과 migrations 포함. DB 설정은 환경변수에서 읽습니다.
- `DB_PASSWORD_FILE` 및 `JWT_SECRET_FILE`은 앱과 Alembic 설정에서 직접 파일을 읽어 처리해야 합니다. FastAPI가 자동 지원하는 설정은 아닙니다.
- `/app/uploads` 및 `/app/scheduler` 볼륨에 실행 사용자가 쓸 수 있도록 이미지에서 권한을 준비합니다.
- 채팅 메시지는 DB에 보관하고 Redis는 실시간 전달에 사용합니다. 재접속 시 DB에서 복구합니다.
- 작업은 중복 실행에 안전하게 구현하고, 중요 알림은 DB outbox 등을 통해 큐 전송 실패 시 재처리할 수 있어야 합니다.
- scheduler는 하나만 실행합니다.

## 첫 실행

```powershell
docker compose config --quiet
docker compose pull
docker compose up -d --wait
```

현재 접근 주소는 `http://localhost:8080`입니다. PC 로컬 접근만 허용하며 휴대폰 또는 인터넷 접근과 HTTPS는 별도 구성해야 합니다. DB와 Redis 포트는 호스트에 공개하지 않습니다.

## 추후 CI/CD의 배포 순서

GitHub에서 테스트와 이미지 빌드가 성공하면 PC Runner가 정확한 이미지 참조로 `.env`의 `BACKEND_IMAGE`를 갱신하고 다음 순서로 배포합니다.

```powershell
docker compose pull
docker compose up -d --wait db redis
docker compose run --rm migrate
docker compose up -d --no-deps --wait api worker scheduler
docker compose up -d --no-deps --wait proxy
```

실제 배포 스크립트는 각 명령의 종료 코드를 확인하고 실패 즉시 중단해야 합니다. API 교체에는 잠깐의 중단이 발생할 수 있습니다. worker와 scheduler는 현재 프로세스 시작 여부만 확인하므로 추후 작업 처리 smoke test도 추가해야 합니다.

마이그레이션은 기존 앱과 호환되도록 작성합니다. 이미지 복구가 DB 구조까지 복구하지는 않습니다. 동일 환경의 배포가 겹치지 않도록 Actions concurrency를 설정해야 합니다.

## 데이터 보존

PostgreSQL, Redis, 업로드, 스케줄러 상태는 `G:\shared_storage\kimgosu`의 하위 폴더를 bind mount하여 저장합니다. `.env`의 `STORAGE_ROOT`로 변경할 수 있으며 기본값도 같은 절대경로입니다.

| 호스트 폴더 | 컨테이너 경로 | 용도 |
|---|---|---|
| `postgres` | `/var/lib/postgresql/data` | PostgreSQL 데이터 |
| `redis` | `/data` | Redis AOF 데이터 |
| `uploads` | `/app/uploads` | API와 worker가 공유하는 첨부 파일 |
| `scheduler` | `/app/scheduler` | Celery Beat 상태 |

컨테이너 교체 및 Compose 종료 후에도 이 폴더의 데이터는 유지됩니다. Docker 이미지와 컨테이너 임시 파일의 위치는 Docker Desktop 설정을 따릅니다. 비밀값은 기존 프로젝트의 `secrets` 폴더에 두며 공유 데이터 폴더로 옮기지 않습니다.

초기 하위 폴더는 준비되어 있습니다. 다른 PC에서는 실행 전에 위 네 폴더를 만들어야 합니다. `create_host_path: false`로 지정하여 경로 누락 시 빈 폴더를 자동 생성하지 않고 실패하도록 했습니다. Windows에서 실행되는 배포 Runner를 전제로 하며 WSL 내부 Runner를 사용하면 `/mnt/g/...` 등 해당 환경에서 유효한 경로를 별도로 설정해야 합니다.

Docker Desktop의 G 드라이브 접근 및 PostgreSQL 초기화/파일 권한은 실제 기동 시 검증해야 합니다. 아직 데이터 이전은 수행하지 않았습니다. 기존 named volume에 데이터가 있는 환경에서는 최초 실행 전에 백업/복원이 필요합니다.

이 폴더는 백업이 아닙니다. PostgreSQL은 실행 중인 데이터 폴더를 단순 복사하는 대신 DB 백업 도구로 백업하고, 업로드 파일도 별도 디스크 또는 외부 저장소에 백업해야 합니다.

이미지 태그는 선택한 버전 계열로 지정했습니다. 실제 배포 전에 검증한 patch 버전 또는 digest로 고정합니다. PostgreSQL major 업그레이드는 단순 이미지 교체로 수행하지 않습니다.

## 로컬 이미지 실행 기록

소스 폴더에서 `docker build -t kimgosu-backend:local .`로 빌드합니다. 배포 폴더 `.env`에는 `BACKEND_IMAGE=kimgosu-backend:local`을 설정합니다. 배포 폴더에서 `docker compose up -d --wait`로 실행합니다.

`http://localhost:8080/docs`에서 API 문서를 확인할 수 있습니다. `/health/ready`의 DB·Redis 연결, Worker ping, 업로드 쓰기, Alembic 초기 버전을 확인했습니다. scheduler는 기동되지만 업무용 정기 작업은 아직 등록하지 않았습니다.
