# 뉴김고수 앱 다운로드 게시판

- 사이트: https://appdownload.mintech.ai
- Cloudflare Pages: kimgosu-app-downloads (Direct Upload, production branch main)
- 공개 파일은 site/만 배포한다. QA 원문·소스·인증·개인정보를 이 폴더에 넣지 않는다.
- 최종 앱은 QA 통과→부모 증거 수용→동일 소스 최종 빌드 후에만 등록한다. 현재 공개 버전은 AOS v0.1.0 Build1이며 engineering/aos-publish-01/RESULT.json에 원격 다운로드/브라우저 검증 증거가 있다.
- 최신 사용자 지시로 당분간 AOS만 게시한다. Apple 회사 가입 승인 전 IPA 생성·등재 금지, iOS Simulator ZIP도 게시하지 않는다. 승인 후 실기기 서명은 사용자가 수행한다.

## 버전 게시
`publish_release.py --release-record <실제 최종빌드 검증기록.json> --deploy`가 앱을 버전별 불변 경로에 추가하고 Pages 재배포 후 원격 파일 SHA와 게시글 버전을 재조회한다. 이 명령은 앱을 빌드하거나 QA를 대신하지 않는다. 임의 우회 옵션은 없다.

검증기록 필수 필드: stage=post-qa-final, qaAccepted=true(부모가 QA 증거를 실제 수용), candidate, qaCompletedAt, builtAt, artifact(로컬 최종 파일), artifactSHA256, platform(aos/ios), kind(android-apk/ios-simulator/ios-device-ipa), version, build, notes, qaResult={path,sha256}, sourceManifest={path,sha256}. 기록의 경로는 로컬 검증용이며 공개 releases.json에 유출하지 않는다.

- QA 원문은 overallVerdict=PASS/PASS_SCOPED와 같은 candidate여야 한다. 검토 소스 핀 불일치, QA 이전 빌드, 실제 버전 불일치, 25MiB 초과 파일은 거부한다.
- Android는 추가 aapt2 경로가 필요하며 실제 APK 메타데이터로 버전을 검증한다.
- iOS Simulator ZIP은 실제 iPhone 설치불가를 명시한다. 실기기 IPA는 부모의 실제 서명 검증과 설치 범위 기록이 있어야 한다.
- 기존 버전은 덮어쓰지 않고 누적한다. 배포 실패/원격 해시 불일치는 업로드 완료가 아니다.
- 사용자 iOS 설정이 바뀌어 과거 Android candidate 전체pin과 live tree가 다르면, 검증기를 우회하거나 사용자 설정을 되돌리지 않는다. 실제 APK를 만든 원QA source manifest의 정확 사본49경로로 게시 스테이징을 구성해 무변경 publisher의 모든 guard를 통과시키고 입력 해시·출처를 남긴다. 이 과거 승인후보를 최신 iOS후보로 재태깅하지 않는다. 현재 절차 근거는 engineering/aos-publish-01/STAGE.json이다.
- 현재 앱 QA가 BLOCKED/FAIL이면 최종 빌드와 파일 공개를 보류한다. 새 유료 저장소나 다른 도메인으로 자동 우회하지 않는다.

## 개발 검증
`node --test board.test.mjs` (실행한 8시험). 사이트 접속/실제 브라우저/모바일/필터·검색/오류 상태/원격 원문 대조는 engineering/download-board-01/에 기록한다. 게시판 독립 QA는 uiux의 별도 대응 카드이며 자동시험과 구분한다.
