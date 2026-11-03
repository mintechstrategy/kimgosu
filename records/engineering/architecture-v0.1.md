# KG-ENG-TECH-DB-002 — 기술·논리 DB v0.1 검토안

담당 engineering. 상태 partial / 사용자·product·qa 승인 없음. 모든 기술/DB 버전은 NOT_APPROVED. 계약 코드와 기존 lock/.gitignore는 읽기 전용이다. DB 생성·DDL·migration·서버·앱빌드·배포는 수행하지 않았다.

## 최종 권고 조합 하나

- iOS: SwiftUI 네이티브, Swift 6.4 / Xcode 27.0 / iOS SDK 27.0. 최소 지원 iOS 17.0을 기술안으로 제안한다. 설치값 자체가 승인값은 아니며 Xcode 공식표의 지원범위와 로컬 showsdks를 대조했다. SwiftUI 최초 제공 iOS13과 이 제품의 최소지원 OS17 제안은 다르다. 현재 공식표에는 27.1과 27.2 beta도 보이지만 자동 업데이트하지 않는다.
- 관리자: Vue 3.5.44 + Vite 8.3.4 + TypeScript 7.0.2 정적 SPA, Cloudflare Pages. 빌드 런타임 권고는 Node 24.22.0 LTS. 정확한 Vue 플러그인/vue-tsc/TS7 조합의 빌드 호환성은 미실행이며 구현 착수 전 작은 호환성 시험이 필요하다. 메타데이터 존재를 빌드 성공으로 바꾸지 않는다.
- 공통 백엔드: Node 24.22.0 LTS + TypeScript 7.0.2 + Fastify 5.12.7 단일 서비스, Railway. 인증/인가/채팅 영속성/중요 업무규칙/미디어 접근을 한 백엔드에서 검증한다. 현행 입력 JSON Schema는 부분 계약이므로 그대로 전체 API 검증으로 사용하지 않는다.
- DB: PostgreSQL 18.6을 논리 DB v0.1의 구현 검토 대상으로 권고한다. 공식 지원표에서 지원중이며 종료예정일은 2030-11-14로 확인했다. Railway 실제 템플릿의 정확한 이미지/확장/패치 pin 지원은 미확인이다. 제공 이미지/업그레이드/백업복구 계획 확인과 승인 없이는 생성하지 않는다. PostGIS는 공간 조회 요구/측정 후 별도 결정하며 기본 포함하지 않는다.
- 미디어: R2는 저장, Railway의 승인된 처리 경로는 최적화/썸네일 담당. R2가 자동 변환한다고 가정하지 않는다. Cloudflare Images/Stream/Workers 등 부가 기능·가격·처리지역은 TBD이며 활성화하지 않았다.
- GitHub는 코드/검토/이력. Pages는 정적 관리자만 담당하고 인증 토큰/민감데이터를 정적 번들에 넣지 않는다. 관리자와 iOS가 DB/R2에 무권한 직접 접근하는 구조를 사용하지 않는다. Vercel은 후속 사용자 지시로 대체된 역사값이다.

네이티브 선택 근거: 현재는 iOS만 구현하며 실제 설치된 Swift/Xcode가 있다. SwiftUI/App Life Cycle과 카카오 onOpenURL, Google의 SwiftUI 지원 경로를 공식문서에서 확인했다. iOS 안전영역·접근성·사진/푸시·소셜 SDK를 직접 검증하는 경로를 우선한다. Flutter/React Native는 후속 Android UI 재사용 이점이 있지만 이번 Android 제외 범위에서는 플러그인/브리지/런타임 추가 비용이 생긴다. SwiftUI 채택은 이후 Android UI를 별도 구현하는 비용을 수반한다. 교차플랫폼 자체를 실패하거나 미지원이라고 판단한 것은 아니며 이번에는 병행 골격을 만들지 않았다.

## 공식 공개자료 조회 — 2026-10-18 KST

