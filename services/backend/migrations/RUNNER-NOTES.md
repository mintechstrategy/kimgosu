# 마이그레이션 러너 재실행 안전성 검토 (001–005)

작성: WS-02 / 검토 기준: origin/dev (af4559c) 의 `services/backend/migrations/*.sql`
범위: 문서화만. 실제 dev/Railway DB 적용은 하지 않았다. 007은 후보(candidate)이며
어떤 DB에도 적용되지 않았다.

## 요약

| 파일 | 재실행(같은 DB에 두 번) 결과 | 차단 원인 |
|---|---|---|
| 001_membership.sql | 성공(무변화) | 없음. 단 **조용한 스키마 드리프트** 위험 있음 |
| 002_auth_lifecycle.sql | 성공(무변화) | 없음. 같은 드리프트 위험 |
| 003_explicit_social_link.sql | 성공(무변화) | 없음. 같은 드리프트 위험 |
| 004_policy_content_integrity.sql | **실패** | `ADD COLUMN`/`CREATE FUNCTION`/`CREATE TRIGGER`에 IF NOT EXISTS / OR REPLACE 없음 |
| 007_policy_history_indexes.sql (후보) | 성공(무변화) | 없음. `CREATE INDEX IF NOT EXISTS`만 사용 |

즉 러너가 001→005를 매번 전부 재생하면 **004에서 확실히 실패**한다. 다른 파일은
"성공하지만 아무 것도 하지 않는다"는 다른 종류의 위험을 갖는다.

## 001_membership.sql

- `CREATE SCHEMA/TABLE/UNIQUE INDEX ... IF NOT EXISTS`만 사용 → 재실행 시 오류 없음.
- `GRANT ... ON ALL TABLES IN SCHEMA kg_membership` / `ALL SEQUENCES`는 그 시점에
  존재하는 객체에만 적용된다. 이후 마이그레이션(002)이 만든 테이블은 자체 GRANT가
  필요하며, 001을 다시 실행해도 그 테이블에 권한이 붙지 않는다.
- **드리프트 위험**: `CREATE TABLE IF NOT EXISTS`는 테이블이 이미 있으면 정의를
  비교하지 않는다. 과거 버전의 001로 만들어진 테이블에 컬럼/CHECK가 빠져 있어도
  러너는 "성공"으로 기록한다. 재실행 안전성은 확보되지만 스키마 정합성은 보장되지
  않는다. → 러너는 파일 실행 후 기대 스키마(컬럼·제약·인덱스)를 별도로 검사해야 한다.

## 002_auth_lifecycle.sql

