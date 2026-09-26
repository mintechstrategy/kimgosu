# 채팅 API v1

모바일 앱과 향후 웹은 동일한 HTTP/JSON 및 WebSocket 계약을 사용한다. 화면 UI의 일반/고수 모드는 서버 권한과 무관하다. 모든 방·메시지 조회는 JWT 사용자와 방 참여 관계를 검사한다.

## 서비스 독립 관계

```text
서비스 도메인(service, quote_request, 미래 서비스)
  └─ 내부 연동: chat_subjects(subject_type, subject_id, owner_user_id)
       └─ chat_rooms(subject_id, initiated_by)
            ├─ chat_participants(room_id, user_id, last_read_message_id)
            └─ chat_messages(room_id, sender_user_id, client_message_id, body)
```

`subject_type + subject_id`는 서비스를 가리키는 안정적인 키다. 채팅 DB는 특정 서비스 테이블에 직접 묶이지 않는다. 각 서비스 도메인이 자체 리소스를 검증한 뒤 `chat:subjects:write` 권한으로 subject를 등록한다. 일반 사용자가 임의의 서비스나 소유자를 지정해 subject를 만들 수 없다. 한 subject에 대해 발신자별 방 하나가 생성되며 재요청 시 기존 방을 돌려준다. 같은 서비스에서 별도의 거래/사건마다 채팅방이 필요하면 해당 거래/사건을 별도 subject로 등록한다.

초기 버전은 2인 대화를 제공한다. 참가자 테이블은 이후 그룹 대화에도 확장할 수 있다. 현재 구현은 텍스트 메시지에 한정한다. 사진·파일 업로드는 파일 서비스와 권한 모델을 만든 뒤 메시지 첨부 관계로 추가한다. 결제·거래 상태는 채팅 테이블에 넣지 않는다.

## 인증

REST: `Authorization: Bearer <JWT>`. 검증 항목은 HS256 서명, `iss=kimgosu`, `aud=kimgosu-api`, `sub=UUID`, `iat`, `exp`. 현재 회원 가입/토큰 발급 API는 없으므로 실제 사용자 연결 시 인증 서비스가 이 계약으로 토큰을 발급해야 한다. `POST /subjects`는 추가로 `scope`에 `chat:subjects:write`가 필요하다. 테스트용 임의 사용자 ID를 받는 공개 API는 제공하지 않는다.

브라우저 WebSocket 연결은 먼저 Bearer 인증으로 `/rooms/{id}/ws-ticket`을 호출한다. 받은 티켓은 30초 유효하며 Redis에서 한 번만 사용할 수 있다. 웹의 허용 Origin은 `FRONTEND_ORIGINS`에 정확한 주소를 쉼표로 구분해 설정한다. 모바일의 Origin 없는 연결도 허용한다.

## 엔드포인트

기본 경로: `/api/v1/chat`

| Method | Path | 설명 |
|---|---|---|
| POST | `/subjects` | 서비스 도메인의 채팅 연결 등록/재확인. `{subjectType,subjectId,ownerUserId}`. 서비스 전용 권한 필요 |
| POST | `/rooms` | `{subjectId}`로 방 생성 또는 기존 방 반환. 본인 소유 subject는 거부 |
| GET | `/rooms?limit=20&cursor=` | 내가 참여한 방과 안 읽은 수 조회. `nextCursor`로 다음 페이지 |
| GET | `/rooms/{id}` | 방과 subject, 참여자 조회 |
| GET | `/rooms/{id}/messages?limit=30&before=` | 시간순 메시지. `nextCursor`는 다음 요청의 `before` 값 |
| POST | `/rooms/{id}/messages` | `{clientMessageId:UUID,text}`. 동일 클라이언트 ID 재시도는 기존 메시지 반환; 다른 내용이면 409 |
| POST | `/rooms/{id}/read` | `{throughMessageId}`까지 읽음. 상태는 뒤로 가지 않음 |
| POST | `/rooms/{id}/ws-ticket` | 참여자에게 30초짜리 일회용 티켓 발급 |
| WS | `/ws/rooms/{id}?ticket=` | `message.created`, `message.read` 이벤트 수신 |

WebSocket은 수신 전용이다. 쓰기는 REST에서 DB에 확정한 뒤 Redis로 알린다. 일시적인 Redis 이벤트 누락이나 재연결 시 `GET /messages`로 서버 기록을 다시 읽는다. 여러 FastAPI 프로세스 사이의 이벤트 전달에도 Redis를 사용한다. 메시지 본문은 1–4000자, 공백만 있는 본문은 거부한다.

방이 없거나 요청자가 참여하지 않은 경우 둘 다 404를 반환한다. 인증 누락/만료는 401, 서비스 등록 권한 부족은 403이다. 서비스 subject의 소유자 변경은 채팅 참여자를 자동 변경하지 않으므로 409로 거부한다.

## 검증

격리된 Compose 스택에서 방 재사용, 비참여자 차단, 중복 전송, 읽음·목록 페이지, 브라우저용 티켓, Nginx를 통과하는 WebSocket 실시간 수신을 검증한다. CI도 동일한 테스트를 수행한다.
