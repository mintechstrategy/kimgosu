# API정의서

기준일: 2026-09-27. 모바일 앱과 향후 웹의 공통 백엔드 계약이다.

| 범위 | 상태 | 상세 계약 | 코드 |
|---|---|---|---|
| 채팅 subject·방·메시지·첨부·읽음·WebSocket | 구현 | [CHAT-API.md](../CHAT-API.md) | `app/chat/api.py` |
| 헬스체크 `/health/live`, `/health/ready` | 구현 | [프로그램 명세서](../architecture/PROGRAM-SPEC.md) | `app/main.py` |
| 인증·카탈로그·서비스·견적·제안·리뷰·알림 등 | 제안, 미구현 | [API-SPEC.md](../API-SPEC.md) | 없음 |

주의: 초기 [API 초안](../API-SPEC.md)의 채팅 경로, 메시지 필드, WebSocket 방식은 현재 구현과 일부 다르다. 채팅 연동에는 [실제 채팅 API](../CHAT-API.md)를 사용한다. 향후 기능을 구현할 때 이 표의 상태를 갱신하고 초안과 실제 계약의 차이를 해소한다. 런타임 FastAPI `/openapi.json`은 구현된 REST 엔드포인트를 확인하는 보조 자료이며, WebSocket·업무 정책은 문서도 확인한다.
