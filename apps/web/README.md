# 김고수 웹 · KG-AUTH-WEB-01

Vue 3.5.44 / Vite 7.3.7 / TypeScript 5.9.3 / vue-tsc 3.3.14 / Playwright 1.64.1. 기존 `apps/dev-console`의 실제 설치 버전을 따르되 이 앱만의 lock/dependencies를 사용한다. 관리자·결제·다운로드 사이트가 아닌 최초 회원 모듈이다.

## 로컬 개발/검증

프로젝트 루트 `P=/Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu` 기준:

```sh
export PATH="$P/.local-toolchains/node24/bin:$PATH"
cd "$P/apps/web"
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run test:unit
npm run build
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" npx playwright install chromium --only-shell
npm run test:browser
```

`test:browser`가 **격리 시험 동안만** `127.0.0.1:4178`에 빌드된 dist의 Vite preview를 실행하고 브라우저/preview를 finally에서 종료한다. 상시 서버·외부 게시가 아니다. 로그/스크린샷/결과는 `engineering/auth-three-tracks-01/web/`로 반환한다. 390×844/1440×1000/320×640 큰글자 및 키보드/다이얼로그 시험을 포함한다. 단위시험은 Node 내장 runner로 실행한다. fixture는 `tests/` 안에만 있고 제품이나 dist에 import하지 않는다. `npm run dev`는 별도 개발 편의를 위한 로컬 명령이며 이 작업에서 상시 서버로 남기지 않았다.

## 제품 경로와 현재 동작

안전한 화면 ID만 hash에 사용한다: `#browse`, `#login`, `#signup`, `#info`, `#sms`, `#policies`, `#document`, `#member`, `#consents`, `#notifications`, `#withdraw`, `#expired`, `#restricted`, `#social-error`.

- 비회원 공개 진입/분야·지역 문맥/수동 지역 입력, 보호된 회원 메뉴의 로그인 요청, 취소 시 공개 문맥 복귀. 공개 서비스 검색·지역코드 API는 후속 범위이므로 실제 목록/가격을 가짜 데이터로 채우지 않는다.
- E1 순서와 브랜드/원비율 아이콘, 세 소셜 버튼. 기본 auth adapter는 명시적인 준비 중 오류이며 소셜 성공/가입/자동 계정 병합을 만들지 않는다.
- 다섯 정책 종류, 전문/버전/시행일/운영자/상태/본문 SHA-256 검증. DRAFT·미래 효력·필수 메타데이터 미확인 시 동의 불가. 이름/이메일 필수, 14세 확인, 성별/연령대/생년월일 미수집. 확인용 입력은 전송하지 않는다.
- SMS 번호·5자리 입력 제한/60초·재발송 무효화 정책 안내와 준비 중 차단. 실제 발송/타이머/인증 성공은 외부 제공자와 새 승인 계약이 없으므로 구현했다고 주장하지 않는다.
- 계약 core의 회원·동의 이력·알림 조회, 알림 5항목별 PATCH→GET read-back, 409/불확실 응답에서 최신 조회→사용자의 명시적 재저장/취소. 광고 선호와 마케팅 동의·OS/브라우저 권한은 독립이다.
- 로그아웃 확인/서버 실패 복구, 401 만료/403 제한 구분, 이전 쓰기 자동 재실행 없음. 탈퇴/재가입 안내·최종 다이얼로그·취소 입력 보존. 실제 탈퇴·동의 철회는 core에 endpoint가 없어 차단한다.

## API와 세션 경계

`src/api.ts`는 `contracts/auth-membership.v0.1.json` core 경로/타입을 그대로 소비한다. 기본 주소는 `https://api-dev-kimgosu.mintech.ai`; 환경변수 `VITE_API_BASE_URL`은 공개 빌드 설정이며 비밀값을 넣지 않는다. 개발용 loopback HTTP 외 임의 origin이나 credential-bearing base URL은 거부한다.

`BrowserAuthPort`를 부모가 준비한 실제 **서버 검증 완료** 인증 통합으로 주입할 수 있다. 현재 `main.ts`에는 준비 중 adapter만 적용한다. 토큰 입력 UI·개발 로그인 버튼·전역 window 브리지·인증값 URL은 없다. 새 endpoint 계약은 HANDOFF에서 부모에게 제안하며 core를 임의 확장 호출하지 않는다.

opaque bearer는 API client closure의 탭 메모리에만 보관한다. localStorage/sessionStorage/IndexedDB/JS cookie/URL/로그에 기록하지 않는다. 로그아웃 성공/401/인증 실패/pagehide/unmount에서 잊고 개인정보 표시 상태도 지운다. 새로고침하면 재인증이 필요하며 토큰 refresh/영속 로그인은 현재 구현하지 않는다. BFCache 복귀 시 공개 화면으로 이동한다.

메모리 bearer는 지속 저장보다 노출면이 작지만 **XSS에 안전한 비밀 저장소는 아니다**. 브라우저 인증 배포 전에는 same-origin BFF + Secure/HttpOnly/SameSite 쿠키 및 CSRF 방어를 우선 검토해야 하며 계약 변경/인프라 처리는 부모 소유다. Vue text interpolation만 사용하고 `v-html`/외부 템플릿/분석SDK/외부폰트/서비스워커/오프라인 개인정보 캐시는 없다. `public/_headers`의 엄격 CSP와 no-store를 배포 단계에서 실제 응답으로 검증해야 한다. 현재 정적 헤더 구성 자체를 원격 적용 완료로 부르지 않는다.

## 공개 가능 파일

부모 검토/게시 시 **`dist/` 내용만** 전달한다. `src/`, `tests/`, `node_modules/`, `.cache/`, engineering 증거/소스맵을 게시하지 않는다. 앱 스플래시 파일은 포함하지 않는다. `public/assets/`는 승인 아이콘·Pretendard 3종·공식 Google G만 포함한다. 원본과 출처 해시는 반환 manifest에 기록한다. Cloudflare Pages/DNS/API CORS/배포/Git index는 이 트랙에서 변경하지 않았다.

실제 Cloudflare→Railway→DB 거래, OAuth/SMS, 원격 웹 게시 및 uiux 적합성 판정은 개발자 자체 시험과 별개다. 정확 후보와 다음 게이트는 `engineering/auth-three-tracks-01/web/RESULT.json`, `HANDOFF.md`, `candidate-manifest.json`을 따른다.