실제 GET의 UTC 조회시각·HTTP 결과·응답 SHA256·발췌/메타데이터는 db-v0.1/official-evidence.json. 외부로 비공개 설계/프로젝트 파일을 올리지 않았다. 공개 GET만 수행했다.

| 출처 | 실제 확인 | 한계 |
|---|---|---|
| https://nodejs.org/dist/index.json | 조회 당시 LTS 24.22.0(Krypton), Current26.12.0 | 설치 Node26.7.0은 운영선정 아님 |
| https://raw.githubusercontent.com/nodejs/Release/main/schedule.json | 24 maintenance 2026-10-20/end2028-04-30, 26 LTS 예정2026-10-28 | 일정은 공급자 변경 가능; 도입 시 재조회 |
| https://developer.apple.com/support/xcode/ → /xcode/system-requirements | Xcode27/Swift6.4/iOS27 및 배포대상 범위, device/simulator iOS17 이상 표 | 실기기/서명/제공사 SDK 조합 시험 없음 |
| https://developer.apple.com/tutorials/data/documentation/swiftui.json | SwiftUI 플랫폼 도입버전 iOS13 | 제품최소 OS17은 기술제안 |
| https://developer.apple.com/app-store/review/guidelines/ §4.8 | 주 계정에 제3자/소셜 로그인을 쓰면 데이터 최소수집·이메일 비공개·광고목적 상호작용 수집 제한을 갖춘 동등 로그인 옵션 필요. 예외 목록 확인 | 김고수의 일반 공개 매칭앱에 해당 예외가 확인되지 않아 Sign in with Apple 추가를 필수 보완 권고로 승인 요청. 심사통과 보장 아님 |
| https://developers.google.com/identity/sign-in/ios/start-integrating | SPM/SwiftUI 지원, OAuth client/server client 설정, Privacy Manifest·서명 주의 | 실제 OAuth/SDK 정확 pin 및 전체 최소OS 미확인 |
| https://developers.kakao.com/docs/latest/en/kakaologin/ios | SwiftUI onOpenURL/URL scheme 경로 | 계정·SDK 버전/비용/최소OS 전체 검증 없음 |
| https://raw.githubusercontent.com/naver/naveridlogin-sdk-ios/master/README.md | 구 저장소 deprecated, 새 swift 저장소로 안내 | 구 SDK를 새 앱에 자동 승계하면 안 됨 |
| https://raw.githubusercontent.com/naver/naveridlogin-sdk-ios-swift/main/Package.swift | 새 패키지 iOS15 최소·Swift5 언어모드·privacy resource | 특정 release pin/Swift6.4 실빌드 미검증 |
| https://registry.npmjs.org/vue/latest 및 /vite/latest | Vue3.5.44(MIT), Vite8.3.4(MIT); Vite node ^20.19.0 또는 >=22.12.0 | Vue package engines 미명시; 전체 빌드 호환성 보장 아님 |
| https://registry.npmjs.org/typescript/latest 및 /fastify/latest | TS7.0.2(Apache-2.0), Node>=16.20.0; Fastify5.12.7(MIT), engines 미명시 | Fastify의 지원정책 문서도 별도 확인 |
| https://fastify.dev/docs/latest/Reference/LTS/ | 지원 Node LTS release line의 최신 버전 시험 정책; 표에는 v5/20/22와 LTS 종료TBD | Node24 선정은 정책에 따른 권고이며 이 제품 통합시험 아님 |
| https://developers.cloudflare.com/pages/configuration/serving-pages/ | top-level404.html 없으면 SPA fallback, Vue 등 지원 | 실제 Pages 플랜/build pin/운영보안·비용 미확인 |
| https://docs.railway.com/databases/postgresql.md | PostgreSQL 템플릿, 단일노드와 HA/백업의 분리, 공식PG 기반 이미지 | 실제 계정/서비스 버전/백업복구·요금 검증 없음 |
| https://docs.railway.com/networking/public-networking/specs-and-limits.md | HTTP/1.1 WebSocket 지원과 연결 제한 문서 | 재접속/영속저장/다중사용자 앱 검증과 다름 |
| https://www.postgresql.org/support/versioning/ 및 https://www.postgresql.org/about/licence/ | PG18.6/17.11 지원표, PostgreSQL License | 확장·관리형 플랜 지원/적용 검증 없음 |
| https://developers.cloudflare.com/r2/ | 객체저장·S3 접근·public bucket·Images/Stream 별도 역할 | 무료/영구무료·전환자동화·국외이전 적합성 보장 안함 |
| https://graphviz.org/doc/info/arrows.html | crow/tee/odot 조합과 마커 순서 | 생성 도식은 독립 시각 QA 미완료 |

