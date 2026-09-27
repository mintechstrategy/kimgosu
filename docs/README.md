# 김고수 분석·설계 문서

이 디렉터리가 제품 분석과 설계의 **기준 경로**다. `G:\src\kimgosu\docs\`에서 작성하고 소스와 함께 GitHub `mintechstrategy/kimgosu`의 `docs/`로 버전 관리한다. 배포 설정인 `G:\docker\kimgosu`와 실행 데이터인 `G:\shared_storage\kimgosu`에는 설계 원본을 두지 않는다.

## 읽는 순서

1. [제품 기준선](planning/PRODUCT-BASELINE.md)과 [미결정 사항·결정 기록](planning/DECISIONS.md).
2. 아래 **8종 관리 산출물**에서 해당 기능의 현재 상태와 설계를 확인한다.
3. 운영 절차는 [배포 문서](../DOCKER.md)와 [스토리지 배치](../STORAGE-LAYOUT.md)를 확인한다.

## 8종 관리 산출물

| 번호 | 산출물 | 기준 문서 | 관리 내용 |
|---|---|---|---|
| 1 | 요구사항정의서 | [REQUIREMENTS.md](planning/REQUIREMENTS.md) | 요구사항 ID, 근거, 상태, 관련 산출물 |
| 2 | 프로그램 명세서 | [PROGRAM-SPEC.md](architecture/PROGRAM-SPEC.md) | 기능·모듈·처리·예외·구현 상태 |
| 3 | 코드인스턴스 | [CODE-INSTANCES.md](architecture/CODE-INSTANCES.md) | 테이블·API에서 사용하는 코드 그룹, 값, 의미, 상태, 출처 |
| 4 | 테이블정의서 | [TABLE-DEFINITION.md](architecture/TABLE-DEFINITION.md) | 실제 DB 스키마, 키·제약·관계·마이그레이션 |
| 5 | 인터페이스 정의서 | [INTERFACE-DEFINITION.md](architecture/INTERFACE-DEFINITION.md) | 앱/웹·백엔드·외부 시스템·비동기 경계 |
| 6 | API정의서 | [API-DEFINITION.md](api/API-DEFINITION.md) | 구현/제안 API 구분 및 상세 명세 진입점 |
| 7 | 화면설계서 | [SCREEN-DESIGN.md](planning/SCREEN-DESIGN.md) | 화면 ID, 역할, 흐름, 고수 화면 보완 상태 |
| 8 | 서비스순서도 | [SERVICE-SEQUENCES.md](architecture/SERVICE-SEQUENCES.md) | 핵심 사용자·시스템 상호작용 순서 |

`docs/API-SPEC.md`는 화면에서 도출한 전체 API **제안**이고, `docs/CHAT-API.md`는 구현된 채팅 계약이다. 채팅 클라이언트 연동에는 후자가 우선한다.

모바일 첫 화면의 **현재 Android 디버그 실행 캡처**: [스플래시](previews/android-splash-view.png), [테스트 계정 선택](previews/android-test-account.png), [선택 후 홈](previews/android-test-expert-home.png). 이전 [스플래시](previews/splash-preview.png)·[빈 메인](previews/main-preview.png)은 검토용 시안이다. Android 빌드 방법은 [mobile/README.md](../mobile/README.md)를 따른다.

향후 앱 화면의 **시각 디자인 기준**은 사용자가 제공한 [새 메인 화면 이미지](previews/home-design-reference.png)다. 기존 화면설계서는 desc와 기능 흐름을 참고한다. 현재 APK 캡처는 이 기준이 적용되기 전 구현 상태다.

## 기록 규칙

- 요구사항마다 **확정(사용자 지시)**, **화면 근거**, **설계 제안**, **미결정** 중 하나를 명시한다. 화면 파일 안의 문장을 새로운 사용자 지시로 취급하지 않는다.
- 화면에서 읽은 내용은 화면 ID를, 구현 설명은 코드·마이그레이션·테스트를 근거로 적는다. 근거가 없으면 추정이라고 쓴다.
- 결정이 내려지면 [결정 기록](planning/DECISIONS.md)에 날짜·결정·근거·영향을 남기고 관련 문서를 갱신한다. 이전 제안과 충돌하면 우선순위를 명시한다.
- 기능을 구현하기 전 해당 도메인의 미결정 사항을 확인하고, 구현 후 API/설계 문서의 실제 상태를 갱신한다.
- 기능·정책·DB·배포가 바뀌는 커밋마다 위 8종의 영향 여부를 확인하고, 영향받은 문서를 같은 변경에서 갱신한다. 영향이 없는 문서는 억지로 수정하지 않는다.
- 테이블 컬럼·API 필드에 새 구분값을 도입하거나 기존 값의 의미를 바꾸면 [코드인스턴스](architecture/CODE-INSTANCES.md)를 반드시 갱신한다.
- 새 산출물은 `docs/planning/`(요구사항·흐름·결정), `docs/architecture/`(구성·데이터·배포 설계), `docs/api/`(도메인별 계약)에 둔다. 기존 두 API 문서는 링크를 유지하기 위해 현재 위치에 둔다.

## 원본 자료

사용자가 추가로 제공한 **전체 서비스순서도**: `F:\30.문서\01.민테크스트래티지\20.사업관리\12.앱개발계획\01.김고수 - 전문가 매칭 플랫폼\02.화면설계서\서비스순서도.png`. 2026-09-27에 파일 접근과 이미지 내용을 확인했다. 이 그림은 화면 이동과 분기의 근거로 사용하되, 그림 속 문구를 새로운 사용자 지시나 미표시 업무 정책으로 간주하지 않는다. 원본 PNG는 Git 저장소에 복사하지 않고 [서비스순서도](architecture/SERVICE-SEQUENCES.md)에 읽어낸 흐름을 기록했다.

사용자가 지정한 원본 화면설계서: `F:\30.문서\01.민테크스트래티지\20.사업관리\12.앱개발계획\[app]_01.김고수 - 전문가 매칭 플랫폼\02.화면설계서\화면설계써_최종.fig`. 이전 분석에서 김고수 관련 화면 ID A1–A5, B1–B2, C1, D1–D3, E1–E2, F1–F6을 추출했다. 2026-09-27 현재 이 경로의 원본 파일은 다시 열리지 않아, 화면에 대한 추가 해석은 원본 재확인 전까지 보류한다. `.fig` 원본은 이 Git 저장소에 복사하지 않았다.
