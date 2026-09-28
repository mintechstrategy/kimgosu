# 코드인스턴스

기준일: 2026-09-28. 이 문서의 **코드**는 테이블 컬럼 또는 API 필드에 저장·전달하는 구분값이다. 소스 파일 목록이나 Docker 컨테이너 목록을 뜻하지 않는다. 코드값의 영문 표기는 저장/전송값이며, 화면 문구는 별도로 현지화한다.

## 코드 관리 원칙

- 코드 그룹 ID를 고정하고 값의 의미, 사용 위치, 상태, 출처를 함께 기록한다. 값의 이름을 바꾸거나 삭제하면 기존 DB 데이터와 앱/웹 클라이언트에 영향이 있으므로 호환·마이그레이션 계획을 먼저 적는다.
- `구현`은 현재 코드·DB에서 실제로 쓰는 값, `제안`은 API 초안에만 있는 값이다. 제안값은 구현 계약이 아니다.
- 사용자가 추가할 수 있는 카테고리·지역·리뷰 태그 같은 **기준정보 목록**은 이 문서에 임의로 열거하지 않는다. 해당 테이블과 운영 정책이 생기면 코드 그룹인지 기준정보인지 결정한다.
- 현재 `common_codes` 같은 공통 코드 테이블은 없다. 아래 구현값은 채팅 스키마의 문자열 필드 또는 API/이벤트에서 사용한다.

## 구현된 코드 그룹

| 그룹 ID | 사용 위치 | 값 | 의미 | 근거·제약 |
|---|---|---|---|---|
| `CHAT_EVENT_TYPE` | WebSocket 이벤트 `type` | `message.created` | 새 메시지 저장 후 통지 | `app/chat/api.py`, [채팅 API](../CHAT-API.md) |
| `CHAT_EVENT_TYPE` | WebSocket 이벤트 `type` | `message.read` | 읽음 위치 변경 후 통지 | `app/chat/api.py`, [채팅 API](../CHAT-API.md) |
| `CHAT_SUBJECT_TYPE` | `chat_subjects.subject_type`, API `subjectType` | `service`, `quote_request` | 서비스 문의 또는 견적 제안 채팅의 연결 대상 | `app/marketplace/api.py`; 추가 서비스도 같은 독립 subject 계약 사용 |
| `CHAT_SCOPE` | JWT `scope` | `chat:subjects:write` | 신뢰된 서비스의 채팅 subject 등록 권한 | `app/chat/auth.py` |
| `HEALTH_STATUS` | `/health/live`, `/health/ready`의 `status` | `ok` | 프로세스 생존 | `app/main.py` |
| `HEALTH_STATUS` | `/health/ready`의 `status` | `ready` | DB·Redis 사용 가능 | `app/main.py` |
| `HEALTH_STATUS` | `/health/ready`의 `status` | `not_ready` | DB 또는 Redis 준비 실패, HTTP 503 | `app/main.py` |
| `CUSTOMER_ID_PREFIX` | `customers.user_id` | `kakao`, `naver` | 신규 가입을 처음 처리한 간편인증 제공자 | `app/accounts/identity.py`. 형식은 `접두어_32자리hex`; 다른 제공자 추가 가능 |
| `CUSTOMER_ID_PREFIX` | `customers.user_id`, 테스트 로그인 API 응답 `customer.userId` | `test` | 실제 제공자 인증이 없는 합성 계정. 서버가 `test_32자리hex`로 채번 | `app/accounts/identity.py`, `app/accounts/api.py`; 릴리스 APK에는 합성 CI가 없음 |
| `HOME_CATEGORY` | `service_categories.code`, 카탈로그 API `code` | `design_development`, `video_editing`, `translation`, `legal`, `cleaning_interior`, `pets`, `hair_beauty` | 홈 분야 C영역의 디자인/개발, 영상편집, 번역, 법률, 청소/인테리어, 반려, 헤어/미용 | `0006_service_categories.py`; `기타`는 초기 코드에서 제외 |
| `CATEGORY_ICON_KEY` | `service_categories.icon_key`, 카탈로그 API `iconKey` | `pencil`, `video`, `language`, `scales`, `broom`, `paw`, `scissors` | 앱의 직관적인 분야 아이콘 선택 | `HomeCategories.java`; 알 수 없는 값은 일반 아이콘으로 표시 |
| `SERVICE_MODE` | `services.service_mode`, `quote_requests.service_mode`, 쓰기 API `mode` | `remote`, `onsite` | 비대면, 대면 | `0007_marketplace.py`, `app/marketplace/api.py` |
| `SERVICE_STATUS` | `services.status`, 목록 API `status` | `active`, `hidden`, `deleted` | 노출 중, 작성자가 숨김, 작성자가 삭제 | `0007_marketplace.py`, `0008_completion_reviews.py`; 삭제는 채팅 보존을 위한 논리 삭제 |
| `QUOTE_REQUEST_STATUS` | `quote_requests.status`, 목록 API `status` | `open`, `closed`, `deleted` | 제안 접수 중, 작성자 마감, 작성자 삭제 | `0007_marketplace.py`, `0008_completion_reviews.py`; 마감 후 제안 거부, 삭제는 논리 삭제 |
| `REVIEW_RATING` | `reviews.rating`, 리뷰 API `rating` | 정수 `1`–`5` | 양측 완료 확인 뒤 상대방에게 남기는 평점 | `0008_completion_reviews.py`, `app/marketplace/reviews.py` |
| `SUPPORT_TICKET_STATUS` | `support_tickets.status`, 고객센터 API `status` | `open` | 고객센터 문의가 접수된 상태. 운영자 처리 상태는 관리자 정책 확정 후 확장 | `0010_support_tickets.py`, `app/support/api.py` |

`CHAT_SUBJECT_TYPE`은 자유 형식 문자열이지만, 서비스 연동 시 의미가 바뀌면 기존 방의 연결 대상 해석이 달라진다. 새 도메인이 추가되면 이 문서에 값과 소유 서비스를 기록한다.

## 제안 단계의 코드 그룹 — 아직 DB/API 미구현

| 그룹 ID | 사용 예정 위치 | 제안값 | 의미 | 근거·결정 필요 사항 |
|---|---|---|---|---|
| `SERVICE_PACKAGE_TIER` | 서비스 `packages[].tier` | `basic`, `prime`, `super` | 서비스 패키지 등급 | [API 초안](../API-SPEC.md). 명칭·필수 등급 확인 필요 |
| `SERVICE_SORT` | 서비스 목록 `sort` | `recent`, `popular` | 최신순, 인기순 | [API 초안](../API-SPEC.md). 인기 산식 미결정 |
| `API_ERROR_CODE` | 공통 오류 응답 `code` | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `BLOCKED_CONTENT` | 오류 유형 | [API 초안](../API-SPEC.md). 현재 채팅 구현은 FastAPI 기본 오류 응답을 사용하므로 이 코드 문자열을 반환하지 않음 |

이 표는 업무 정책을 확정한 후 실제 컬럼·API 필드와 1:1로 대조해 확장한다. `closingDays=3/7/14`는 견적 입력 규칙 후보로 [API 초안](../API-SPEC.md)에 있으나 상태 코드 그룹은 아니다.

사용자 ID의 접두어는 **가입 시점 제공자 표시**이며 이후 동일 CI로 다른 제공자를 이용해도 PK를 바꾸지 않는다. 소비자/고수는 이 접두어로 구분하지 않는다. `TEST_ACCOUNT_MODE`의 `일반`·`고수`는 현재 디버그 UI에만 쓰는 표시값이며 DB/API 코드가 아니다.