최초 Railway /guides/postgresql은308, /guides/websockets는404로 실패했다. 실패를 숨기지 않고 공식 현행 databases/postgresql.md와 networking specs로 대체 조회했다. Fastify migration URL 응답은 본문이 기대 내용인지 확정하지 못해 최소엔진 근거로 채택하지 않았다. 사용료/보안 적합성/전체 라이선스 의무 검토는 미완료이며 무료 플랜/법적준수/호환을 보장하지 않는다.

## 논리 DB v0.1의 읽는 순서

1. db-v0.1/model.py: 유일한 수정 원본. Python의 명시적 테이블/컬럼 명세이며 제품 코드/DB 스크립트가 아니다.
2. db-v0.1/model.json: 동일 모델의 전체 컬럼·PK/FK·UNIQUE/CHECK/인덱스·권한 규칙·정책 출처를 포함한 교환용 생성본. JSON만 수정하면 다음 생성에서 덮어써지므로 원본을 수정한다.
3. db-v0.1/data-dictionary.md: 모든 엔티티/컬럼의 목적, 타입, nullable, 기본값 없음/원본/제안, 예시, 출처. 인증·개인정보 예시는 [REDACTED].
4. db-v0.1/erd-overall.png: 전체 FK 관계. erd-{identity,catalog,listing,media,chat,community,ledger,operations}.png: 영역별 모든 컬럼. 동일명의 .dot/.svg를 함께 제공한다. 도식상의 영어 식별자 의미는 사전의 한국어 설명과 대응한다.
5. db-v0.1/scope-coverage.json: catalog139뷰 전체를 파싱한 후보 매핑과8분류 명칭. 기존 v0.19를 최신 카드/E1 최종 디자인으로 승인하지 않았다.
6. db-v0.1/model-checks.json, render-checks.json: 각 실제 검사 결과. 최종 결과와 종료 재확인 미실행 항목은 engineering/tech-db-start-result.json.

영역별 도식에는 해당 영역 내부 FK를, 전체 도식에는 영역간 FK도 표시한다. 실선=단일 FK, 점선=복합 FK. 부모 쪽 ||는 필수1, o|는 선택0..1, 자식 쪽 o<는0..N. FK가 nullable인지와 단일열 PK/UNIQUE인지로 cardinality를 계산하며 ‘부모는 반드시 자식을 하나 이상 가진다’는 거짓 최소관계를 발명하지 않는다. 회원–고수/현재번호/관리자는0..1 확장, 찜/리뷰태그/관리자역할/지역연결은 중간 테이블로 N:M을 표현한다. 데이터가 없는 상태라 최소 BASIC/사진수처럼 여러 행에 걸친 조건은 별도 서버 transaction/제약안이지 렌더가 검증한 DB 제약이 아니다.

## 범위·정책 추적 및 중요한 설계 판단

