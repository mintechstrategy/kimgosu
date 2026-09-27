# 로컬 Docker → AWS 이전 기준

현재는 `G:\src\kimgosu` 코드, `G:\docker\kimgosu` Compose, `G:\shared_storage\kimgosu` 영속 데이터다. 애플리케이션은 FastAPI REST/WebSocket, PostgreSQL, Redis, 업로드 디렉터리를 환경 변수와 Compose secret으로 연결한다. 업무·채팅 API는 Android WebView와 미래 웹에서 같은 계약을 사용한다.

## 목표 구성

| 현재 | AWS 후보 | 이행 조건 |
|---|---|---|
| FastAPI/worker/scheduler 이미지 | ECS Fargate 작업/서비스 | 이미지를 레지스트리로 배포하고 API·worker·scheduler 명령을 분리한다. API 앞에 HTTPS 로드 밸런서를 둔다. |
| PostgreSQL bind mount | RDS for PostgreSQL | `pg_dump/pg_restore` 또는 지속 복제가 필요한 규모에는 DMS를 검토한다. 마이그레이션 버전과 데이터 건수를 대조한다. |
| Redis bind mount | 관리형 Redis 호환 서비스 | 채팅 이벤트와 작업 큐 각각의 네임스페이스·내구성·재시작 동작을 검증한다. |
| uploads 로컬 디렉터리 | 우선 EFS, 이후 객체 저장소 어댑터 검토 | 현재 첨부 구현이 경로 기반이므로 EFS로 무코드 이전 가능하다. 객체 저장소로 전환할 때는 업로드/다운로드 어댑터를 별도 작업으로 구현한다. |
| Compose secrets | Secrets Manager 등 | JWT·DB·CI HMAC 키를 그대로 이전하고 키 회전 절차를 수립한다. CI HMAC 키가 달라지면 기존 고객 조회가 실패한다. |

애플리케이션 코드에 PC IP, `G:` 경로, Synology 도메인을 넣지 않는다. Android의 `ApiEndpoint`는 빌드 환경별 설정으로 바꾸는 작업이 남아 있다. DB URL, Redis URL, 업로드 경로, 외부 공개 URL은 배포 구성으로 주입한다. 데이터 이전 전후 `customers`, `services`, `quote_requests`, `chat_rooms`, `chat_messages`, `reviews` 건수와 참조 관계를 대조한다.

근거: [ECS 서비스 로드 밸런싱](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html), [ECS EFS 구성](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specify-efs-config.html), [PostgreSQL 이전 방법](https://docs.aws.amazon.com/dms/latest/sbs/chap-manageddatabases.postgresql-rds-postgresql.html), [ECS 비밀 관리](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html).
