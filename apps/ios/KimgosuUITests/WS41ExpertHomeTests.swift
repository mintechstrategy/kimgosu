import XCTest

/// WS-41 고수 홈. 실제 개발 API(api-dev-kimgosu)에 붙여 4상태·활동 상태 저장을 확인한다.
/// 네트워크/지연/서버오류는 AuthRepository의 기존 DEBUG 훅(--api-offline, --api-delay-ms, --api-fail-status)만 사용한다.
final class WS41ExpertHomeTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ args: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = args
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func openExpertHome(_ app: XCUIApplication) {
        let entry = app.buttons["open-expert-home"]
        XCTAssertTrue(entry.waitForExistence(timeout: 25), "고수 홈 진입점이 없습니다")
        entry.tap()
        XCTAssertTrue(app.staticTexts["고수 홈"].waitForExistence(timeout: 10), "고수 홈이 열리지 않았습니다")
    }

    func testEntryPointOpensExpertHomeAndCloses() {
        app = launch(["--dev-login-slot=11"])
        openExpertHome(app)
        attach("ios-41-entry")
        // 닫기 → A1 복귀
        app.buttons["expert-close"].tap()
        XCTAssertTrue(app.staticTexts["main-introduction"].waitForExistence(timeout: 10)
                      || app.staticTexts["고객번호 23"].waitForExistence(timeout: 10), "닫은 뒤 A1로 복귀하지 않았습니다")
        app.terminate()
    }

    func testLoadedAndAvailabilityPersistsAcrossRelaunch() {
        app = launch(["--dev-login-slot=11"])
        openExpertHome(app)
        XCTAssertTrue(app.staticTexts["수신 중"].waitForExistence(timeout: 25), "활동 상태 배지가 없습니다")
        XCTAssertTrue(app.staticTexts["이번 달"].exists, "이번 달 요약이 없습니다")
        XCTAssertTrue(app.staticTexts["받은 견적"].exists, "받은 견적 지표가 없습니다")
        XCTAssertTrue(app.staticTexts["완료"].exists, "완료 지표가 없습니다")
        XCTAssertTrue(app.staticTexts["새 요청"].exists, "새 요청 목록이 없습니다")
        attach("aos-ios-41-ready")

        app.buttons["availability-PAUSED"].tap()
        XCTAssertTrue(app.staticTexts["일시중지"].waitForExistence(timeout: 15), "토글 후 배지가 바뀌지 않았습니다")
        attach("ios-41-toggled-paused")

        // 재실행 후에도 서버 값이 유지되어야 한다(로컬 저장 아님).
        app.terminate()
        app = launch(["--dev-login-slot=11"])
        openExpertHome(app)
        XCTAssertTrue(app.staticTexts["일시중지"].waitForExistence(timeout: 20), "재진입 시 활동 상태가 유지되지 않았습니다")
        attach("ios-41-persisted-paused")

        // 원복.
        app.buttons["availability-AVAILABLE"].tap()
        XCTAssertTrue(app.staticTexts["수신 중"].waitForExistence(timeout: 15), "원복 실패")
        app.terminate()
    }

    func testLoadingState() {
        app = launch(["--dev-login-slot=11", "--open-expert-home", "--api-delay-ms=6000"])
        XCTAssertTrue(app.staticTexts["고수 정보를 불러오는 중…"].waitForExistence(timeout: 25), "로딩 상태가 없습니다")
        attach("ios-41-loading")
        app.terminate()
    }

    func testNetworkFailureState() {
        app = launch(["--dev-login-slot=11", "--open-expert-home", "--api-offline"])
        XCTAssertTrue(app.staticTexts["expert-network"].waitForExistence(timeout: 25), "네트워크 실패 상태가 없습니다")
        XCTAssertTrue(app.buttons["expert-retry"].exists, "재시도 버튼이 없습니다")
        attach("ios-41-network-failure")
        app.terminate()
    }

    func testServerErrorState() {
        app = launch(["--dev-login-slot=11", "--open-expert-home", "--api-fail-status=500"])
        XCTAssertTrue(app.staticTexts["expert-error"].waitForExistence(timeout: 25), "오류 상태가 없습니다")
        XCTAssertTrue(app.buttons["expert-retry"].exists, "재시도 버튼이 없습니다")
        attach("ios-41-error")
        app.terminate()
    }

    func testEmptyStateForExpertWithoutProfile() {
        // slot 12는 EXPERT 역할이지만 프로필 행이 없어 /v1/me/expert가 실제 404 EXPERT_PROFILE_REQUIRED다.
        app = launch(["--dev-login-slot=12", "--open-expert-home"])
        XCTAssertTrue(app.staticTexts["고수 프로필이 없습니다"].waitForExistence(timeout: 25), "빈 상태가 표시되지 않았습니다")
        attach("ios-41-empty")
        app.terminate()
    }
}
