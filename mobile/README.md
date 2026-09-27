# 김고수 Android 테스트 앱

디버그 APK는 스플래시를 약 0.5초 표시한 뒤 임시 계정 선택(T1)으로 이동한다. 일반 2명·고수 2명 중 하나를 선택하면 LAN 테스트 API `http://192.168.0.213:23913/api/v1/auth/test-login`을 호출한다. 서버가 합성 CI로 고객원장을 조회하거나 새 `test_` 사용자 ID를 발급하고 JWT·프로필을 반환한 뒤 홈에 진입한다. 연결 실패 시 계정 선택 화면으로 돌아간다. 실제 카카오·네이버 회원가입은 아직 구현하지 않았다.

홈·검색·등록·채팅·마이는 각각 독립 WebView다. 필요할 때 만들고 탭을 바꿔도 재사용한다. 뒤로가기는 현재 페이지 기록, 이전 탭, 홈, 앱 종료 순이다. 홈은 새 디자인 참조의 색상·카드 스타일을 적용한 정적 화면이고, 마이는 서버가 반환한 테스트 프로필을 표시한다. 나머지 탭의 업무 기능은 자리표시 화면이다.

합성 CI·테스트 API 주소는 `app/src/debug/`에만 있다. 릴리스 빌드에는 계정 선택 UI와 합성 CI가 없다. 임시 화면을 제거하려면 `TestAccountGate.enabled()`를 `false`로 바꾸고 이후 두 변형의 stub 및 `MainActivity` 호출을 제거하면 된다. 디버그 JWT는 앱 메모리에만 두며 재시작 시 재로그인한다. LAN 테스트 포트 23913은 공유기에서 외부 포워딩하지 않는다.

## 빌드

Windows PowerShell에서 JDK 17+, Android SDK API 37을 설정한다.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\crazy\AppData\Local\Android\Sdk'
.\gradlew.bat assembleDebug
```

출력은 `app/build/outputs/apk/debug/app-debug.apk`, 사용자용 복사본은 `dist/kimgosu-v0.3.0-test-debug.apk`다. 개발용 디버그 서명 APK이며 배포용 릴리스 서명은 아직 구성하지 않았다. 패키지 ID는 `com.mintechstrategy.kimgosu`, 최소 Android API 26이다. 화면 근거와 캡처는 [화면설계서](../docs/planning/SCREEN-DESIGN.md)를 본다.
