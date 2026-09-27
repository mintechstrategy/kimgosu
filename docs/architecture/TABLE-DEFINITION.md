# 테이블정의서

기준일: 2026-09-28. 실제 스키마의 기준은 Alembic `0002_chat`~`0008_completion_reviews`다. `0001_bootstrap`은 테이블을 만들지 않는다. 운영 DB는 `0008`까지 적용했다.

| 테이블 | 주요 컬럼(형식) | 키·관계·제약 | 용도 |
|---|---|---|---|
| `customers` | `user_id varchar(80)`, `ci_lookup_hash char(64)`, `customer_name varchar(100)`, `birth_date date`, `home_address varchar(500)`, `phone_number varchar(30)`, `expert_enabled bool`, `created_at`, `updated_at timestamptz` | PK `user_id`; **unique index** `uq_customers_ci_lookup_hash`; 사용자 ID·해시·이름 형식 검사 | 고객원장. CI 조회로 사용자 ID 찾기. CI 원문 미저장. 기존 행의 새 프로필 컬럼은 nullable |
| `service_categories` | `code varchar(40)`, `display_name varchar(80)`, `display_order integer`, `icon_key varchar(40)`, `is_visible boolean`, `updated_at timestamptz` | PK `code`; UQ `display_order`; 코드 형식, 명칭 비어 있지 않음, 순서 양수 검사 | 홈 분야 C영역의 관리 코드. `기타` 없이 7개 초기값. 관리자 변경 시 이 테이블에서 명칭·순서·노출·아이콘 관리 |
| `services` | `id uuid`, `owner_user_id`, `category_code`, `title`, `description`, `service_mode`, `region_name`, `price_from`, `status`, 생성·수정시각 | PK `id`; 고객·카테고리 FK; 가격 음수 금지; `active/hidden/deleted`; 분야·생성시각 및 작성자 인덱스 | 고수 서비스 등록·탐색·문의 연결. 삭제 시 기존 채팅 참조 보존 |
| `quote_requests` | `id uuid`, `owner_user_id`, `category_code`, `title`, `description`, `service_mode`, `region_name`, `budget_max`, `status`, 생성·수정시각 | PK `id`; 고객·카테고리 FK; 예산 음수 금지; `open/closed/deleted`; 분야·생성시각 및 작성자 인덱스 | 소비자 견적 요청·탐색·마감. 삭제 시 기존 제안·채팅 참조 보존 |
| `proposals` | `id uuid`, `quote_request_id`, `expert_user_id`, `service_id`, `room_id`, `created_at` | PK `id`; 견적·고객·서비스·채팅방 FK; `(quote_request_id,expert_user_id)` 고유 | 고수당 견적별 한 제안과 채팅방 연결 |
| `service_favorites` | `user_id`, `service_id`, `created_at` | 복합 PK `(user_id,service_id)`; 고객·서비스 FK | 찜한 서비스 |
| `chat_subjects` | `id uuid`, `subject_type varchar(80)`, `subject_id uuid`, `owner_user_id varchar(80)`, `active bool`, `created_at timestamptz` | PK `id`; UQ `(subject_type, subject_id)`; type 형식 검사 | 미래의 모든 서비스 리소스를 채팅에 연결 |
| `chat_rooms` | `id uuid`, `subject_id uuid`, `initiated_by varchar(80)`, `created_at`, `last_message_at` | PK `id`; FK subject RESTRICT; UQ `(subject_id, initiated_by)` | 대상·발신자별 방 |
| `chat_participants` | `room_id uuid`, `user_id varchar(80)`, `joined_at`, `last_read_message_id uuid` | PK `(room_id,user_id)`; FK room CASCADE, 읽음 메시지 SET NULL | 참여자·읽음 위치 |
| `chat_messages` | `id uuid`, `room_id uuid`, `sender_user_id varchar(80)`, `client_message_id uuid`, `body text`, `created_at` | PK `id`; FK room CASCADE; `(room_id,sender_user_id)` 참가자 FK; UQ `(room_id,sender_user_id,client_message_id)`; 본문 최대 4000자 | 메시지·재시도 중복 방지 |
| `chat_attachments` | `id uuid`, `room_id uuid`, `uploader_user_id varchar(80)`, `message_id uuid nullable`, `filename varchar(255)`, `content_type varchar(255)`, `byte_size bigint`, `created_at` | PK `id`; FK room CASCADE, message SET NULL, 참가자 FK; 크기 1–104857600 byte | 비공개 파일 메타데이터 |
| `chat_completion_confirmations` | `room_id uuid`, `user_id varchar(80)`, `confirmed_at timestamptz` | PK `(room_id,user_id)`; 동일 복합키로 `chat_participants` FK RESTRICT | 일반/고수 구분 없이 모든 2인 채팅방의 거래 완료 확인. 양측 행이 있을 때 완료 |
| `reviews` | `id uuid`, `room_id uuid`, `reviewer_user_id`, `target_user_id varchar(80)`, `rating smallint`, `body text`, `created_at timestamptz` | PK `id`; UQ `(room_id,reviewer_user_id)`; 방·양측 참가자 FK; 자신 리뷰 금지; 점수 1–5, 본문 10–1000자; 대상·시각 인덱스 | 양측 완료 확인 후 방당 각 참가자 1회 리뷰. 서비스 종류와 무관 |

`customers.user_id`가 고객원장의 PK다. `ci_lookup_hash`는 서버 전용 비밀키로 검증된 CI에 HMAC-SHA256을 적용한 64자리 값이며, 고유 인덱스로 CI를 빠르게 역조회한다. 원문 CI는 DB에 저장하지 않는다. 비밀키는 Compose secret `secrets/ci_lookup_key.txt`에서 읽는다. 키 교체·재계산 절차와 제공자 CI 제공 조건은 실제 간편인증 연동 전에 결정해야 한다. `0005`는 기존 행을 유지하기 위해 새 프로필 값을 nullable로 추가하고 `expert_enabled`의 기본값을 `false`로 한다.

채팅 사용자 ID 컬럼은 `0004`에서 기존 UUID를 문자열로 보존하며 `varchar(80)`으로 바뀐다. 채팅은 서비스·견적 및 고객원장에 FK를 직접 두지 않아 도메인 독립을 유지한다. 실제 계정 삭제·익명화 정책과 참조 무결성은 [결정 기록](../planning/DECISIONS.md)에 따라 확정한다. 전체 컬럼 기본값과 인덱스는 마이그레이션 원문을 최종 기준으로 한다.

`chat_subjects.subject_type`의 형식과 향후 등록되는 값은 [코드인스턴스](CODE-INSTANCES.md)의 `CHAT_SUBJECT_TYPE` 그룹에서 관리한다. 현재 DB는 코드 목록을 FK나 enum으로 제한하지 않는다.
