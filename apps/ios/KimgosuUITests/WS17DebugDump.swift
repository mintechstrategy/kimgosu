import XCTest

/// 임시 진단용(작업 후 삭제). 계층 구조를 그대로 출력한다.
final class WS17DebugDump: XCTestCase {
    func testDumpHierarchy() {
        let app = XCUIApplication(); app.launchArguments = ["--clear-session"]; app.launch()
        Thread.sleep(forTimeInterval: 12)
        print("WS17DUMP-START\n" + app.debugDescription + "\nWS17DUMP-END")
    }
}
