import XCTest
final class PolicyComponentTests:XCTestCase {
    override func setUpWithError() throws {continueAfterFailure=false}
    func capture(_ app:XCUIApplication,_ name:String){let a=XCTAttachment(screenshot:app.screenshot());a.name=name;a.lifetime = .keepAlways;add(a)}
    func launch(_ mode:String)->XCUIApplication{let app=XCUIApplication();app.launchArguments=[mode];app.launch();XCTAssertTrue(app.buttons["약관 전체 동의 (선택 포함)"].waitForExistence(timeout:8));return app}
    @MainActor func testModelMatrices() async throws {
        let core=try await KGCoreRepairChecks.run();XCTAssertEqual(core.count,145);for row in core {print("CASE " + row + " PASS")}
        let url=Bundle(for:Self.self).url(forResource:"oracle",withExtension:"json",subdirectory:"test-inputs")!
        let policy=try await KGPolicyChecks.run(Data(contentsOf:url));XCTAssertEqual(policy.count,48);for row in policy {print("CASE " + row + " PASS")}
    }
    func testReadyDocumentAndReturn(){
        let app=launch("ready")
        app.buttons["약관 전체 동의 (선택 포함)"].tap()
        XCTAssertTrue(app.buttons["다음 단계"].isEnabled)
        app.buttons.matching(identifier:"전문 보기  ›").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["통제 시험 TERMS"].waitForExistence(timeout:4))
        capture(app,"ios-v03-ready-document")
        app.buttons["닫기"].tap();XCTAssertTrue(app.buttons["다음 단계"].waitForExistence(timeout:4));XCTAssertTrue(app.buttons["다음 단계"].isEnabled)
        capture(app,"ios-v03-ready-return");app.terminate()
    }
    func testFinalFreshRevisionDiscardsChecks(){
        let app=launch("revision");app.buttons["약관 전체 동의 (선택 포함)"].tap();XCTAssertTrue(app.buttons["다음 단계"].isEnabled);app.buttons["다음 단계"].tap()
        XCTAssertTrue(app.staticTexts["정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요."].waitForExistence(timeout:4));XCTAssertFalse(app.buttons["다음 단계"].isEnabled)
        capture(app,"ios-v03-revision-reset");app.terminate()
    }
    func testPublic503RetryDraftClose(){
        let app=launch("retry");app.buttons.matching(identifier:"전문 보기  ›").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["문서를 확인할 수 없습니다. 동의는 진행되지 않습니다."].waitForExistence(timeout:4));capture(app,"ios-v03-503-error")
        app.buttons["다시 시도"].tap();XCTAssertTrue(app.staticTexts["사용자 검토용 초안 · 법률 확정·실제 동의용 아님"].waitForExistence(timeout:4));capture(app,"ios-v03-retry-draft")
        app.buttons["닫기"].tap();XCTAssertTrue(app.buttons["다음 단계"].waitForExistence(timeout:4));XCTAssertFalse(app.buttons["다음 단계"].isEnabled);capture(app,"ios-v03-draft-return");app.terminate()
    }
}