- identity: M§5-1·E1/E2/F1 → 통합회원, 소셜연결, SMS 점유시도/연결, 동의문/동의철회, 세션, 고수 상태/확인 이력. 이메일/전화 같음으로 자동 병합 금지. 점유인증≠실명/고수자격. 번호 재사용·재가입/탈퇴후 식별 유일성은TBD. 생년/성별 등 원안 선택정보는 최소수집 결정 전 별도 선행 저장하지 않았다.
- catalog: 최신8분류와 코드/표시명/자산참조/정렬/노출. 실제 불변 초기 코드와 각 분류의 대면/비대면 매핑TBD. 지역은 버전 레코드+분할/통합 승계 N:M, 공식 출처/행정동·법정동 구분. 과거 참조의 이름/상하위 관계를 현재 코드로 덮어쓰지 않는 검토안이다. 탐색 선택지역과 고수 가능지역/게시글 희망지역은 별도 연결, 정확 GPS/수행 상세주소는 최소수집·권한 결정 전 구현 보류.
- listing/media: C1/F3/A5/F2·M§5-3/8 → 서비스/견적의 고정 identity와 불변 revision, 패키지/지역/사진 연결. 기본7일·3/7/14일·최초등록 기준을 보존한다. 수정일 기준 마감 재시작 금지. closes_at의 정확 동시각/자정 해석은 승인 필요. 사진수/순차패키지는 여러 행의 transaction 검증안. 서비스0원/BASIC 설명/문자계수/미디어한도는TBD. 원본 유의사항 필수와 SCOPE 선택 표현 충돌은 원본 유지로 기록한다.
- chat: D1/D2/A3·M§5-4 → 서비스/견적 FK XOR로 명시 연결; 문자열 target_id나 거대 JSON으로 관계를 대체하지 않는다. 문의 최초 문맥과 공유 메시지는 불변 revision/package FK로 당시 정보를 보존한다. 고객–고수–대상별 방 유일성은 기술권고이며 원본 확정값이 아니다. nullable target와 initial revision 조합 CHECK/복합 FK를 함께 제안한다.
- 메시지 중복방지는 (room,author,client_message_id), 순서는(room,sequence) UNIQUE. 복합 FK로 작성자 참여를, 서버로 활성참여/정지/차단·첨부소유/마감·문맥 소속을 검사한다. 저장 commit과 알림·카운터를 구분한다. quote 마감/제안 경합은 동일 권위시각과 행잠금 transaction, optimistic version으로 동시 수정 충돌을 거부하는 설계안이다. 실제 동시성 시험은 미실행.
- 자기신고/리뷰: 원본42:466에 따라 참여자 한쪽 traded=true이면 원본 배지/리뷰 진입 조건을 충족하는 의미를 보존했다. SCOPE의 쌍방 강제합의/완료 정책은 미승인이고 이번 최신 지시에서 채택하지 않는다. 실제 지급/검증구매/거래완료를 뜻하는 컬럼/결제 장부를 만들지 않았다. 동일 상담 반복거래의 리뷰 단위·자기신고 수정과 중복 제한은 Q2 TBD이며 UNIQUE(room,author)는 기술제안이다.
- community/ledger: 찜은 서비스, 공개 댓글은 서비스/견적 XOR, 리뷰와 분리. 알림/선호/푸시주소·차단/신고 연결. 고수–고객 원장은 복합 FK로 실제 같은 방의 두 주체에 연결하고 모든 쿼리에 소유고수 필터를 요구한다. 사적 메모/태그는 원장 관계에만 속하며 고수B·고객·기본CS권한에 공개하지 않는다. 외부 고객 수기등록/회원자동생성은 보류.
- operations: 관리자RBAC, CS담당/상태/처리이력, 증거연결과 제한 열람승인을 분리했다. 임의CS생성은 타인대화 열람권을 만들지 않는다. grant는 건/담당/승인자/방/구간/사유/만료를 묶고 감사 실패시 fail-closed. 메모·채팅 전문/첨부URL을 감사로 복제하지 않는다. 관리자 역할·승인분리·TTL/감사보존TBD. 활동지표는 실제/관리자/테스트/시연 제외를 표현하고 매출은 미제공. 복수지역 활동 연결/최종 지표 정의/집계쿼리는 후속으로 남긴다.
- 공개삭제/탈퇴는 접근종료·검색비노출과 상대방 기록/감사 보존의 다른 행위다. 모든 테이블에 일괄 논리삭제를 넣거나 cascade 삭제로 해결하지 않았다. 관계 RESTRICT는 제안이며 각 데이터의 합법적 보관·정리/재가입 처리/백업삭제는 Q4 승인전TBD. nullable 시각은 영구보존 승인이나 자동삭제 기한이 아니다.
- 보류/제외: Android·실결제/정산/지갑/포인트/StoreKit·예약/재고/배송·외부수기고객·자동계정병합·AI추천·미래용범용엔진. 결제더미는 UI전용이고 실제 금융장부·시연매출 테이블도 추가하지 않았다.

