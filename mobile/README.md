# 김고수 Android 테스트 앱

디버그 APK는 스플래시를 약 0.5초 표시한 뒤 임시 계정 선택(T1)으로 이동한다. 번호 1–50을 입력하고 일반/고수 역할을 골라 총 100개 합성 계정 중 하나를 선택하면 LAN 테스트 API `http://192.168.0.213:23913/api/v1/auth/test-login`을 호출한다. 서버가 합성 CI로 고객원장을 조회하거나 새 `test_` 사용자 ID를 발급하고 JWT·프로필을 반환한 뒤 홈에 진입한다. 연결 실패 시 계정 선택 화면으로 돌아간다. 실제 카카오·네이버 회원가입은 아직 구현하지 않았다.

홈·검색·등록·채팅·마이는 각각 독립 WebView다. 필요할 때 만들고 탭을 바꿔도 재사용한다. 뒤로가기는 현재 페이지 기록, 이전 탭, 홈, 앱 종료 순이다. 홈은 새 디자인 참조의 색상·카드 스타일을 적용한 정적 화면이고, 마이는 서버가 반환한 테스트 프로필을 표시한다. 서비스·견적 탐색/등록/상세, 찜, 제안, 독립 채팅, 양측 거래 완료·리뷰, 마이·고수 모드를 API와 연결했다. 첨부 화면·실시간 WebSocket UI·실제 간편인증은 후속이다.

합성 CI·테스트 API 주소는 `app/src/debug/`에만 있다. 릴리스 빌드에는 계정 선택 UI와 합성 CI가 없다. 임시 화면을 제거하려면 `TestAccountGate.enabled()`를 `false`로 바꾸고 이후 두 변형의 stub 및 `MainActivity` 호출을 제거하면 된다. 디버그 JWT는 앱 메모리에만 두며 재시작 시 재로그인한다. LAN 테스트 포트 23913은 공유기에서 외부 포워딩하지 않는다.

## 빌드

Windows PowerShell에서 JDK 17+, Android SDK API 37을 설정한다.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\crazy\AppData\Local\Android\Sdk'
.\gradlew.bat assembleDebug
```

출력은 `app/build/outputs/apk/debug/app-debug.apk`, 검증한 복사본은 `dist/kimgosu-v0.5.0-100accounts-chat-review-debug.apk`다. 개발용 디버그 서명 APK이며 배포용 릴리스 서명은 아직 구성하지 않았다. 패키지 ID는 `com.mintechstrategy.kimgosu`, 최소 Android API 26이다. 화면 근거와 캡처는 [화면설계서](../docs/planning/SCREEN-DESIGN.md)를 본다.

홈은 분야 코드를 서버에서 조회하되 번들 목록으로 즉시 표시합니다. 기타 없이 원본 디자인의 4열×2행 정사각형 카드를 함께 좌우로 넘길 수 있습니다. 제공된 디자인의 크기·색·간격을 따르고, 원본 PNG를 변경 없이 앱 자산에 복사해 일러스트·서비스 사진에 사용합니다. 대량 시나리오 테스트용 `[TEST ...]` 서비스는 홈 예시 카드를 대체하지 않으며 검색에서 조회할 수 있습니다. 0.5.0 빌드를 에뮬레이터에 설치해 계정 선택·로그인·홈 이미지 표시를 확인했습니다. 좌상단 지역명을 누르면 시·도/시·군·구와 비대면 여부를 선택하고, 완료 시 홈으로 돌아옵니다. 선택값은 기기에 저장되고 서비스·견적 결과 필터에 반영됩니다. 관리자 웹 편집은 후속 작업입니다.
