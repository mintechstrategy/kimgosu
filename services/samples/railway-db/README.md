# Railway DB 샘플 API

새로 작성한 Fastify/TypeScript 진단 API. 실제 PostgreSQL 데이터 영속성과 Cloudflare→Railway 경로를 확인하기 위한 **개발 전용 샘플**이며 제품 인증/업무 API가 아니다.

## 구현
- `src/app.ts`: 인증·만료·입력 검증, `POST /sample/records`, `GET /sample/records/:id`.
- `src/server.ts`: Railway dev project/environment 고정, private DATABASE_URL, 제한 DB 역할 `kg_dev_runtime` 확인, pg 파라미터 쿼리. 자동 마이그레이션 없음.
- `src/store.ts`: 로컬 진단/독립 DB 대조용 운영자 SSH 어댑터. 서버에서는 UUID 상수만 참조하며 SSH를 실행하지 않음.
- `Dockerfile`, `railway.json`, `release.json`: Node24 이미지, 상태 확인 경로, 배포 입력 해시.

## 실행과 증거
프로젝트 루트 `.local-toolchains/node24/bin`을 PATH에 추가하고 이 디렉터리에서 `npm ci --ignore-scripts`, `npm run check`, `npm test`를 실행한다.

- `npm run test:live`: 기존 개발계 SSH를 이용한 로컬 HTTP API→Railway SQL 거래. 정확 run/owner 합성 데이터만 만들고 정리한다. 승인된 개발계 연결에서만 실행한다.
- `EXPECTED_GITHUB_SHA=<검증 대상 SHA> node src/public-live.ts`: 별도 승인된 임시 세션을 사용해 기본 DNS 외부 HTTPS 거래, 런타임 GitHub SHA, Cloudflare 응답 헤더, 배포 식별자, 독립 SQL 조회 및 정리를 검증한다. 임시 세션 준비 없이 재실행하지 않는다. 후속 결과는 `engineering/env-resolve-02/PUBLIC-RESULT.json`에 기록한다.
- `RESULT.json`: 최초 로컬 거래 증거. 이후 앱 인증 처리 변경 전 후보의 결과다.
- `PUBLIC-RESULT-dns-cache-failure.json`: 프록시 변경 직후 OS DNS 캐시가 원본 서버로 연결한 첫 실패. 삭제하지 않았다.
- `PUBLIC-RESULT.json`: 실제 Cloudflare 프록시→새 Railway 배포→private PostgreSQL 거래 성공, 정리/SQL 대조 결과.
- `../../../engineering/env-sample-01/FINAL-VERIFICATION.json`: 최종 런타임 소스 해시·배포 상태·테스트 인증 만료 재확인. 공용 DNS/Cloudflare 경유 검증은 성공했고 기본 OS 리졸버의 원본 IP 잔류는 별도로 기록했다. TLS 검증을 끄지 않았다.

## 보안·운영 경계
- 외부 주소: `https://api-dev-kimgosu.mintech.ai`. 응답은 `Cache-Control: no-store`.
- 인증 없는 `/health`는 생존과 release 식별만 제공한다. DB 거래 성공 근거는 POST/GET+독립 SQL 결과다.
- 기존 dev/api 배포를 새 샘플로 교체했다. 기존 삭제된 제품 기능을 복원하거나 기존 엔드포인트 호환성을 보장하지 않는다.
- 테스트 토큰 원문을 Git/로그/응답에 기록하지 않는다. 서버에는 해시와 만료시각만 전달했다. 시험 종료 후 `SAMPLE_EXPIRES_AT=0`을 적용한 동일 이미지 재배포로 토큰을 거부하고 로컬 원문 파일을 삭제한다.
- 후속 시험은 새 토큰/격리 run·owner/짧은 만료시간을 준비하고 개발 API 재배포와 검증 후 다시 폐기한다. 테스트 인증을 제품 로그인으로 사용하지 않는다.
- 운영환경·기존 DB 데이터·테이블 구조는 변경하지 않는다. GitHub 동일 SHA 배포·CI와 브라우저 실제 거래 후속 검증은 `KG-ENV-RESOLVE-02` 범위이며 실제 결과는 `engineering/env-resolve-02/`에서 별도로 확인한다.
