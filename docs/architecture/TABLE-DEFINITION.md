# 테이블정의서

기준일: 2026-09-27. 실제 스키마의 기준은 Alembic `0002_chat`, `0003_chat_attachments`다. `0001_bootstrap`은 테이블을 만들지 않는다. 업무 도메인 테이블은 아직 없다.

| 테이블 | 주요 컬럼(형식) | 키·관계·제약 | 용도 |
|---|---|---|---|
| `chat_subjects` | `id uuid`, `subject_type varchar(80)`, `subject_id uuid`, `owner_user_id uuid`, `active bool`, `created_at timestamptz` | PK `id`; UQ `(subject_type, subject_id)`; type 형식 검사 | 미래의 모든 서비스 리소스를 채팅에 연결 |
| `chat_rooms` | `id uuid`, `subject_id uuid`, `initiated_by uuid`, `created_at`, `last_message_at` | PK `id`; FK subject RESTRICT; UQ `(subject_id, initiated_by)` | 대상·발신자별 방 |
| `chat_participants` | `room_id uuid`, `user_id uuid`, `joined_at`, `last_read_message_id uuid` | PK `(room_id,user_id)`; FK room CASCADE, 읽음 메시지 SET NULL | 참여자·읽음 위치 |
| `chat_messages` | `id uuid`, `room_id uuid`, `sender_user_id uuid`, `client_message_id uuid`, `body text`, `created_at` | PK `id`; FK room CASCADE; `(room_id,sender_user_id)` 참가자 FK; UQ `(room_id,sender_user_id,client_message_id)`; 본문 최대 4000자 | 메시지·재시도 중복 방지 |
| `chat_attachments` | `id uuid`, `room_id uuid`, `uploader_user_id uuid`, `message_id uuid nullable`, `filename varchar(255)`, `content_type varchar(255)`, `byte_size bigint`, `created_at` | PK `id`; FK room CASCADE, message SET NULL, 참가자 FK; 크기 1–104857600 byte | 비공개 파일 메타데이터 |

사용자/서비스/견적 테이블에 대한 FK가 없는 것은 채팅 모듈의 도메인 독립 설계 때문이다. 실제 계정 도메인이 구현되면 사용자 삭제·익명화 정책과 참조 무결성 방식을 [결정 기록](../planning/DECISIONS.md)에 따라 확정한다. 전체 컬럼 기본값과 인덱스는 마이그레이션 원문을 최종 기준으로 한다.
