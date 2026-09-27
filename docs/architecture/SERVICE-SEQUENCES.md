# 서비스순서도

기준일: 2026-09-27. 사용자가 제공한 `서비스순서도.png`의 **화면 이동 흐름**을 먼저 기록하고, 아래에 시스템 상호작용을 분리한다. 화면 간 화살표는 구현 완료나 업무 규칙 확정을 뜻하지 않는다.

## 전체 서비스 화면 흐름 — 제공된 순서도 근거, 일부 구현

2026-09-27 사용자 지시로 원본 순서도 앞에 `스플래시 S0 → 앱 내 500ms → 디버그 전용 T1 테스트 계정 선택 → 메인 T0/A1`을 추가했다. 릴리스 빌드는 T1을 건너뛴다. Android 디버그 APK에서 [스플래시](../previews/android-splash-view.png), [계정 선택](../previews/android-test-account.png), [홈](../previews/android-test-expert-home.png)을 확인했다. OS 콜드 스타트 시간은 500ms에 포함되지 않는다. 하단 독바는 원본 순서도의 홈·검색·등록·채팅·마이를 따른다. 홈 외의 탭과 상세 이동은 이번 APK에서 아직 연결하지 않았다.

```mermaid
sequenceDiagram
    participant Person as 테스트 담당자
    participant APK as 디버그 APK
    participant Home as A1 홈
    Person->>APK: 앱 시작
    APK->>APK: 스플래시 약 500ms
    APK-->>Person: T1 일반 2명/고수 2명 선택
    Person->>APK: 합성 테스트 계정 선택
    APK->>Home: 로컬 신원 설정 후 홈 표시
    Note over APK,Home: 서버 로그인/JWT/CI 전송 없음
```

```mermaid
flowchart LR
    Start([START]) --> Tabs[독바: 홈/검색/등록/채팅/마이]
    Tabs --> Home[A1 홈]
    Home --> Category[카테고리]
    Category -->|대면 서비스| Region[A2 위치 설정]
    Region --> List[A3 서비스 리스트]
    Category -->|비대면 등| List
    Home -->|최근 등록/인기/최근 검색 서비스| List
    List -->|전문가 서비스| Service[A5 서비스 상세]
    List -->|견적 요청| Quote[A4 견적 상세]
    Service -->|찜하기| Favorites[F4 찜한 전문가]
    Service -->|문의하기| Room[D2 채팅방]
    Quote -->|제안하기| Room
    Tabs --> Search[B1 검색]
    Search -->|일치 카테고리 있음| List
    Search -->|없음| Recommend[B2 연관 추천]
    Tabs --> Gate{로그인 했음?}
    Gate -->|아니요| Login[E1 카카오/네이버 로그인]
    Login -->|최초 가입| Signup[E2 약관/SMS 인증]
    Signup --> Gate
    Gate -->|예: 등록| CreateQuote[C1 견적 등록]
    Gate -->|예: 채팅| Rooms[D1 채팅 목록]
    Rooms --> Room
    Room --> Review[D3 리뷰]
    Gate -->|예: 마이| My[F1 마이페이지]
    My --> Manage[F2 견적/서비스 관리]
    Manage -->|나의 서비스| CreateService[F3 서비스 등록]
    My --> Favorites
    My --> Notice[F4 알림설정]
    My --> Help[F6 고객센터]
    My --> Withdraw[F5 회원 탈퇴]
    CreateQuote --> Manage
```

원본은 `F4`를 **알림설정**과 **찜한 전문가**에 중복 표기한다. 위 그래프의 `F4` 두 노드는 같은 화면이라고 확정한 것이 아니다. [화면설계서](../planning/SCREEN-DESIGN.md)에서 임시 식별자로 구분하며, 원본 화면 ID 정정이 필요하다. 원본의 점선은 `문의하기/제안하기 → 채팅방`, `찜하기 → 찜한 전문가` 연결로 해석했다. 대면 서비스에 위치 설정이 붙는 점과 최초 가입에만 E2가 붙는 점은 그림에 명시되어 있다. `B2` 추천 이후의 목적지, 로그인 후 원래 행동으로 돌아가는 정확한 방식, 리뷰 자격 조건은 그림에 표시되지 않았다.

### 화면 이동 요약

| 시작 | 조건/행동 | 도착 | 근거 상태 |
|---|---|---|---|
| 홈 A1 | 카테고리 선택, 대면 서비스 | 위치 설정 A2 → 리스트 A3 | 순서도 명시 |
| 홈 A1 | 최근 등록·비대면 인기·최근 검색 서비스 선택 | 서비스 탐색/상세 | 순서도 연결. 세부 목적지는 원본 재확인 필요 |
| 검색 B1 | 일치 카테고리 있음/없음 | 리스트 A3 / 연관 추천 B2 | 순서도 명시 |
| 리스트 A3 | 전문가 서비스/견적 요청 선택 | 서비스 상세 A5 / 견적 상세 A4 | 순서도 명시 |
| 상세 A5/A4 | 문의하기/제안하기 | 채팅방 D2 | 점선 연결, 서버 연동 미구현 |
| 등록·채팅·마이 탭 | 미로그인 | E1 로그인, 최초 가입은 E2 약관·SMS | 순서도 명시 |
| 채팅 목록 D1 | 방 선택 | 채팅방 D2 → 리뷰 D3 | 순서도 명시, 리뷰 조건 미결정 |
| 마이 F1 | 관리/찜/알림/고객센터/탈퇴 | F2, F4(찜), F4(알림), F6, F5 | 순서도 명시, F4 중복 |

## 시스템 상호작용 — 현재 구현과 계획 구분

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
