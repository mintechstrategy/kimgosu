import XCTest

/// WS-52 고객 거래 흐름. 실제 개발 API(api-dev-kimgosu)에 붙여 검색→상세→거래 시작→채팅 전송을 확인한다.
/// 상태 주입은 기존 DEBUG 훅(--api-offline, --api-delay-ms)만 사용한다.
final class WS52CustomerFlowTests: XCTestCase {
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

    private func openSearch(_ app: XCUIApplication) {
        let entry = app.buttons["search"]
        XCTAssertTrue(entry.waitForExistence(timeout: 25), "A1 검색 진입점이 없습니다")
        entry.tap()
        XCTAssertTrue(app.staticTexts["customer-search-title"].waitForExistence(timeout: 10)
                      || app.staticTexts["고수 찾기"].waitForExistence(timeout: 10), "고수 검색 화면이 열리지 않았습니다")
    }

    private func firstExpertCard(_ app: XCUIApplication) -> XCUIElement {
        let predicate = NSPredicate(format: "identifier BEGINSWITH 'expert-card-'")
        let card = app.buttons.matching(predicate).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 25), "고수 검색 결과가 없습니다(개발 API 응답 확인 필요)")
        return card
    }

    func testSearchThenExpertDetail() {
        app = launch(["--dev-login-slot=1"])
        openSearch(app)
        firstExpertCard(app).tap()
        XCTAssertTrue(app.staticTexts["고수 상세"].waitForExistence(timeout: 15), "고수 상세가 열리지 않았습니다")
        XCTAssertTrue(app.buttons["customer-start-deal"].waitForExistence(timeout: 15), "거래 시작 버튼이 없습니다")
        XCTAssertTrue(app.staticTexts["서비스"].exists, "서비스 구역이 없습니다")
        XCTAssertTrue(app.staticTexts["후기"].exists, "후기 구역이 없습니다")
        attach("ios-52-expert-detail")
        app.terminate()
    }

    func testStartDealOpensChat() {
        app = launch(["--dev-login-slot=1"])
        openSearch(app)
        firstExpertCard(app).tap()
        let start = app.buttons["customer-start-deal"]
        XCTAssertTrue(start.waitForExistence(timeout: 15), "거래 시작 버튼이 없습니다")
        start.tap()
        XCTAssertTrue(app.staticTexts["customer-chat-title"].waitForExistence(timeout: 20)
                      || app.staticTexts["채팅"].waitForExistence(timeout: 20), "채팅 화면이 열리지 않았습니다")
        XCTAssertTrue(app.textFields["customer-message-input"].waitForExistence(timeout: 10)
                      || app.textViews["customer-message-input"].waitForExistence(timeout: 10), "메시지 입력란이 없습니다")
        attach("ios-52-chat")
        app.terminate()
    }

    func testSendTextMessageAndSeeItAfterReload() {
        app = launch(["--dev-login-slot=1"])
        openSearch(app)
        firstExpertCard(app).tap()
        let start = app.buttons["customer-start-deal"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        start.tap()
        let field = app.textFields["customer-message-input"].exists
            ? app.textFields["customer-message-input"] : app.textViews["customer-message-input"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "메시지 입력란이 없습니다")
        field.tap()
        let text = "WS-52 iOS 확인 " + String(Int(Date().timeIntervalSince1970))
        field.typeText(text)
        app.buttons["customer-message-send"].tap()
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 20), "전송한 메시지가 다시 조회되지 않았습니다")
        attach("ios-52-message-sent")
        app.terminate()
    }

    func testNetworkFailureShowsRetry() {
        app = launch(["--dev-login-slot=1", "--api-offline"])
        openSearch(app)
        XCTAssertTrue(app.staticTexts["customer-network-failure"].waitForExistence(timeout: 25), "네트워크 실패 상태가 없습니다")
        XCTAssertTrue(app.buttons["customer-retry"].exists, "재시도 버튼이 없습니다")
        attach("ios-52-network")
        app.terminate()
    }

    /// slot 5는 서버에 완료된 거래만 있고 후기는 없다(사전 합성). 후기 등록 성공 경로를 확인한다.
    func testReviewSubmissionOnCompletedDeal() {
        app = launch(["--dev-login-slot=5"])
        openSearch(app)
        firstExpertCard(app).tap()
        let start = app.buttons["customer-start-deal"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        start.tap()
        let review = app.buttons["customer-write-review"]
        XCTAssertTrue(review.waitForExistence(timeout: 20), "완료된 거래에 후기 작성 버튼이 없습니다")
        review.tap()
        app.buttons["customer-rating-5"].tap()
        let field = app.textViews["customer-review-body"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "후기 입력란이 없습니다")
        field.tap()
        field.typeText("WS-52 iOS review check")
        attach("ios-52-review-form")
        app.buttons["customer-review-submit"].tap()
        XCTAssertTrue(app.staticTexts["고수 상세"].waitForExistence(timeout: 20), "후기 등록 후 상세로 돌아가지 않았습니다")
        XCTAssertFalse(app.staticTexts["customer-review-error"].exists, "후기 등록 오류가 표시되었습니다")
        attach("ios-52-review-done")
        app.terminate()
    }

    /// slot 6은 고객만 완료 확인을 한 ACCEPTED 거래다. '상대 확인 대기' 표시를 실제 응답으로 확인한다.
    func testOneSidedCompletionShowsWaiting() {
        app = launch(["--dev-login-slot=6"])
        openSearch(app)
        firstExpertCard(app).tap()
        let start = app.buttons["customer-start-deal"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        start.tap()
        XCTAssertTrue(app.staticTexts["customer-waiting-counterpart"].waitForExistence(timeout: 20), "상대 확인 대기가 표시되지 않았습니다")
        attach("ios-52-waiting-counterpart")
        app.terminate()
    }
}
