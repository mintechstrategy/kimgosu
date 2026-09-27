# 카카오·네이버 간편가입/로그인 구현 가이드

상태: **설계 가이드, 실제 제공자 연동 미구현**. 현재 디버그 APK의 합성 CI 로그인은 운영 인증이 아니다.

## 공통 흐름

1. Android 네이티브 로그인 SDK 또는 시스템 브라우저로 제공자 인증을 시작한다. 로그인 UI를 5개 업무 WebView에 넣지 않는다.
2. 앱이 받은 인가 결과를 FastAPI에 전달한다. 서버가 제공자 토큰/사용자 정보를 제공자 API로 검증하고, 검증되지 않은 클라이언트 제공 `ci`·이름·사용자 ID는 신뢰하지 않는다.
3. 제공자에서 검증된 CI가 오면 현재 `register_or_find_customer`의 HMAC 조회 인덱스로 기존 고객을 찾는다. 신규 고객은 `kakao_...` 또는 `naver_...` 접두어를 가진 랜덤 `user_id`를 채번한다. 고객 이름·생년월일·주소 등 미제공 정보는 별도 동의·입력 흐름에서 받는다.
4. CI가 없는 제공자는 **CI로 같은 고객을 찾았다고 처리하지 않는다**. 제공자 고유 ID를 별도 `customer_identities(provider, provider_subject)`에 보관하고, 이미 로그인한 고객의 명시적 계정 연결 또는 별도 본인확인으로 CI를 확보한 뒤 연결한다. CI 미제공 계정의 가입 허용 여부는 제품 정책 결정이 필요하다.
5. 서버가 자체 세션 토큰을 발급하고 Android 앱에 전달한다. 제공자 액세스 토큰이나 client secret을 업무 WebView·로그·DB 평문에 노출하지 않는다. 최초 가입에만 약관 및 SMS 인증 E2를 진행한다.

## 제공자별 작업

| 제공자 | 개발자 콘솔/앱 작업 | CI 확인 사항 |
|---|---|---|
| 카카오 | 앱 등록, Android 키 해시와 Redirect URI, 카카오 로그인·동의항목 설정. Android SDK 로그인 또는 인가 코드/OIDC 흐름을 사용한다. 서버는 토큰/사용자 정보의 발급처와 유효성을 확인한다. | `ci`는 자동 제공이 아니다. CI 동의항목 권한·사용자 동의 및 실제 제공 가능 여부를 확인한다. |
| 네이버 | 애플리케이션 등록, Android 패키지, 네아로 SDK 로그인과 프로필 조회를 적용한다. SDK의 로그인 방식·버튼 디자인 가이드를 따른다. 서버는 네이버 토큰과 프로필을 검증한다. | 공개 네이버 로그인 프로필 문서에서 CI 제공을 확인하지 못했다. CI 기반 동일인 연결은 별도 제공 계약 또는 본인확인 경로가 확인되기 전까지 구현하지 않는다. |

카카오 문서: [로그인 개요](https://developers.kakao.com/docs/ko/kakaologin/common), [REST API·CI 필드](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [보안 지침](https://developers.kakao.com/docs/en/getting-started/security-guideline).

네이버 문서: [Android SDK](https://developers.naver.com/docs/login/android/android.md), [로그인 개발가이드](https://developers.naver.com/docs/login/devguide/devguide.md). CI 미확인은 해당 공개 문서로부터의 **추론**이며, 제공자와 계약·콘솔 설정을 확인해야 한다.

## 구현 전 필요한 실제 값/결정

- 카카오·네이버 개발자 앱의 소유 계정, Android 패키지/서명 키, client ID와 서버 보관용 secret, 등록할 callback/redirect URI.
- HTTPS가 정상 동작하는 외부 API 도메인. 현재 `https://mt0205.synology.me:23912`는 이전 검증에서 실패했으므로 실제 인증 전에 다시 검증한다.
- CI 제공 권한·동의항목 및 네이버 CI 부재 시 별도 본인확인 또는 가입 보류 정책.
- 약관 전문/버전, SMS 인증 공급자, 개인정보 수집·보관·탈퇴 정책.

제공자 키와 secret은 Git/앱 자산에 넣지 않고 환경별 비밀 저장소로 주입한다. 테스트 CI API는 디버그/LAN 전용으로 유지하고 운영 공개 경로에서 차단한다.
