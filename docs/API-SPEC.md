# 김고수 API 명세 초안 v0.1

기준 자료: `화면설계써_최종.fig`의 김고수 화면과 기능정의 텍스트. 파일에는 식단·목표 관리 등 다른 서비스로 보이는 화면도 포함되어 있어 김고수와 직접 연결되는 기능만 반영했다. 화면 번호 A1–A5, B1–B2, C1, D1–D3, E1–E2, F1–F6을 근거로 삼았다. 아래 URL·필드명·HTTP 상태는 서버 구현을 위한 **제안**이며, 화면설계서에 API 형식이 명시된 것은 아니다. 현재 코드는 채팅 API와 `/health/live`, `/health/ready`를 제공한다. 다른 업무 API는 아직 구현되지 않았다.

채팅 API의 구현 계약과 현재 지원 범위는 [CHAT-API.md](CHAT-API.md)를 따른다. 채팅은 화면설계서의 서비스 문의 흐름에서 시작하지만, 모든 서비스 도메인이 동일한 `chat_subjects` 연결을 사용할 수 있도록 독립 모듈로 구현한다.

## 공통 계약

- 기본 경로 `/api/v1`, JSON UTF-8, 시간은 ISO 8601 UTC, 금액은 원 단위 정수.
- 사용자 계정 하나로 일반·고수 UI를 사용한다. `activeMode`는 앱 표시 상태이며 서버 권한 근거가 아니다. 서비스 작성자, 견적 작성자, 채팅 참여자를 요청마다 검사한다.
- 목록은 `limit`(기본 20, 최대 50)과 `cursor`를 사용하고 `{items, nextCursor}`를 반환한다. 모든 ID는 서버 발급 UUID로 제안한다.
- 로그인 필요 API는 `Authorization: Bearer <accessToken>`을 사용한다. 미로그인 검색·상세 조회는 허용한다.
- 쓰기 요청 중 재시도가 가능한 생성 API는 `Idempotency-Key`를 받는다. 같은 키의 중복 요청은 기존 결과를 반환한다.
- 공통 오류 형식: `{code, message, details?, requestId}`. 기본 오류는 `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `429 RATE_LIMITED`. 화면에서 비속어 검사가 지정된 입력은 `422 BLOCKED_CONTENT`를 사용한다.
- 공개 상세 응답에서는 탈퇴·삭제된 사용자의 개인정보를 반환하지 않는다. 파일 URL은 권한 검사 후 짧게 유효한 다운로드 URL을 발급한다.

## 화면 흐름과 API

### 홈·지역·검색 — A1, A2, A3, B1, B2

| Method | Path | 화면 동작 | 주요 입력 → 응답 |
|---|---|---|---|
| GET | `/catalog/categories` | 전체·인기 카테고리 | `mode=remote/onsite/all` → `id,name,serviceMode,popularityRank` |
| GET | `/catalog/regions` | 시·도 및 시·군·구 선택 | `parentId?` → `id,name,parentId` |
| GET | `/home` | 홈의 최근 서비스·인기 서비스 | `regionIds?` → `recentServices,popularRemoteServices,popularCategories`; 지역 미설정 시 비대면 서비스 중심 |
| GET | `/search/suggestions` | 검색어·연관 카테고리 | `q`(공백 제외 1자 이상) → `categories,recentQueries,popularQueries` |
| GET | `/services` | 서비스 목록 | `categoryId,regionIds?,mode?,sort=recent/popular,cursor,limit` → 서비스 카드 목록 |
| GET | `/quote-requests` | 견적 요청 목록 | `categoryId?,regionIds?,status=open/closed,sort=recent,cursor,limit` → 견적 카드 목록 |
| PUT | `/me/search-history/{query}` | 최근 검색어 기록 | 로그인 사용자만 저장, 같은 검색어는 최신 기록으로 갱신 |
| GET | `/me/search-history` | 최근 검색어 | 최근순 목록 |
| DELETE | `/me/search-history/{query}` | 최근 검색어 삭제 | `204` |
| PUT | `/me/regions` | 내 서비스 검색 지역 설정 | `{regionIds}` → 선택 지역 |

비대면 카테고리는 지역 선택을 생략한다. 대면 카테고리는 지역을 받아 결과를 제한한다. 앱은 미로그인 상태의 지역 선택을 로컬에 보관할 수 있으나, 서버는 요청의 `regionIds`를 이용한다. 검색어가 카테고리와 일치하지 않으면 API는 빈 `categories`와 추천 결과를 반환하고 앱이 B2 화면을 보여준다.

### 회원·인증·마이 — E1, E2, F1, F4, F5, F6

| Method | Path | 화면 동작 | 주요 입력 → 응답 |
|---|---|---|---|
| POST | `/auth/oauth/{provider}/exchange` | 카카오·네이버 로그인 | `{authorizationCode,redirectUri,codeVerifier?}` → 신규/기존 회원 구분, 임시 가입 토큰 또는 세션 토큰 |
| POST | `/auth/sms/challenges` | 휴대전화 인증번호 전송 | `{phoneNumber}` → `challengeId,expiresAt`; 발송 횟수 제한 |
| POST | `/auth/sms/challenges/{id}/verify` | 인증번호 확인 | `{code}` → `verifiedPhoneToken` |
| POST | `/auth/signup` | 약관·SMS 인증 후 가입 | `{signupToken,verifiedPhoneToken,requiredConsentVersion,marketingConsent}` → 토큰·회원 |
| POST | `/auth/refresh` | 세션 갱신 | refresh token → 새 토큰 |
| POST | `/auth/logout` | 로그아웃 | 현재 refresh token 폐기 |
| GET | `/me` | 마이페이지·프로필 | 회원·닉네임·역할별 현황 |
| PATCH | `/me` | 프로필 수정 | `{nickname,avatarFileId?,intro?}` → 수정된 프로필 |
| GET | `/me/consents` | 약관 동의 이력 | 약관 버전·동의 시각 |
| GET/PATCH | `/me/notification-settings` | 알림 설정 | 채팅·댓글·신규 견적·문의/제안·마케팅 설정. 마케팅 푸시는 동의가 있을 때만 켤 수 있음 |
| POST | `/support/tickets` | 고객센터 문의 | `{replyEmail,title,body}` → `ticketId`; 제목 최대 100자, 내용 최대 1000자 |
| DELETE | `/me` | 회원 탈퇴 | `{reason,details?,acknowledged:true}` → `204` |

OAuth redirect URI, SMS 제공사, 토큰 저장 방식은 개발 설정에서 결정한다. 탈퇴 시 본인 프로필·서비스·견적·찜·소셜 연결을 비활성화/삭제하되, 상대방에게 남는 채팅에서는 작성자를 “알 수 없는 사용자”로 처리한다. 데이터의 물리 삭제 시점은 개인정보 정책 확정이 필요하다.

### 고수 서비스 등록·상세·찜 — A5, F2, F3, F4

| Method | Path | 화면 동작 | 주요 입력 → 응답 |
|---|---|---|---|
| POST | `/uploads` | 서비스·견적·채팅 사진/파일 업로드 | multipart `file,purpose` → `fileId`; 목적별 형식·크기 검사 |
| POST | `/services` | 고수 서비스 등록 | 아래 `ServiceWrite` → `serviceId,status` |
| GET | `/services/{serviceId}` | 서비스 상세·패키지·고수 소개 | `ServiceDetail`, 댓글·리뷰 요약 |
| PATCH | `/services/{serviceId}` | 내 서비스 수정 | `ServiceWrite` 일부 필드; 작성자만 |
| DELETE | `/services/{serviceId}` | 내 서비스 삭제 | `204`; 기존 채팅 연결은 기록 유지 |
| GET | `/me/services` | 나의 서비스 관리 | `status?,cursor,limit` → 카드 목록·문의 수 |
| PUT | `/services/{serviceId}/favorite` | 찜하기 | `204` |
| DELETE | `/services/{serviceId}/favorite` | 찜 해제 | `204` |
| GET | `/me/favorites` | 찜한 전문가/서비스 | 최근 찜한 순, 삭제·탈퇴 서비스 제외 |
| GET | `/services/{serviceId}/comments` | 서비스 댓글 | 페이지 목록 |
| POST | `/services/{serviceId}/comments` | 서비스 댓글 작성 | `{body}` → 댓글 |

`ServiceWrite` 제안: `{title,categoryId,mode:"remote"|"onsite",regionIds,coverFileIds,intro,description,cautions,packages:[{tier:"basic"|"prime"|"super",price,description}]}`. 사진 최소 1장, 패키지 최대 3개. `onsite`는 지역 필수, `remote`는 지역 생략. Basic 패키지는 필수이고 나머지 패키지를 추가했다면 가격·설명을 모두 입력해야 한다. 자기 서비스 문의/찜 등 제한은 서버에서 검사한다.

### 일반 사용자 견적 요청·고수 제안 — A3, A4, C1, F2

| Method | Path | 화면 동작 | 주요 입력 → 응답 |
|---|---|---|---|
| POST | `/quote-requests` | 견적 요청 등록 | 아래 `QuoteWrite` → `quoteRequestId,closesAt` |
| GET | `/quote-requests/{id}` | 견적 상세 | 요구사항·예산·지역·일정·제안 수·마감 상태 |
| PATCH | `/quote-requests/{id}` | 나의 견적 수정 | 작성자만; 마감 기간은 최초 등록시각 기준으로 재계산 |
| POST | `/quote-requests/{id}/close` | 나의 견적 조기 마감 | 작성자만 → `status=closed` |
| GET | `/me/quote-requests` | 나의 견적 요청 관리 | 진행/마감 필터·받은 제안 수 |
| POST | `/quote-requests/{id}/proposals` | 고수의 제안하기 | `{serviceId,initialMessage?}` → `proposalId,chatRoomId` |
| GET | `/me/proposals` | 보낸 제안 모아보기 **추가 제안** | `status?,cursor,limit` → 내 제안 목록 |
| GET | `/quote-requests/{id}/proposals` | 받은 제안 모아보기 **추가 제안** | 견적 작성자만 → 제안 목록 |
| GET | `/quote-requests/{id}/comments` | 견적 댓글 | 페이지 목록 |
| POST | `/quote-requests/{id}/comments` | 견적 댓글 작성 | `{body}` → 댓글 |

`QuoteWrite` 제안: `{title,categoryId,mode,regionIds,description,referenceFileIds?,referenceUrl?,budgetMin?,budgetMax?,preferredWorkDate?,durationDays?,closingDays:3|7|14}`. 요구사항은 최소 50자. 기간 미입력은 “협의 가능”으로 표시한다. 서버는 `createdAt + closingDays` 이후 제안을 거부하고 자동 마감 처리한다. 마감된 견적, 자기 견적, 같은 카테고리의 등록 서비스가 없는 사용자는 제안할 수 없다. 제안은 기존 설계서대로 채팅방을 만들거나 연결한다. 구조화된 가격 제안서는 화면에 근거가 없어 넣지 않았다.

### 문의·채팅·거래 여부·리뷰 — D1, D2, D3

| Method | Path | 화면 동작 | 주요 입력 → 응답 |
|---|---|---|---|
| POST | `/services/{serviceId}/inquiries` | 서비스 문의하기 | `{initialMessage?}` → `chatRoomId`; 자기 서비스 문의 불가 |
| GET | `/chat/rooms` | 채팅 목록 | `cursor,limit` → 상대, 연결 서비스/견적, 안 읽은 수, 최신 메시지, 거래 표시 |
| GET | `/chat/rooms/{id}` | 채팅방 상단·연결 카드 | 참여자만 → `ChatRoom` |
| GET | `/chat/rooms/{id}/messages` | 이전 채팅 | `before?,limit` → 메시지 목록 |
| POST | `/chat/rooms/{id}/messages` | 메시지 전송 | `{text?,fileIds?}` → `messageId,createdAt`; 파일 최대 5개 |
| POST | `/chat/rooms/{id}/read` | 읽음 표시 | `{throughMessageId}` → `204` |
| PUT | `/chat/rooms/{id}/transaction` | 거래 진행 확인 | `{transacted:true}` → `transactionStatus`; 양측 중 한 명 확인 시 리뷰 진입 가능 |
| POST | `/chat/rooms/{id}/reviews` | 리뷰 작성 | `{rating:1..5,positiveTags?,negativeTags?,body?}` → 리뷰; 본인 제외·중복 방지 |
| GET | `/services/{serviceId}/reviews` | 서비스 리뷰 조회 | 평점·태그·본문 목록 |
| WS | `/ws/chat` | 실시간 채팅 연결 | WebSocket, Bearer 인증; 참여한 방의 메시지·읽음 이벤트 |

채팅은 DB 저장 후 실시간 이벤트를 전달하고, 재연결 시 `GET /messages`로 누락분을 받는다. 발송 실패 재시도를 위해 메시지 생성은 `Idempotency-Key`를 필수로 한다. 첨부는 화면 기준 한 번에 최대 5개, 파일당 최대 100MB. 최초 문의·제안 알림과 이후 일반 채팅 알림을 구별한다. 거래 확인은 결제나 계약 완료를 뜻하지 않는다.

### 알림 — A1, F4

| Method | Path | 화면 동작 | 주요 입력 → 응답 |
|---|---|---|---|
| POST | `/me/push-devices` | 푸시 토큰 등록 | `{platform,token,previewAllowed}` → `deviceId` |
| DELETE | `/me/push-devices/{id}` | 기기 토큰 제거 | `204` |
| GET | `/me/notifications` | 알림 목록 | `cursor,limit,unreadOnly?` → 채팅·댓글·신규 견적·문의/제안 알림 |
| POST | `/me/notifications/{id}/read` | 알림 읽음 | `204` |
| GET | `/me/notifications/unread-count` | 홈 알림 표시 | `{count}` |

신규 견적 알림은 전문가의 서비스 카테고리와 제공 지역이 맞을 때 생성한다. 인앱 알림은 화면 정의에 따라 30일 보관한다. 마케팅 푸시는 별도 수신 동의를 확인한다.

## 결정이 필요한 사항

1. **서비스 등록 시 고수 자격 검증:** 설계서에는 같은 카테고리 서비스 등록을 제안 자격으로 사용하지만 전문성 검증 절차는 정의되지 않았다.
2. **리뷰의 대상:** 화면은 채팅 상대와 거래 경험을 평가한다. API는 채팅방 기준 리뷰로 제안했으며, 서비스별 평점 집계 규칙을 정해야 한다.
3. **회원 탈퇴와 채팅 보관:** 탈퇴 안내의 “모든 내역 삭제”와 상대방 채팅 보관 규칙을 일치시킬 문구·보관 기간이 필요하다.
4. **결제·정산:** 해당 화면 흐름을 확인하지 못했다. 현재 명세에서 제외했다.
5. **운영자 기능:** 원문은 MVP에서 admin 부재를 언급한다. 현재 명세에는 포함하지 않았다.

## 구현 우선순위 제안

1. 카테고리·지역·검색·서비스 목록/상세.
2. 가입·인증, 서비스 등록, 견적 요청 등록·마감·제안 자격.
3. 문의·채팅·첨부·알림, 거래 확인·리뷰.
4. 마이페이지·찜·고객센터·탈퇴 및 운영 보완.
