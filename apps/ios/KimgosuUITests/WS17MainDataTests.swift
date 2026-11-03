import XCTest

/// WS-17 — iOS A1 메인 실데이터 연결 검증.
///
/// 모든 시나리오는 배포된 개발 API(`https://api-dev-kimgosu.mintech.ai`)에 실제로 요청한다.
/// 성공 위조는 하지 않는다.
///  - `--api-offline`            : 전송 계층 실패 주입(네트워크 실패 상태)
///  - `--api-delay-ms=5000`      : 응답 지연 주입(로딩 상태)
///  - `--api-fail-status=503`    : 클라이언트 측 오류 주입(오류·재시도 상태). 실제 서버 5xx 응답이 아니다.
///  - `--inject-expired-session` : 서버가 401로 거부하는 미서명 토큰을 Keychain에 넣는다.
///
/// 승인 디자인의 진입 흐름은 E1(로그인/가입) → "둘러보기" → A1(홈)이다. A1 홈은 탐색 상태에서만 표시된다.
final class WS17MainDataTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    }

    /// A1 세션 카드가 스크롤 아래쪽에 있으므로 보일 때까지 스크롤한다(식별자로 조회).
    private func reveal(_ app: XCUIApplication, _ identifier: String) {
        let element = app.descendants(matching: .any)[identifier]
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            app.scrollViews["main-scroll"].swipeUp()
        }
    }

    /// 승인 디자인 그대로 A1 홈이 표시될 때까지 기다린다. 세션이 없으면 E1이 먼저 뜨므로 "둘러보기"로 진입한다.
    @discardableResult
    private func waitForMain(_ app: XCUIApplication) -> Bool {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if app.staticTexts["main-introduction"].exists { return true }
            let browse = app.buttons["둘러보기"]
            if browse.exists && browse.isHittable { browse.tap(); break }
            Thread.sleep(forTimeInterval: 0.2)
        }
        let ok = app.staticTexts["main-introduction"].waitForExistence(timeout: 20)
        if !ok { print("WS17-HIERARCHY-START\n" + app.debugDescription + "\nWS17-HIERARCHY-END") }
        return ok
    }

    /// 로그인 → (실제 서버 세션) → A1 실데이터. 승인 화면을 재설계하지 않고 임시 로그인 UI를 사용한다.
    func test01EmptyStateThenDevLoginShowsRealMember() {
        let app = XCUIApplication(); app.launchArguments = ["--clear-session"]; app.launch()
        XCTAssertTrue(waitForMain(app), "A1 홈이 표시되지 않았습니다")
        let empty = app.buttons["main-session-empty"]
        reveal(app, "main-session-empty")
        XCTAssertTrue(empty.exists, "비로그인(빈) 상태가 없습니다")
        XCTAssertEqual(empty.label, "로그인/가입 · 회원관리")
        XCTAssertTrue(app.staticTexts["로그인하면 내 정보와 원장을 확인할 수 있습니다."].exists)
        capture(app, "ws17-01-empty-state")

        empty.tap()
        // E1 로그인 화면: 승인된 소셜 버튼 + 개발용 테스트 계정(서버 세션 발급)
        XCTAssertTrue(app.staticTexts["로그인/가입"].waitForExistence(timeout: 10))
        let devLogin = app.buttons["테스트 계정으로 로그인"]
        XCTAssertTrue(devLogin.waitForExistence(timeout: 20), "dev 계정 목록을 서버에서 받지 못했습니다")
        capture(app, "ws17-02-login-dev-section")
        devLogin.tap()

        // 서버가 발급한 세션으로 /v1/me를 다시 조회한 결과가 A1에 표시된다.
        let nickname = app.staticTexts["main-member-nickname"]
        if !nickname.waitForExistence(timeout: 25) {
            print("WS17-AFTER-LOGIN-START\n" + app.debugDescription + "\nWS17-AFTER-LOGIN-END")
        }
        XCTAssertTrue(nickname.exists, "로그인 후 A1 회원 정보가 표시되지 않았습니다")
        XCTAssertEqual(nickname.label, "테스트01님")
        let number = app.staticTexts["main-member-customer-number"]
        XCTAssertTrue(number.exists)
        XCTAssertTrue(number.label.hasPrefix("고객번호 "), number.label)
        let digits = number.label.replacingOccurrences(of: "고객번호 ", with: "")
        XCTAssertNotNil(Int(digits), "고객번호가 숫자가 아닙니다: " + number.label)
        XCTAssertEqual(app.staticTexts["main-member-email"].label, "test01@dev.invalid")
        XCTAssertFalse(app.staticTexts["고수 활동 중"].exists, "일반 사용자에게 고수 표시가 나오면 안 됩니다")
        reveal(app, "main-member-nickname")
        capture(app, "ws17-03-main-loaded-real-data")
        app.terminate()
    }

    /// 토큰은 Keychain에만 저장된다. 앱 재시작 후 자동 로그인되고 dev 로그인 자동화 인자 없이 동작해야 한다.
    func test02KeychainSessionSurvivesRelaunch() {
        let app = XCUIApplication(); app.launchArguments = ["--clear-session", "--dev-login-slot=11"]; app.launch()
        XCTAssertTrue(waitForMain(app))
        XCTAssertTrue(app.staticTexts["main-member-nickname"].waitForExistence(timeout: 25))
        XCTAssertEqual(app.staticTexts["main-member-nickname"].label, "테스트11님")
        XCTAssertTrue(app.staticTexts["main-member-expert"].waitForExistence(timeout: 5), "고수 계정 표시가 없습니다")
        app.terminate()

        // 인자 없이 재시작: Keychain 세션만으로 /v1/me가 다시 조회된다.
        app.launchArguments = []; app.launch()
        XCTAssertTrue(waitForMain(app))
        if !app.staticTexts["main-member-nickname"].waitForExistence(timeout: 25) {
            print("WS17-RELAUNCH-START\n" + app.debugDescription + "\nWS17-RELAUNCH-END")
        }
        XCTAssertTrue(app.staticTexts["main-member-nickname"].exists, "Keychain 세션이 유지되지 않았습니다")
        XCTAssertEqual(app.staticTexts["main-member-nickname"].label, "테스트11님")
        reveal(app, "main-member-nickname")
        capture(app, "ws17-04-keychain-relaunch")
        app.terminate()
    }

    /// 로딩 · 네트워크 실패 · 서버 오류(재시도) 상태를 각각 표시한다.
    func test03LoadingNetworkAndErrorStates() {
        // 로딩: 응답을 5초 지연시켜 A1 로딩 상태를 확인한다.
        let app = XCUIApplication()
        app.launchArguments = ["--clear-session", "--inject-expired-session", "--api-delay-ms=8000"]
        app.launch()
        XCTAssertTrue(waitForMain(app))
        let loading = app.descendants(matching: .any)["main-session-loading"]
        XCTAssertTrue(loading.waitForExistence(timeout: 10), "로딩 상태가 표시되지 않았습니다")
        reveal(app, "main-session-loading")
        XCTAssertTrue(app.descendants(matching: .any)["main-session-loading"].exists, "로딩 상태가 스크롤 후 사라졌습니다")
        capture(app, "ws17-05-loading-state")
        app.terminate()

        // 네트워크 실패: 전송 계층 실패를 주입해 네트워크 실패 문구와 재시도 버튼을 확인한다.
        app.launchArguments = ["--clear-session", "--inject-expired-session", "--api-offline"]
        app.launch()
        XCTAssertTrue(waitForMain(app))
        let network = app.staticTexts["main-session-network-failure"]
        XCTAssertTrue(network.waitForExistence(timeout: 20), "네트워크 실패 상태가 표시되지 않았습니다")
        XCTAssertEqual(network.label, "네트워크에 연결할 수 없습니다. 연결을 확인해주세요.")
        XCTAssertTrue(app.buttons["main-session-retry"].exists)
        reveal(app, "main-session-network-failure")
        capture(app, "ws17-06-network-failure-state")
        app.terminate()

        // 서버 오류(재시도): 클라이언트 측 오류 주입으로 오류 화면과 재시도 버튼을 확인한다.
        // 실제 서버 5xx 응답을 받은 증거가 아니다.
        app.launchArguments = ["--clear-session", "--inject-expired-session", "--api-fail-status=503"]
        app.launch()
        XCTAssertTrue(waitForMain(app))
        let error = app.staticTexts["main-session-error"]
        XCTAssertTrue(error.waitForExistence(timeout: 20), "오류 상태가 표시되지 않았습니다")
        XCTAssertEqual(error.label, "회원 정보를 불러오지 못했습니다.")
        let retry = app.buttons["main-session-retry"]
        XCTAssertTrue(retry.exists)
        retry.tap()
        XCTAssertTrue(app.staticTexts["main-session-error"].waitForExistence(timeout: 20), "재시도 후 오류 상태가 유지되지 않았습니다")
        reveal(app, "main-session-error")
        capture(app, "ws17-07-server-error-retry")
        app.terminate()
    }

    /// 만료 토큰으로 실제 401을 받으면 세션을 폐기하고 로그인 화면으로 복귀한다.
    func test04ExpiredSessionReturnsToLogin() {
        let app = XCUIApplication(); app.launchArguments = ["--clear-session", "--inject-expired-session"]; app.launch()
        XCTAssertTrue(waitForMain(app))
        XCTAssertTrue(app.staticTexts["다시 로그인해주세요"].waitForExistence(timeout: 20), "401 만료 안내가 없습니다")
        capture(app, "ws17-08-session-expired")
        app.buttons["다시 로그인"].tap()
        XCTAssertTrue(app.staticTexts["로그인/가입"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["테스트 계정으로 로그인"].waitForExistence(timeout: 20))
        capture(app, "ws17-09-back-to-login")
        app.terminate()

        // 만료 세션은 Keychain에서 제거되어 재시작해도 비로그인 상태여야 한다.
        app.launchArguments = []; app.launch()
        XCTAssertTrue(waitForMain(app))
        let empty = app.buttons["main-session-empty"]
        reveal(app, "main-session-empty")
        XCTAssertTrue(empty.exists, "만료 세션이 남아 있습니다")
        capture(app, "ws17-10-expired-session-cleared")
        app.terminate()
    }
}
