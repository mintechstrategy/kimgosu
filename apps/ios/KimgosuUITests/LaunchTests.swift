import XCTest

final class LaunchTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    }
    @MainActor func test04ControlledProductionCoreMatrixOnSimulator() async throws {
        let rows = try await KGCoreRepairChecks.run()
        XCTAssertEqual(rows.count,145)
        let receipt = XCTAttachment(string: rows.map { "CASE " + $0 + " PASS" }.joined(separator:"\n"))
        receipt.name = "ios-controlled-core-matrix"; receipt.lifetime = .keepAlways; add(receipt)
        for row in rows { print("CASE " + row + " PASS") }
    }
    @MainActor func test05LocalPolicySnapshotOracle() async throws {
        let url = Bundle(for: Self.self).url(forResource: "oracle", withExtension: "json", subdirectory: "test-inputs")!
        let rows = try await KGPolicyChecks.run(Data(contentsOf: url))
        XCTAssertEqual(rows.count,48)
        for row in rows { print("CASE " + row + " PASS") }
    }
    func test01SplashThreeSecondsThenFormalE1() {
        let app = XCUIApplication(); app.launchArguments = ["--hold-splash"]; app.launch()
        XCTAssertTrue(app.images["splash-image"].waitForExistence(timeout: 5)); capture(app,"ios-splash-held")
        app.terminate(); app.launchArguments = []; let started = Date(); app.launch()
        XCTAssertTrue(app.staticTexts["로그인/가입"].waitForExistence(timeout: 8))
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started),3)
        XCTAssertFalse(app.images["splash-image"].exists)
        let idle = NSPredicate(format:"enabled == true"); expectation(for:idle,evaluatedWith:app.buttons["카카오로 시작"]); waitForExpectations(timeout:15)
        capture(app,"ios-E1")
        app.buttons["둘러보기"].tap()
        XCTAssertTrue(app.staticTexts["main-introduction"].waitForExistence(timeout: 3)); capture(app,"ios-A1")
        app.terminate()
    }
    func test02ProtectedCancelPreservesA1() {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["둘러보기"].waitForExistence(timeout: 8)); app.buttons["둘러보기"].tap()
        app.buttons["nav-4"].tap()
        XCTAssertTrue(app.staticTexts["로그인/가입"].waitForExistence(timeout: 3))
        app.buttons["닫기 또는 이전 화면"].tap()
        XCTAssertTrue(app.staticTexts["main-introduction"].waitForExistence(timeout: 3))
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.staticTexts["main-introduction"].waitForExistence(timeout: 3)); XCTAssertFalse(app.images["splash-image"].exists)
        capture(app,"ios-protected-cancel"); app.terminate()
    }
    func test03PublicPolicyRealApiResultAndReturn() {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["둘러보기"].waitForExistence(timeout: 8)); app.buttons["둘러보기"].tap()
        let policy = app.buttons["서비스 운영정책"]
        for _ in 0..<8 { if policy.isHittable { break }; app.scrollViews["main-scroll"].swipeUp() }
        XCTAssertTrue(policy.isHittable); policy.tap()
        let preparing = app.staticTexts["문서 준비 중입니다. 운영자 정보·시행일·법률 검토를 확인한 후 제공됩니다."]
        let failed = app.staticTexts["문서를 확인할 수 없습니다. 동의는 진행되지 않습니다."]
        let draft = app.staticTexts["사용자 검토용 초안 · 법률 확정·실제 동의용 아님"]
        let deadline = Date().addingTimeInterval(15)
        while Date()<deadline && !(preparing.exists || failed.exists || draft.exists) { Thread.sleep(forTimeInterval:0.2) }
        XCTAssertTrue(preparing.exists || failed.exists || draft.exists)
        capture(app,"ios-policy-server-result")
        app.buttons["닫기"].tap()
        XCTAssertTrue(app.buttons["로그인/가입 · 회원관리"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["서비스 운영정책"].isHittable); app.terminate()
    }
}
