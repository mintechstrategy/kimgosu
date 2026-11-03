import XCTest
final class LocalWriteTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func local(_ path:String) throws -> [String:Any] {
        let exp=expectation(description:"loopback control");var result:Result<[String:Any],Error>!
        URLSession.shared.dataTask(with:URL(string:"http://127.0.0.1:18980"+path)!) {data,response,error in
            defer {exp.fulfill()};if let error {result = .failure(error);return}
            result = Result { try JSONSerialization.jsonObject(with:data!) as! [String:Any] }
        }.resume();wait(for:[exp],timeout:12);return try result.get()
    }
    func capture(_ app:XCUIApplication,_ name:String){let a=XCTAttachment(screenshot:app.screenshot());a.name="ios-local-"+name;a.lifetime = .keepAlways;add(a)}
    func report(_ name:String) throws -> [String:Any] {
        let r=try local("/report");let a=XCTAttachment(data:try JSONSerialization.data(withJSONObject:r,options:.prettyPrinted),uniformTypeIdentifier:"public.json");a.name="local-"+name;a.lifetime = .keepAlways;add(a);return r
    }
    func rows(_ r:[String:Any])->[String:Int]{r["rows"] as! [String:Int]}
    func launch(_ mode:String, reset:Bool=true) throws -> XCUIApplication {
        if reset {_ = try local("/reset?mode="+mode)}
        let app=XCUIApplication();app.launchArguments=[mode];app.launch()
        let marker = ["consent":"약관 전체 동의 (선택 포함)","account":"알림 설정"][mode]
        if let marker {XCTAssertTrue(app.buttons[marker].waitForExistence(timeout:12))}
        else {XCTAssertTrue(app.textFields["이름 (필수)"].waitForExistence(timeout:12))}
        return app
    }
    func member(_ app:XCUIApplication){
        app.textFields["이름 (필수)"].tap();app.textFields["이름 (필수)"].typeText("로컬회원")
        app.textFields["이메일 (필수)"].tap();app.textFields["이메일 (필수)"].typeText("local@local.invalid")
        app.buttons["정보 확인 후 계속"].tap();XCTAssertTrue(app.buttons["약관 전체 동의 (선택 포함)"].waitForExistence(timeout:8))
    }
    func terms(_ app:XCUIApplication){app.buttons["약관 전체 동의 (선택 포함)"].tap();app.buttons["다음 단계"].tap();XCTAssertTrue(app.textFields["휴대폰 번호 · 010 시작 숫자 11자리"].waitForExistence(timeout:8))}
    func send(_ app:XCUIApplication){
        let phone=app.textFields["휴대폰 번호 · 010 시작 숫자 11자리"];phone.tap();phone.typeText("01012345678")
        app.buttons["인증번호 전송"].tap();XCTAssertTrue(app.buttons["인증번호 재전송"].waitForExistence(timeout:8))
    }
    func code(_ app:XCUIApplication,_ value:String){let f=app.textFields["인증번호 · 숫자 5자리"];f.tap();f.typeText(value)}
    func finish(_ app:XCUIApplication){let b=app.buttons["회원가입 완료"];XCTAssertTrue(b.waitForExistence(timeout:5));let ready=XCTNSPredicateExpectation(predicate:NSPredicate { _,_ in b.isEnabled },object:nil);XCTAssertEqual(XCTWaiter.wait(for:[ready],timeout:8),.completed,"Real CTA must become enabled; no forced state or skipped validation");b.tap()}
    func waitText(_ app:XCUIApplication,_ text:String){XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout:12))}
    func testSuccessfulSignupConsentSaveAndMarketingWithdrawal() throws {
        var app=try launch("normal");member(app);terms(app);send(app);capture(app,"sms-ready");code(app,try local("/otp")["code"] as! String);finish(app)
        XCTAssertTrue(app.buttons["알림 설정"].waitForExistence(timeout:12));XCTAssertEqual(rows(try report("signup"))["members"],2);XCTAssertEqual(rows(try local("/report"))["consents"],3);capture(app,"signup-readback");app.terminate()
        // Test-only entry into existing terms; there is no signed-in MainApp new-grant route.
        app=try launch("consent",reset:false);app.buttons["약관 전체 동의 (선택 포함)"].tap();app.buttons["다음 단계"].tap();waitText(app,"동의 저장과 서버 재조회를 확인했습니다.");XCTAssertEqual(rows(try report("consent"))["consents"],6);capture(app,"consent-readback");app.terminate()
        app=try launch("account",reset:false);app.buttons["알림 설정"].tap();let advertising=app.buttons["광고 알림"];XCTAssertTrue(advertising.waitForExistence(timeout:8));advertising.tap();sleep(1);advertising.tap();sleep(1)
        app.swipeUp();app.buttons["동의 내역·철회"].tap();let withdrawal=app.buttons["마케팅 동의 철회"];XCTAssertTrue(withdrawal.waitForExistence(timeout:8));app.swipeUp();withdrawal.tap();app.buttons["동의 철회"].tap();sleep(2)
        XCTAssertEqual(rows(try report("withdraw"))["consents"],7);capture(app,"withdraw-readback");app.terminate()
    }
    func testWrongOtpRefusesThenCorrect() throws {
        let app=try launch("normal");member(app);terms(app);send(app);let valid=try local("/otp")["code"] as! String;code(app,valid=="00000" ? "99999":"00000");finish(app)
        waitText(app,"인증번호가 잘못되었거나 만료되었습니다. 서버에서 거절했습니다. 다시 확인하거나 재전송해주세요.");XCTAssertEqual(rows(try report("wrong-otp"))["members"],1);capture(app,"wrong-otp")
        let f=app.textFields["인증번호 · 숫자 5자리"];f.tap();f.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:5)+valid);finish(app);XCTAssertTrue(app.buttons["알림 설정"].waitForExistence(timeout:12));XCTAssertEqual(rows(try report("correct-otp"))["members"],2);app.terminate()
    }
    func testExpiredOtpRefusesNoSignup() throws {
        let app=try launch("normal");member(app);terms(app);send(app);code(app,try local("/otp")["code"] as! String);_ = try local("/expire-otp");finish(app)
        waitText(app,"인증번호가 잘못되었거나 만료되었습니다. 서버에서 거절했습니다. 다시 확인하거나 재전송해주세요.");XCTAssertEqual(rows(try report("expired-otp"))["members"],1);capture(app,"expired-otp");app.terminate()
    }
    func testFinalFreshDiscardsChecks() throws {
        let app=try launch("normal");member(app);terms(app);send(app);code(app,try local("/otp")["code"] as! String);_ = try local("/revision");finish(app)
        XCTAssertTrue(app.buttons["다음 단계"].waitForExistence(timeout:12));XCTAssertFalse(app.buttons["다음 단계"].isEnabled);XCTAssertEqual(rows(try report("fresh-reset"))["members"],1);capture(app,"fresh-reset");app.terminate()
    }
    func testServer409RollsBackAndRefreshes() throws {
        let app=try launch("stale");member(app);terms(app);send(app);code(app,try local("/otp")["code"] as! String);finish(app)
        waitText(app,"정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요.");let r=rows(try report("stale"));XCTAssertEqual(r["members"],1);XCTAssertEqual(r["principals"],1);XCTAssertEqual(r["sessions"],1);XCTAssertEqual(r["consents"],0);XCTAssertEqual(r["consumed"],0);capture(app,"409-rollback");app.terminate()
    }
    func testLostResponseUnknownNoRepeatPost() throws {
        let app=try launch("lost");member(app);terms(app);send(app);code(app,try local("/otp")["code"] as! String);finish(app)
        waitText(app,"처리 결과를 확정할 수 없습니다. UNKNOWN · 자동 재전송하지 않습니다. 서버 내역을 확인하거나 새 인증을 진행해주세요.")
        app.buttons["회원가입 완료"].tap();sleep(1);let r=try report("lost-after");let posts=(r["http"] as! [[String:Any]]).filter{$0["path"] as? String == "/v1/auth/signup"};XCTAssertEqual(posts.count,1);XCTAssertEqual(rows(r)["members"],2);capture(app,"unknown-no-repeat");app.terminate()
    }
}