- `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, 명시 테이블 GRANT → 재실행 안전.
- 001과 같은 드리프트 위험. 특히 `one_open_member_per_phone`,
  `unique_refresh_digest`, `one_live_sms_per_ticket`는 부분 유니크 인덱스라
  조건절이 바뀌어도 `IF NOT EXISTS`가 이를 감지하지 못한다.

## 003_explicit_social_link.sql

- `ADD COLUMN IF NOT EXISTS` 2건뿐 → 재실행 안전, 같은 드리프트 위험.
- 002의 `oauth_flows` 테이블을 전제로 한다. 003 단독 실행은 실패한다(순서 의존).

## 004_policy_content_integrity.sql — 비멱등 지점

1. `ALTER TABLE kg_membership.policy_documents ADD COLUMN content_sealed boolean
   NOT NULL DEFAULT false;` — `IF NOT EXISTS` 없음 → 2회차 `42701 column already exists`.
2. `CREATE FUNCTION kg_membership.policy_content_integrity_guard()` — `OR REPLACE`
   없음 → 2회차 `42723 function already exists`.
3. `CREATE FUNCTION kg_membership.consent_event_integrity_guard()` — 동일.
4. `CREATE TRIGGER policy_content_integrity_guard` /
   `consent_event_integrity_guard` — `DROP TRIGGER IF EXISTS` 없음 → 2회차 `42710`.
5. `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` — 재실행 시 라이브 테이블의 모든
   읽기/쓰기를 막는다. `lock_timeout=5s` 덕분에 무한 대기 대신 5초 후 실패하지만,
   락을 얻은 경우에는 백필 UPDATE가 끝날 때까지 서비스가 멈춘다.
6. 백필 `UPDATE ... SET content_sealed = true`는 값을 바꾸지 않더라도 모든 대상
   행에 새 행 버전을 만든다(블로트). 또한 트리거가 생성되기 **전**에 실행되므로
   가드가 이 UPDATE를 검증하지 않는다. 실제로는 시점상 재적용해도 같은 값이
   되지만, "행 수정이 없다"는 보장은 아니다.
7. 파일 자체가 `BEGIN; ... COMMIT;`을 포함한다. 러너가 파일을 다시 트랜잭션으로
   감싸면 `WARNING: there is already a transaction in progress`가 나고, 파일 내부
   `COMMIT`이 러너의 트랜잭션을 먼저 닫아 이후 문장이 트랜잭션 밖에서 실행된다.

결론: 004는 "빈 DB 1회 적용" 전제로 작성되어 있다. 재실행 안전하게 만들려면
`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`
+ `CREATE TRIGGER`로 바꾸고, 백필은 `WHERE content_sealed = false AND (...)`로
좁혀야 한다. **이 변경은 004의 의미 변경이므로 WS-02 범위에서 임의 수정하지
않았다. 사용자/소유자 결정이 필요하다(OPEN).**

## 007_policy_history_indexes.sql (후보)

- `CREATE INDEX IF NOT EXISTS` 4건만 사용 → 재실행 안전. 데이터 변경 없음.
- 유일한 부작용은 빌드 중 `SHARE` 락으로 쓰기가 잠시 막히는 것. 대용량 테이블에서는
  트랜잭션 밖 `CREATE INDEX CONCURRENTLY`로 바꿔야 한다(현재 파일은 트랜잭션 사용).
- 롤백: `DROP INDEX CONCURRENTLY kg_membership.<name>`. 손실되는 데이터 없음.
- 인덱스로 제거할 수 없는 정렬: `policySnapshotSelect`의 display selector는
  3번째 정렬 키가 `effective_at<=now()`를 포함한 boolean 식이라 IMMUTABLE이 아니어서
  인덱싱할 수 없다. 해당 정렬은 남는다. 이를 "인덱스로 해결됨"으로 보고하지 않는다.
- 인덱스를 만들지 않은 조회: `consent_events`의 문서 단위 이력(document_id) 조회는
  현재 코드에 소비자가 없어 추측성 인덱스를 추가하지 않았다.

## 러너 구현 권고

1. `kg_membership.schema_migrations(filename PK, sha256, applied_at)` 같은 적용
   이력 테이블을 두고, **파일 해시**로 이미 적용된 파일을 건너뛴다. 이름만 기록하면
   파일 내용이 바뀌어도 감지하지 못한다.
2. 기본 동작은 "미적용 파일만 순서대로 적용", 재적용은 명시적 `--force`에서만.
3. 파일이 자체 `BEGIN/COMMIT`을 포함하므로 러너가 감싸지 않는다. 포함 여부를
   파싱해 판단하거나, 아예 파일에서 트랜잭션 구문을 제거하고 러너가 감싼다.
   두 방식을 섞지 않는다.
4. `pg_advisory_lock`으로 동시 러너를 직렬화한다(두 프로세스가 같은 004를 동시에
   돌리면 한쪽이 `42701`로 죽는다).
5. 실패 시 즉시 중단(psql `-v ON_ERROR_STOP=1`). node-postgres 다중 문장 실행은
   오류 후 남은 문장이 "current transaction is aborted"로 연쇄 실패하므로, 첫
   오류만 보고하고 나머지를 성공으로 집계하지 않는다.
6. 적용 후 검사: 005라면 `pg_indexes`에 4개 인덱스 존재, 004라면 `content_sealed`
   컬럼과 활성 트리거 2개(`tgenabled='O'`) 존재를 확인한다.
