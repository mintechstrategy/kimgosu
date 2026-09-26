# 서비스순서도

기준일: 2026-09-27. `구현` 흐름과 `제안` 흐름을 분리한다. 미구현 업무 API를 현재 서비스에서 사용할 수 있다는 뜻이 아니다.

## 채팅방 생성과 메시지 전달 — 채팅 인프라 구현

```mermaid
sequenceDiagram
    participant Domain as 서비스 도메인(향후 구현)
    participant App as 앱/웹(향후 구현)
    participant API as FastAPI 채팅
    participant DB as PostgreSQL
    participant Redis as Redis
    Domain->>API: POST /api/v1/chat/subjects (서비스 권한)
    API->>DB: subject 등록/기존 확인
    App->>API: POST /api/v1/chat/rooms (JWT)
    API->>DB: subject 확인, 방·참여자 생성/재사용
    App->>API: POST /rooms/{id}/messages
    API->>DB: 참여자 검사, 메시지 저장
    API->>Redis: message.created 발행
    Redis-->>App: WebSocket 수신(일회용 티켓)
    App->>API: GET /rooms/{id}/messages (재연결 시 누락 복구)
```

## 소비자 견적 요청 → 고수 제안 — 화면 근거 기반 제안, 미구현

```mermaid
sequenceDiagram
    participant User as 일반 소비자
    participant App as 앱 UI
    participant Domain as 견적/제안 도메인(미구현)
    participant Expert as 고수
    participant Chat as 독립 채팅 도메인(구현)
    User->>App: 견적 요청 작성(C1)
    App->>Domain: 요청 등록(제안 API)
    Expert->>App: 해당 카테고리 견적 탐색(A3)
    App->>Domain: 제안 등록(제안 API)
    Domain->>Chat: 견적/제안 subject 등록
    Expert->>Chat: 채팅방 개설·첫 메시지
    Chat-->>User: 대화 참여·알림(알림 연동 미구현)
```

제안 자격, 제안 데이터·수락, 거래 확정 및 리뷰 순서는 [미결정 사항](../planning/DECISIONS.md) Q03–Q05가 정해진 뒤 상세화한다.