// KG-AUTH-APP-REPAIR-04 supplemental coverage. Not counted as original six.
extension LocalWriteTests {
    func testRepairFinalFreshReturnsOriginalRequiredFormValues() throws {
        let app=try launch("normal");member(app);terms(app);send(app);code(app,try local("/otp")["code"] as! String);_ = try local("/revision");finish(app)
        XCTAssertTrue(app.buttons["다음 단계"].waitForExistence(timeout:12));XCTAssertFalse(app.buttons["다음 단계"].isEnabled)
        app.buttons["닫기 또는 이전 화면"].tap()
        let name=app.textFields["이름 (필수)"], email=app.textFields["이메일 (필수)"]
        XCTAssertTrue(name.waitForExistence(timeout:12));XCTAssertEqual(name.value as? String,"로컬회원");XCTAssertEqual(email.value as? String,"local@local.invalid")
        let r=try report("repair-form-retained");XCTAssertEqual(rows(r)["members"],1)
        XCTAssertEqual((r["http"] as! [[String:Any]]).filter{$0["path"] as? String == "/v1/auth/signup"}.count,0)
        capture(app,"repair-form-retained");app.terminate()
    }
    func testRepairSettledWithdrawalHistoryVisible() throws {
        var app=try launch("normal");member(app);terms(app);send(app);code(app,try local("/otp")["code"] as! String);finish(app)
        XCTAssertTrue(app.buttons["알림 설정"].waitForExistence(timeout:12));app.terminate()
        app=try launch("account",reset:false);app.buttons["알림 설정"].tap();XCTAssertTrue(app.buttons["광고 알림"].waitForExistence(timeout:8))
        app.swipeUp();app.buttons["동의 내역·철회"].tap();let withdrawal=app.buttons["마케팅 동의 철회"];XCTAssertTrue(withdrawal.waitForExistence(timeout:8));app.swipeUp();withdrawal.tap();app.buttons["동의 철회"].tap()
        let history=app.staticTexts["내 동의 내역"];XCTAssertTrue(history.waitForExistence(timeout:12))
        let withdrawn=app.staticTexts.containing(NSPredicate(format:"label CONTAINS %@","WITHDRAWN")).firstMatch
        XCTAssertTrue(withdrawn.waitForExistence(timeout:12));app.swipeUp();XCTAssertTrue(withdrawn.isHittable)
        XCTAssertEqual(rows(try report("repair-withdraw-settled"))["consents"],4)
        capture(app,"repair-withdraw-settled");app.terminate()
    }
}
