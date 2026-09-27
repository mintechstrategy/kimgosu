# API정의서

기준일: 2026-09-27. 모바일 앱과 향후 웹의 공통 백엔드 계약이다.

현재 외부 기준 주소 `http://mt0205.synology.me:23912`의 `/health/ready`는 200으로 확인했다. 같은 주소의 HTTPS는 TLS 연결에 실패한다. 외부 HTTP에서는 인증·고객 API를 Nginx가 404로 차단한다. 합성 계정용 디버그 APK는 LAN 전용 `http://192.168.0.213:23913` API에 접속한다. 실제 CI·토큰·개인정보를 외부에서 전송하기 전 HTTPS/WSS를 구성해야 한다.

| 범위 | 상태 | 상세 계약 | 코드 |
|---|---|---|---|
| 채팅 subject·방·메시지·첨부·읽음·WebSocket | 구현 | [CHAT-API.md](../CHAT-API.md) | `app/chat/api.py` |
| 헬스체크 `/health/live`, `/health/ready` | 구현 | [프로그램 명세서](../architecture/PROGRAM-SPEC.md) | `app/main.py` |
| 디버그 테스트 로그인·고객 프로필 | 구현 | 아래 계약. 테스트 로그인은 `TEST_LOGIN_ENABLED=true`일 때만 동작하며 외부 프록시는 차단 | `app/accounts/api.py` |
| 홈 분야 코드 조회 | 구현 | `GET /api/v1/catalog/home-categories` — 공개 읽기 전용, 노출 중인 코드를 `displayOrder`, `code`순 반환 | `app/catalog/api.py` |
| 실제 OAuth·서비스 목록/검색·견적·제안·리뷰·알림 등 | 제안, 미구현 | [API-SPEC.md](../API-SPEC.md) | 없음 |

주의: 초기 [API 초안](../API-SPEC.md)의 채팅 경로, 메시지 필드, WebSocket 방식은 현재 구현과 일부 다르다. 채팅 연동에는 [실제 채팅 API](../CHAT-API.md)를 사용한다. 향후 기능을 구현할 때 이 표의 상태를 갱신하고 초안과 실제 계약의 차이를 해소한다. 런타임 FastAPI `/openapi.json`은 구현된 REST 엔드포인트를 확인하는 보조 자료이며, WebSocket·업무 정책은 문서도 확인한다.

API 요청·응답의 구분값은 [코드인스턴스](../architecture/CODE-INSTANCES.md)에서 그룹별로 관리한다. 제안 코드와 실제 응답 코드의 차이를 확인한 뒤 클라이언트에 적용한다.

`POST /api/v1/auth/test-login`은 합성 CI 네 개 중 하나를 `{ "ci": "TEST-CI-KIMGOSU-CONSUMER-001" }`로 받는다. 기존 CI면 같은 `userId`를 찾고 신규면 `test_` 접두어 ID를 발급한다. 응답은 `accessToken`(HS256 JWT), `tokenType=Bearer`, `expiresIn=3600`, `customer` 객체다. 알 수 없는 CI는 401, 기능 비활성은 404다. 실제 제공자 토큰 검증용 API는 아니다.

`GET /api/v1/customers/me`는 Bearer JWT의 `sub`에 대응하는 고객원장을 반환한다. `PATCH /api/v1/customers/me`는 `customerName`, `birthDate`, `homeAddress`, `phoneNumber`의 제공된 필드만 수정하고 같은 고객 객체를 반환한다. 고객 객체는 `userId`, 위 프로필 필드, `expertEnabled`, `createdAt`, `updatedAt`을 포함하며 원문 CI와 해시는 반환하지 않는다. 제공자 검증·카카오/네이버 실제 OAuth는 아직 구현하지 않았다. CI 조회와 사용자 ID 발급은 `app/accounts/identity.py`의 내부 함수가 담당한다.

홈 분야 조회 응답은 배열이며 항목마다 `code`, `displayName`, `displayOrder`, `iconKey`를 포함한다. DB의 `is_visible=false` 항목은 응답에서 빠진다. 클라이언트는 응답 순서를 그대로 표시하고, 네트워크 실패 시 APK에 포함된 초기 7개 코드 스냅샷을 사용한다. 카테고리 조회는 개인 정보를 사용하지 않는 공개 API다. 관리자용 쓰기 API와 권한 체계는 관리자 웹 개발 시 별도로 정의한다.
