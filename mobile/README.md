# 김고수 Android 첫 화면

현재 범위는 스플래시, 정적 홈(A1), 하단 독바다. 카카오·네이버·구글 회원가입과 백엔드 API 호출은 포함하지 않는다. 검색·등록·채팅·마이 탭은 선택 상태만 바뀌고 화면 본문은 비어 있다. 홈 카드와 버튼은 레이아웃 샘플이며 실제 서비스 데이터/상세 이동은 아직 없다.

빠른 시작을 위해 Java Android 기본 View만 사용하고 외부 UI 라이브러리와 시작 시 네트워크 호출을 넣지 않았다. Android 시스템 스플래시 뒤 앱 스플래시를 `MainActivity` 시작 시점부터 500ms 표시한다. 실제 기기에서 아이콘 탭부터 홈이 뜨기까지 걸리는 시간에는 OS의 콜드 스타트가 추가된다. 홈 View는 탭 왕복 때 재사용한다.

## 빌드

Android SDK API 37, JDK 17 이상, Gradle wrapper가 필요하다. Windows PowerShell 예시:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\crazy\AppData\Local\Android\Sdk'
.\gradlew.bat assembleDebug
```

출력: `app/build/outputs/apk/debug/app-debug.apk`. 이 파일은 개발용 디버그 서명 APK다. 배포용 릴리스 서명은 아직 구성하지 않았다. 패키지 ID는 `com.mintechstrategy.kimgosu`, 최소 Android API 26이다.

화면 근거와 검증 캡처는 [화면설계서](../docs/planning/SCREEN-DESIGN.md)에서 확인한다.
