# 구글 로그인 연결 절차 (개발계)

작성 2026-11-04. 대상: dev 환경. 카카오·네이버·애플은 이 문서 범위가 아니다.

## 지금 상태

| 항목 | 상태 |
|---|---|
| 백엔드 코드 (authorize·token·JWKS·PKCE·nonce) | 구현 완료 |
| `KG_IDENTITY_HMAC_KEY` | dev에 주입 완료 (64자) |
| 콜백 페이지 `/auth/callback` | 구현 완료 |
| 구글 OAuth 자격증명 | **없음 — 사용자 작업 필요** |
| 앱 로그인 버튼·딥링크 | 구현 예정 |

자격증명이 없으므로 `/v1/auth/config`의 `providers[].enabled`는 지금도 `false`다.
서버는 자격증명이 없으면 **거짓 성공을 만들지 않고** 503 `PROVIDER_NOT_CONFIGURED`로 거절한다.

## 사용자 작업 1 — OAuth 동의 화면

1. https://console.cloud.google.com 접속
2. 상단에서 프로젝트 선택 → 새 프로젝트(`kimgosu`) 생성
3. **API 및 서비스 → OAuth 동의 화면**
   - User Type: **외부**
   - 앱 이름: `김고수`
   - 사용자 지원 이메일: `mintechstrategy@gmail.com`
   - 개발자 연락처: 동일
   - 범위(Scopes): `openid`, `email`, `profile` 세 개 추가
4. **테스트 사용자**에 로그인에 쓸 본인 구글 계정 추가

테스트 모드에서는 **등록한 계정만** 로그인된다. 실사용자를 받으려면 이후 "앱 게시"가 필요하다.

## 사용자 작업 2 — OAuth 클라이언트 ID

1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
2. 애플리케이션 유형: **웹 애플리케이션**
3. 이름: `kimgosu-dev-web`
4. **승인된 리디렉션 URI** — 정확히 아래 문자열

```
https://dev-kimgosu.mintech.ai/auth/callback
```

5. **승인된 JavaScript 출처** (선택이지만 넣어두면 편하다)

```
https://dev-kimgosu.mintech.ai
```

6. 생성 후 나오는 **클라이언트 ID**, **클라이언트 보안 비밀번호**를 개발 담당에게 전달

### 주의

- 서버는 리디렉션 URI의 host가 `dev-kimgosu.mintech.ai`이고 https인지 검사한다. 다른 host면 그 자격증명을 **무시**한다(`providers.ts`).
- URI 끝에 `/`를 붙이거나 빼면 구글이 다른 주소로 보고 `redirect_uri_mismatch`가 난다. 위 문자열 그대로.
- 보안 비밀번호는 채팅·문서·Git에 남기지 않는다. Railway 환경변수로만 넣는다.

## 개발 담당 작업 (자격증명 수령 후)

```bash
railway variables -s api -e dev \
  --set "KG_OAUTH_GOOGLE_ENABLED=true" \
  --set "KG_OAUTH_GOOGLE_CLIENT_ID=<전달받은 값>" \
  --set "KG_OAUTH_GOOGLE_CLIENT_SECRET=<전달받은 값>" \
  --set "KG_OAUTH_GOOGLE_REDIRECT_URI=https://dev-kimgosu.mintech.ai/auth/callback"
railway up -s api -e dev -y
```

적용 확인:

```bash
curl -s https://api-dev-kimgosu.mintech.ai/v1/auth/config \
  | python3 -c "import json,sys;print([p for p in json.load(sys.stdin)['providers'] if p['id']=='google'])"
# 기대: [{'id': 'google', 'enabled': True}]
```

## 로그인 흐름 (구현 형태)

```
앱 로그인 버튼
  → POST /v1/auth/oauth/google/start        { authorizationUrl, state }
  → 브라우저로 authorizationUrl 열기
  → 구글 로그인·동의
  → https://dev-kimgosu.mintech.ai/auth/callback?code&state
       (이 페이지가 API 콜백을 호출해 세션을 받는다)
  → kimgosu://auth/callback?token=…
  → 앱이 토큰 저장 후 홈으로 이동
```

콜백 페이지는 토큰을 화면에 남기지 않고 즉시 딥링크로 넘긴다.
신규 사용자면 서버가 회원을 만들고, 앱은 가입 화면(필수항목·약관 동의)으로 이어준다.

## 검증 체크리스트

- [ ] `/v1/auth/config`의 google `enabled`가 true
- [ ] 앱에서 구글 창이 뜨고 로그인된다
- [ ] 같은 계정으로 두 번 로그인해도 회원이 하나만 생긴다
- [ ] state 재사용이 401 `OAUTH_STATE_INVALID`로 거절된다
- [ ] 취소 시 `SOCIAL_AUTH_CANCELLED`로 앱이 오류를 표시한다