## 실행·검증과 남은 제한

로컬 dot 바이너리가 없음을 확인해 이 영역 전용 개발도구 @viz-js/viz3.31.0(MIT)·@resvg/resvg-js2.6.2(MPL-2.0)를 설치했다. 기존 제품 requirements-dev.lock/.gitignore에 쓰기를 수행하지 않았다. package.json은 DB 도식용이며 node_modules는 로컬 설치 결과, 전달/버전관리 대상에서 제외해야 한다(공유 .gitignore 변경 금지). 설치 부산물 전체 목록/잠금 파일의 종료 확인은 미실행이다. 새 전역 도구/SDK는 설치하지 않았다.

재현(제품 루트):

    python3 engineering/db-v0.1/build.py
    npm install --ignore-scripts --no-audit --no-fund --prefix engineering/db-v0.1
    node engineering/db-v0.1/render.mjs

모델 검사에서는58엔티티/354컬럼/단일FK123·복합FK9,139뷰/관리자29뷰/8분류를 확인했다. 원본 파일을 화면으로 전부 검토한 것은 아니다. scope-coverage는 텍스트 기반 후보 매핑이므로 자동 매핑되지 않은9뷰를 포함한 수동 의미 검토가 남아 있다. DB 서버에서 CHECK/FK/경합을 검증한 것이 아니다. 전체 및 영역별 PNG가 실제 렌더됐으며 모든 출력은 sips/ImageIO로 디코딩·재인코딩됐다. 전체 도식은3271×3817, 각 영역 치수/해시는 render-checks.json에 기록했다. 영역 SVG의 모든 소유 컬럼명과 전체 SVG의 모든 FK edge 존재를 검사했다. 독립적인 사람의 도식 시각 검수/가독성·교차관계 검수는 NOT_RUN이므로 review-ready/사용자 승인 완료로 올리지 않는다.

실행 예산 종료 안내로 추가 발견/검증을 중단했다. 시작 시 제공된 계약4파일 SHA256 및 .gitignore 해시를 실제 계산했고 제공된4값과 일치했다. 종료 시 재해시·제품 루트/Git/도구 버전 재확인과 신규 산출물 전체 inventory 검사는 NOT_RUN이다. 이 작업의 실제 쓰기는 허용된 engineering/architecture-v0.1.md, engineering/db-v0.1/ 및 engineering/tech-db-start-result.json에만 수행했다. 최종 해시 비교를 수행한 것처럼 input_contracts_unchanged=true로 단정하지 않는다.

## 묶어서 받을 결정 / 다음 작은 단위

1. 위 버전 조합과 iOS최소17·Apple 동등 로그인(Sign in with Apple 보완 권고) 승인 여부. SDK release pin·TS/Vue 빌드 smoke·공식 플랜 확인은 해당 구현 분기의 선행조건이며 별도 실행권한 범위에서 수행한다.
2. 논리 DB v0.1의 영역/관계 검토 승인 범위. 물리 DB/DDL/migration 승인과 분리한다. 실제 적용권한은 아직 없다.
3. model.json D02–D08의 권한/번호재사용·리뷰 반복단위/방유일성·마감경계·개인정보/백업 보존·미디어한도·운영 승인/감사/지표 정책. 원본 자기신고는 유지하고 쌍방거래 강제로 바꾸지 않는다.

다음은9개 미매핑 뷰와 상세 도식의 사람 검토, 복수지역 지표 매핑·정확 SDK/TS 조합 호환성 확인을 보완한 DB v0.1 수정안이다. 다른 프로필을 자동 실행하지 않았으며 다음 검토 요청은 project-lead에 인계한다.
