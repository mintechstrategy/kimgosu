# 김고수 최초 네이티브 앱 — 스플래시 → A1 메인

같은 `MobileAssets/home.json`·이미지·폰트를 Android와 iOS가 직접 읽는다. 정본은 보존된 UI v0.2-brand-final의 A1이며 출처는 `ASSET-PROVENANCE.json`에 있다. 승인 스플래시 JPEG는 변형·다운로드 없이 앱에 내장한다.

## 구현 범위
- Kotlin/Jetpack Compose (Android min26/target35), SwiftUI (iOS17+).
- 앱 시작 → 내장 스플래시 → 로컬 메인 준비 완료 후 전환. 최소 대기 타이머나 네트워크 성공 조건 없음.
- 동일한 소개/검색 문구, 8개 분야/원본 아이콘, 배너, 최근/인기/검색 이력 구획, 5개 하단 메뉴.
- 실제 목록 API는 미연결이므로 상품/가격/리뷰 fixture를 서비스 데이터처럼 표시하지 않는다. 최초 실행에 허위 검색 이력도 만들지 않는다.
- 검색·등록·채팅·마이 등 후속 화면은 이번 범위가 아니며, 누르면 연결 예정임을 명시한다. 인기 분야 선택은 로컬 표시 상태만 바꾼다.
- Android 루트 Back은 태스크를 백그라운드로 보낸다. 복귀/Activity 재생성 시 메인을 유지한다.
- UI 테스트용 스플래시 고정과 API 연결 확인은 Debug 빌드에서만 켤 수 있다. 앱의 평상시 시작은 네트워크를 호출하지 않는다.

## 빌드 (저장소 루트에서)

Android: `python3 apps/android/build.py :app:assembleDebug`

JDK17·SDK35가 필요하다. 스크립트는 JAVA_HOME/ANDROID_HOME을 존중하고, 없으면 이 저장소의 격리 도구를 사용한다. 다른 환경에서는 환경 변수를 설정하면 Gradle Wrapper8.11.1을 사용한다. Wrapper 배포 checksum과 의존성 lock을 포함했다.

산출물: `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

 iOS: `xcodebuild -project apps/ios/Kimgosu.xcodeproj -scheme Kimgosu -configuration Debug -sdk iphonesimulator -derivedDataPath apps/ios/build build`

산출물: `apps/ios/build/Build/Products/Debug-iphonesimulator/Kimgosu.app`. 시뮬레이터용이며 실기기용 IPA/스토어 서명은 별도다. Xcode에서 `apps/ios/Kimgosu.xcodeproj`도 열 수 있다.

## 개발 검증
- Android: 에뮬레이터 부팅 후 `python3 apps/android/build.py :app:connectedDebugAndroidTest :app:lintDebug`.
- Android AGP 시험은 종료 시 앱을 삭제할 수 있다. 앱 내부 증거를 회수하려면 같은 APK와 androidTest APK를 `adb install -r`로 설치하고 `adb shell am instrument -w -r ai.mintech.kimgosu.test/androidx.test.runner.AndroidJUnitRunner`로 실행한다.
- iOS: `xcodebuild ... -destination 'platform=iOS Simulator,id=<현재 기기 UUID>' -parallel-testing-enabled NO -collect-test-diagnostics never test`. `...`에는 위 project/scheme/configuration/derivedDataPath 인수를 사용한다.
- 테스트는 로컬 스플래시, 자동 전환, 네트워크 실패, 복귀/재생성 및 실제 `https://api-dev-kimgosu.mintech.ai/health` 연결을 확인한다. 이 health의 `release`는 64자리 릴리스 manifest 해시이지 40자리 Git SHA가 아니다.
- API 검증용 Debug 인수: iOS `--verify-api`, `--offline`, `--hold-splash`; Android boolean intent extras `verify_api`, `hold_splash`.
- 화면 캡처는 테스트 전용 고정 스플래시 또는 전환 후 안정화된 실제 화면이다. 제품에 임의 지연 시간을 넣지 않는다.

현재 실행 증거·검증한 패키지 해시·제약은 `records/engineering/app-launch-01/RESULT.json` 및 REPORT.md를 따른다. 최소 OS 전체 매트릭스, 실기기, 독립 UIUX QA와 출시 승인은 별도이며 현재 로컬 모바일 변경은 GitHub에 push하지 않았다.
