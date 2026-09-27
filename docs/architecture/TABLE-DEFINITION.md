# 테이블정의서

기준일: 2026-09-27. 실제 스키마의 기준은 Alembic `0002_chat`, `0003_chat_attachments`, `0004_customer_identity`, `0005_customer_profile`이다. `0001_bootstrap`은 테이블을 만들지 않는다. 서비스·견적 테이블은 아직 없다.

| 테이블 | 주요 컬럼(형식) | 키·관계·제약 | 용도 |
|---|---|---|---|
| `customers` | `user_id varchar(80)`, `ci_lookup_hash char(64)`, `customer_name varchar(100)`, `birth_date date`, `home_address varchar(500)`, `phone_number varchar(30)`, `expert_enabled bool`, `created_at`, `updated_at timestamptz` | PK `user_id`; **unique index** `uq_customers_ci_lookup_hash`; 사용자 ID·해시·이름 형식 검사 | 고객원장. CI 조회로 사용자 ID 찾기. CI 원문 미저장. 기존 행의 새 프로필 컬럼은 nullable |
| `chat_subjects` | `id uuid`, `subject_type varchar(80)`, `subject_id uuid`, `owner_user_id varchar(80)`, `active bool`, `created_at timestamptz` | PK `id`; UQ `(subject_type, subject_id)`; type 형식 검사 | 미래의 모든 서비스 리소스를 채팅에 연결 |
| `chat_rooms` | `id uuid`, `subject_id uuid`, `initiated_by varchar(80)`, `created_at`, `last_message_at` | PK `id`; FK subject RESTRICT; UQ `(subject_id, initiated_by)` | 대상·발신자별 방 |
| `chat_participants` | `room_id uuid`, `user_id varchar(80)`, `joined_at`, `last_read_message_id uuid` | PK `(room_id,user_id)`; FK room CASCADE, 읽음 메시지 SET NULL | 참여자·읽음 위치 |
| `chat_messages` | `id uuid`, `room_id uuid`, `sender_user_id varchar(80)`, `client_message_id uuid`, `body text`, `created_at` | PK `id`; FK room CASCADE; `(room_id,sender_user_id)` 참가자 FK; UQ `(room_id,sender_user_id,client_message_id)`; 본문 최대 4000자 | 메시지·재시도 중복 방지 |
| `chat_attachments` | `id uuid`, `room_id uuid`, `uploader_user_id varchar(80)`, `message_id uuid nullable`, `filename varchar(255)`, `content_type varchar(255)`, `byte_size bigint`, `created_at` | PK `id`; FK room CASCADE, message SET NULL, 참가자 FK; 크기 1–104857600 byte | 비공개 파일 메타데이터 |

`customers.user_id`가 고객원장의 PK다. `ci_lookup_hash`는 서버 전용 비밀키로 검증된 CI에 HMAC-SHA256을 적용한 64자리 값이며, 고유 인덱스로 CI를 빠르게 역조회한다. 원문 CI는 DB에 저장하지 않는다. 비밀키는 Compose secret `secrets/ci_lookup_key.txt`에서 읽는다. 키 교체·재계산 절차와 제공자 CI 제공 조건은 실제 간편인증 연동 전에 결정해야 한다. `0005`는 기존 행을 유지하기 위해 새 프로필 값을 nullable로 추가하고 `expert_enabled`의 기본값을 `false`로 한다.

채팅 사용자 ID 컬럼은 `0004`에서 기존 UUID를 문자열로 보존하며 `varchar(80)`으로 바뀐다. 채팅은 서비스·견적 및 고객원장에 FK를 직접 두지 않아 도메인 독립을 유지한다. 실제 계정 삭제·익명화 정책과 참조 무결성은 [결정 기록](../planning/DECISIONS.md)에 따라 확정한다. 전체 컬럼 기본값과 인덱스는 마이그레이션 원문을 최종 기준으로 한다.

`chat_subjects.subject_type`의 형식과 향후 등록되는 값은 [코드인스턴스](CODE-INSTANCES.md)의 `CHAT_SUBJECT_TYPE` 그룹에서 관리한다. 현재 DB는 코드 목록을 FK나 enum으로 제한하지 않는다.
