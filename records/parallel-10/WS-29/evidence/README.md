# WS-29 증거 — AOS 오프라인 콜드스타트

대상 빌드: `apps/android` dev flavor, `assembleDevDebug`(수정본), 기기: 에뮬레이터 `kg-env-resolve-02`(emulator-5560, android-35 arm64), 세션: dev API 임시 테스터 로그인으로 발급한 실제 세션(값은 저장·기록하지 않음).

| 파일 | 시나리오 | 확인된 화면 |
|---|---|---|
| `aos-offline-coldstart-a1-error-final.png` | 비행기모드 ON(`airplane_mode_on=1`, default network none) + 프로세스 강제종료 + COLD 기동, 최종 수정 APK | A1(김고수·카테고리·하단 내비) + "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요." + "다시 시도" |
| `aos-offline-coldstart-a1-error.png` | 위와 동일 시나리오의 1차 확인(수정본 초기 빌드) | 동일 |
| `aos-offline-recovered-a1-data.png` | 비행기모드 OFF(default network 복구) 후 "다시 시도" 탭 | 오류 문구 사라지고 "테스트01" / "고객번호 13"(서버 /v1/me 값) 표시 |
| `aos-red-head-offline-coldstart-login.png` | 수정 전 소스(origin/dev HEAD의 AuthModel.kt)로 재빌드 후 같은 시나리오 = RED 확인 | "로그인/가입" / "카카오로 시작" / "네이버로 시작" / "둘러보기" — PLAN이 기술한 결함 증상 |

UI 문구는 `adb shell uiautomator dump`의 텍스트로 확인했고, 스크린샷은 `adb exec-out screencap -p`로 해당 상태에서 캡처했다.

계측 시험: `OfflineColdStartTests`(3건) + `AuthModelTests`(4건) → `OK (7 tests)`.
