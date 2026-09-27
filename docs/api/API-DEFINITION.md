# API정의서

기준일: 2026-09-27. 모바일 앱과 향후 웹의 공통 백엔드 계약이다.

외부 배포 기준 주소는 `https://mt0205.synology.me:23912`이며 REST 경로는 이 주소 뒤에 붙인다. 채팅 WebSocket은 `wss://mt0205.synology.me:23912`를 사용한다. TCP 80은 인증서 발급용이다. 현재 앱은 API 호출이 없으며 외부 주소의 실제 도달성은 포트포워딩 완료 후 검증한다.

| 범위 | 상태 | 상세 계약 | 코드 |
|---|---|---|---|
| 채팅 subject·방·메시지·첨부·읽음·WebSocket | 구현 | [CHAT-API.md](../CHAT-API.md) | `app/chat/api.py` |
| 헬스체크 `/health/live`, `/health/ready` | 구현 | [프로그램 명세서](../architecture/PROGRAM-SPEC.md) | `app/main.py` |
| 인증·카탈로그·서비스·견적·제안·리뷰·알림 등 | 제안, 미구현 | [API-SPEC.md](../API-SPEC.md) | 없음 |

주의: 초기 [API 초안](../API-SPEC.md)의 채팅 경로, 메시지 필드, WebSocket 방식은 현재 구현과 일부 다르다. 채팅 연동에는 [실제 채팅 API](../CHAT-API.md)를 사용한다. 향후 기능을 구현할 때 이 표의 상태를 갱신하고 초안과 실제 계약의 차이를 해소한다. 런타임 FastAPI `/openapi.json`은 구현된 REST 엔드포인트를 확인하는 보조 자료이며, WebSocket·업무 정책은 문서도 확인한다.

API 요청·응답의 구분값은 [코드인스턴스](../architecture/CODE-INSTANCES.md)에서 그룹별로 관리한다. 제안 코드와 실제 응답 코드의 차이를 확인한 뒤 클라이언트에 적용한다.

고객원장의 CI 조회와 사용자 ID 생성은 `app/accounts/identity.py`의 **내부 함수**로 구현했다. 제공자 토큰 검증, 카카오/네이버 로그인, 회원가입 및 JWT 발급 API는 아직 없다. 디버그 APK의 계정 선택은 로컬 UI 상태만 바꾸며 API나 DB에 테스트 CI를 전송하지 않는다. 향후 로그인 API에서는 제공자에서 검증한 CI만으로 `customers.ci_lookup_hash`를 조회하고 반환된 `user_id`를 세션/JWT `sub`로 사용한다.
