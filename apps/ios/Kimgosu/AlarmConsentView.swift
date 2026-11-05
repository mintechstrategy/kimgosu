import SwiftUI
import UIKit
import Network
import UserNotifications

struct ConsentRecord: Equatable {
    let kind: String
    let title: String?
    let version: String?
    let status: String?
    let recordedAt: String?
}

/// 설정·알림 동의 화면의 서버/로컬 상태. 화면은 이 값만 그린다.
@MainActor final class AlarmConsentModel: ObservableObject {
    enum Fetch { case loading, ready, empty, error, offline }
    enum Marketing { case consented, notConsented, unknown }
    enum OsState { case allowed, denied, undecided, unknown }
    enum Edit: Equatable {
        case idle
        case saving(String)
        case saved(String)
        case error(String, network: Bool)
        case uncertain
        case refreshed
    }
    enum Withdraw: Equatable {
        case closed, checking, question, working, empty, unavailable, error, offline, uncertain
    }
    enum Doc: Equatable {
        case loading
        case ready(version: String, effectiveAt: String, body: String, draft: Bool)
        case empty, error, offline, metaMissing, preparing
    }
    enum Permission: Equatable { case loading, denied, unknownOs, failed }

    @Published private(set) var fetch: Fetch = .loading
    @Published private(set) var values: [String: Bool] = [:]
    @Published private(set) var marketing: Marketing = .unknown
    @Published private(set) var records: [ConsentRecord]?
    @Published private(set) var edit: Edit = .idle
    @Published private(set) var withdraw: Withdraw = .closed
    @Published private(set) var withdrawDone = false
    @Published private(set) var doc: Doc = .loading
    @Published private(set) var os: OsState = .unknown
    @Published private(set) var osError = false
    @Published private(set) var osOffline = false
    @Published private(set) var permission: Permission?
    private var version = 0
    private var job: Task<Void, Never>?

    private let repository = KGAuthRepository()
    private let sessions = KGSecureSession()
    private let network = ConsentNetwork.shared

    var writesLocked: Bool {
        if case .saving = edit { return true }
        if case .uncertain = edit { return true }
        if withdraw == .working { return true }
        return false
    }
    var hasValues: Bool { !values.isEmpty }
    var canWithdraw: Bool { marketing == .consented && !writesLocked }

    func refreshOsPermission() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            switch settings.authorizationStatus {
            case .authorized: os = .allowed
            case .denied: os = .denied
            case .notDetermined: os = .undecided
            // 제한적 허용(provisional/ephemeral)은 허용으로 과장하지 않고 확인 불가로 남긴다.
            default: os = .unknown
            }
        }
    }

    func load() {
        guard let token = try? sessions.read() else { fetch = .error; return }
        job?.cancel()
        if values.isEmpty { fetch = .loading }
        job = Task {
            do {
                let prefs = try await repository.notifications(token)
                let consents = try await repository.consents(token)
                guard let parsed = preferences(prefs) else {
                    // 누락된 선호는 거짓(OFF)이 아니다. 값을 만들지 않고 빈 상태로 알린다.
                    fetch = .empty
                    return
                }
                version = parsed.version
                values = parsed.values
                let fresh = consentRecords(consents)
                records = fresh
                marketing = marketingStatus(fresh)
                fetch = .ready
                edit = .idle
            } catch {
                fetch = KGNetworkFailure.isNetwork(error) ? .offline : .error
            }
        }
    }

    func toggle(_ key: String, _ value: Bool) {
        guard let token = try? sessions.read(), !writesLocked, fetch == .ready else { return }
        if key == "advertising" && marketing != .consented { return }
        if !network.online { edit = .error(key, network: true); return }
        job?.cancel()
        edit = .saving(key)
        job = Task {
            do {
                _ = try await repository.changeNotification(token, version: version, key: key, value: value)
                // 응답만으로 저장 성공을 단정하지 않는다. 같은 계정에서 다시 읽어 확인한다.
                guard let parsed = preferences(try await repository.notifications(token)) else {
                    edit = .uncertain
                    return
                }
                version = parsed.version
                values = parsed.values
                edit = parsed.values[key] == value ? .saved(key) : .refreshed
            } catch {
                if let api = error as? KGAuthAPIError, api.status == 409 {
                    load()
                    edit = .refreshed
                } else if KGNetworkFailure.isNetwork(error) {
                    edit = .uncertain
                } else {
                    edit = .error(key, network: false)
                }
            }
        }
    }

    /// 재시도는 최신값을 다시 읽기만 한다. 보낸 요청을 자동 재전송하지 않는다.
    func retryEdit() {
        edit = .idle
        load()
        edit = .refreshed
    }

    func openDocument() {
        job?.cancel()
        doc = .loading
        job = Task {
            do {
                let body = try await repository.policy(.MARKETING)
                let status = body["status"] as? String ?? ""
                let text = body["body"] as? String ?? ""
                let docVersion = body["version"] as? String ?? ""
                let effectiveAt = body["effectiveAt"] as? String ?? ""
                if status == "READY" && (docVersion.isEmpty || effectiveAt.isEmpty) { doc = .metaMissing }
                else if status == "READY" && text.isEmpty { doc = .empty }
                else if status == "READY" || status == "DRAFT" { doc = .ready(version: docVersion, effectiveAt: effectiveAt, body: text, draft: status == "DRAFT") }
                else { doc = .preparing }
            } catch {
                if let api = error as? KGAuthAPIError, api.status == 404 { doc = .preparing }
                else { doc = KGNetworkFailure.isNetwork(error) ? .offline : .error }
            }
        }
    }

    func startWithdraw() {
        guard let token = try? sessions.read(), canWithdraw else { return }
        job?.cancel()
        withdraw = .checking
        job = Task {
            do {
                let fresh = consentRecords(try await repository.consents(token))
                apply(fresh)
                switch marketing {
                case .consented: withdraw = .question
                case .notConsented: withdraw = .empty
                case .unknown: withdraw = .unavailable
                }
            } catch {
                withdraw = KGNetworkFailure.isNetwork(error) ? .offline : .error
            }
        }
    }

    func confirmWithdraw() {
        guard let token = try? sessions.read(), withdraw == .question else { return }
        if !network.online { withdraw = .offline; return }
        job?.cancel()
        withdraw = .working
        job = Task {
            do {
                _ = try await repository.withdrawMarketing(token)
                let fresh = consentRecords(try await repository.consents(token))
                let prefs = preferences(try await repository.notifications(token))
                apply(fresh)
                if let prefs { values = prefs.values }
                if reflected(fresh, prefs: prefs?.values) {
                    withdraw = .closed
                    withdrawDone = true
                    fetch = .ready
                    edit = .idle
                } else {
                    withdraw = .uncertain
                }
            } catch {
                if KGNetworkFailure.isNetwork(error) { withdraw = .uncertain } else { withdraw = .error }
            }
        }
    }

    /// 현재 상태 확인: 다시 읽어서 일치하면 완료, 동의가 남아 있으면 질문으로 돌아간다.
    func checkWithdraw() {
        guard let token = try? sessions.read() else { return }
        job?.cancel()
        withdraw = .checking
        job = Task {
            do {
                let fresh = consentRecords(try await repository.consents(token))
                let prefs = preferences(try await repository.notifications(token))
                apply(fresh)
                if let prefs { values = prefs.values }
                if marketing == .consented { withdraw = .question }
                else if marketing == .unknown { withdraw = .unavailable }
                else if reflected(fresh, prefs: prefs?.values) { withdrawDone = true; fetch = .ready; withdraw = .closed }
                else { withdraw = .uncertain }
            } catch {
                withdraw = KGNetworkFailure.isNetwork(error) ? .offline : .error
            }
        }
    }

    func retryWithdraw() { withdraw = .question; startWithdraw() }
    func dismissWithdraw() { withdraw = .closed }

    func openOsSettings() {
        osOffline = !network.online
        osError = false
        // 명시적 거부일 때만 안내 모달을 먼저 띄운다. 화면 진입이나 스위치 조작으로 권한 팝업을 열지 않는다.
        if os == .denied { permission = .denied } else { openSettings() }
    }

    func confirmOsSettings() {
        permission = .loading
        if openSettings() { permission = nil } else { permission = .failed }
    }

    func retryOsSettings() {
        permission = .loading
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if settings.authorizationStatus == .denied { os = .denied; permission = .denied }
            else if settings.authorizationStatus == .notDetermined { os = .undecided; permission = nil }
            else { os = .allowed; permission = nil }
        }
    }

    func dismissPermission() { permission = nil }

    @discardableResult
    private func openSettings() -> Bool {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { osError = true; return false }
        UIApplication.shared.open(url)
        return true
    }

    private func apply(_ fresh: [ConsentRecord]) {
        records = fresh
        marketing = marketingStatus(fresh)
    }

    /// 철회 성공은 현재 미동의·광고 OFF·실제 철회 이력이 모두 서버 재조회로 확인된 경우에만 인정한다.
    private func reflected(_ fresh: [ConsentRecord], prefs: [String: Bool]?) -> Bool {
        marketingStatus(fresh) == .notConsented &&
            fresh.first(where: { $0.kind == "MARKETING" })?.status == "WITHDRAWN" &&
            prefs?["advertising"] == false
    }

    private func preferences(_ json: [String: Any]) -> (version: Int, values: [String: Bool])? {
        guard let raw = json["version"] as? Int, raw >= 0 else { return nil }
        var parsed: [String: Bool] = [:]
        for key in ["advertising", "chat", "comment", "quote", "inquiry"] {
            guard let value = json[key] as? Bool else { return nil }
            parsed[key] = value
        }
        return (raw, parsed)
    }

    private func consentRecords(_ json: [String: Any]) -> [ConsentRecord] {
        let rows = json["records"] as? [[String: Any]] ?? []
        let parsed = rows.map { row in
            func text(_ key: String) -> String? {
                guard let value = row[key] as? String, !value.isEmpty else { return nil }
                return value
            }
            return ConsentRecord(kind: row["kind"] as? String ?? "", title: text("title"), version: text("version"),
                                 status: text("status"), recordedAt: text("recordedAt"))
        }
        // 서버가 준 최신 기록 순서를 유지하고 같은 이력 식별자만 한 번 표시한다.
        var seen = Set<String>()
        return parsed.filter { seen.insert("\($0.kind)|\($0.version ?? "")|\($0.status ?? "")|\($0.recordedAt ?? "")").inserted }
    }

    /// 현재 동의값이 확인되지 않으면 미동의로 추정하지 않고 UNKNOWN으로 둔다.
    private func marketingStatus(_ rows: [ConsentRecord]) -> Marketing {
        switch rows.first(where: { $0.kind == "MARKETING" })?.status {
        case "GRANTED": return .consented
        case "WITHDRAWN": return .notConsented
        default: return .unknown
        }
    }
}

/// 서버 통신 전에 로컬 네트워크 상태만 확인한다. 이 값으로 저장 성공을 만들지 않는다.
final class ConsentNetwork {
    static let shared = ConsentNetwork()
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "kimgosu.consent.network")
    private var status: NWPath.Status = .requiresConnection
    private init() {
        monitor.pathUpdateHandler = { [weak self] path in self?.status = path.status }
        monitor.start(queue: queue)
    }
    var online: Bool { status == .satisfied }
}

private let consentTimeFormat: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy.MM.dd HH:mm:ss"
    return formatter
}()

private func recordedText(_ text: String?) -> String? {
    guard let text else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text) else { return nil }
    return consentTimeFormat.string(from: date)
}

private func marketingLabel(_ status: AlarmConsentModel.Marketing) -> String {
    switch status {
    case .consented: return AlarmConsentStrings.S_MARKETING_YES
    case .notConsented: return AlarmConsentStrings.S_MARKETING_NO
    case .unknown: return AlarmConsentStrings.S_MARKETING_UNKNOWN
    }
}

private func osLabel(_ state: AlarmConsentModel.OsState) -> String {
    switch state {
    case .allowed: return AlarmConsentStrings.S_OS_ALLOWED
    case .denied: return AlarmConsentStrings.S_OS_DENIED
    case .undecided: return AlarmConsentStrings.S_OS_UNDECIDED
    case .unknown: return AlarmConsentStrings.S_OS_UNKNOWN
    }
}

private func statusLabel(_ status: String?) -> String {
    switch status {
    case "GRANTED": return AlarmConsentStrings.H_GRANTED
    case "WITHDRAWN": return AlarmConsentStrings.H_WITHDRAWN
    default: return AlarmConsentStrings.H_STATUS_MISSING
    }
}

/// F4_NOTI·CONSENT_HISTORY·MARKETING_DOC와 두 모달. 진입 화면만 바깥에서 정한다.
enum ConsentStart { case notifications, history }

struct KGAlarmConsentView: View {
    let start: ConsentStart
    let onExit: () -> Void
    @StateObject private var model = AlarmConsentModel()
    @Environment(\.scenePhase) private var scenePhase

    private enum Route { case notifications, history, document }
    @State private var route: Route
    @State private var documentReturn: Route = .history
    @State private var announced = ""

    init(start: ConsentStart, onExit: @escaping () -> Void) {
        self.start = start
        self.onExit = onExit
        _route = State(initialValue: start == .history ? .history : .notifications)
    }

    var body: some View {
        VStack(spacing: ConsentTokens.spacingNone) {
            switch route {
            case .notifications: notificationsPage
            case .history: historyPage
            case .document: documentPage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(ConsentTokens.background)
        .foregroundStyle(DesignTokens.navy)
        .overlay { if model.withdraw != .closed { withdrawModal } }
        .overlay { if let permission = model.permission { permissionModal(permission) } }
        .task {
            model.refreshOsPermission()
            if !model.writesLocked { model.load() }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { model.refreshOsPermission() } }
        .onChange(of: model.edit) { _, value in
            if case .saved = value {
                UIAccessibility.post(notification: .announcement, argument: AlarmConsentStrings.S_SAVED)
            }
        }
        .onChange(of: model.withdrawDone) { _, done in
            if done { UIAccessibility.post(notification: .announcement, argument: AlarmConsentStrings.H_WITHDRAW_DONE) }
        }
    }

    private func goBack() {
        switch route {
        case .document: route = documentReturn
        case .history: if start == .history { onExit() } else { route = .notifications }
        case .notifications: onExit()
        }
    }

    private func header(_ title: String, back: @escaping () -> Void) -> some View {
        HStack(spacing: ConsentTokens.headerItemGap) {
            Button(action: back) {
                Text("‹").font(.custom("Pretendard-Regular", size: ConsentTokens.stateTitle, relativeTo: .title2))
                    .frame(width: ConsentTokens.touchMinimum, height: ConsentTokens.touchMinimum)
            }.accessibilityLabel(AlarmConsentStrings.BACK)
            copy(title, size: ConsentTokens.screenTitle, bold: true).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
        }.padding(.horizontal, ConsentTokens.screenHorizontal).padding(.vertical, ConsentTokens.headerVertical)
    }

    private var notificationsPage: some View {
        VStack(spacing: ConsentTokens.spacingNone) {
            header(AlarmConsentStrings.S_TITLE, back: goBack)
            ScrollView {
                VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
                    copy(AlarmConsentStrings.S_SECTION, size: ConsentTokens.stateTitle, bold: true).accessibilityAddTraits(.isHeader)
                    copy(AlarmConsentStrings.S_DESCRIPTION)
                    copy(osLabel(model.os), size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                        .accessibilityIdentifier("os-permission")
                    secondaryButton(AlarmConsentStrings.S_OS_SETTINGS, action: model.openOsSettings)
                    if model.osError {
                        copy(AlarmConsentStrings.S_OS_ERROR, color: ConsentTokens.errorText)
                        secondaryButton(AlarmConsentStrings.RETRY, action: model.openOsSettings)
                    }
                    Spacer().frame(height: ConsentTokens.sectionGap)

                    switch model.fetch {
                    case .loading:
                        if model.hasValues { preferenceRows(locked: true) } else { progressBlock(AlarmConsentStrings.S_LOADING) }
                    case .empty:
                        stateBlock(AlarmConsentStrings.S_EMPTY)
                        secondaryButton(AlarmConsentStrings.RETRY, action: model.load)
                    case .error:
                        stateBlock(AlarmConsentStrings.S_ERROR)
                        secondaryButton(AlarmConsentStrings.RETRY, action: model.load)
                        if model.hasValues { preferenceRows(locked: true) }
                    case .offline:
                        stateBlock(AlarmConsentStrings.S_OFFLINE)
                        secondaryButton(AlarmConsentStrings.RETRY, action: model.load)
                        if model.hasValues { preferenceRows(locked: true) }
                    case .ready:
                        preferenceRows(locked: false)
                    }

                    Spacer().frame(height: ConsentTokens.sectionGap)
                    copy(marketingLabel(model.marketing), size: ConsentTokens.rowTitle, bold: true)
                        .accessibilityIdentifier("marketing-status")
                    copy(AlarmConsentStrings.S_MARKETING_DESCRIPTION, color: ConsentTokens.secondaryText)
                    secondaryButton(AlarmConsentStrings.S_CONSENT_HISTORY, action: { route = .history })
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, ConsentTokens.screenHorizontal)
                .padding(.bottom, ConsentTokens.bodyVertical)
            }
        }
    }

    private func preferenceRows(locked: Bool) -> some View {
        let rows: [(key: String, label: String)] = [
            (key: "advertising", label: AlarmConsentStrings.S_ADVERTISING),
            (key: "chat", label: AlarmConsentStrings.S_CHAT),
            (key: "comment", label: AlarmConsentStrings.S_COMMENT),
            (key: "quote", label: AlarmConsentStrings.S_QUOTE),
            (key: "inquiry", label: AlarmConsentStrings.S_INQUIRY),
        ]
        return VStack(alignment: .leading, spacing: ConsentTokens.spacingNone) {
            ForEach(rows, id: \.key) { row in
                let key = row.key
                let label = row.label
                let checked = model.values[key] == true
                let saving = model.edit == .saving(key)
                let marketingBlocked = key == "advertising" && model.marketing != .consented
                let disabled = locked || model.writesLocked || marketingBlocked
                HStack(spacing: ConsentTokens.rowItemGap) {
                    copy(label, size: ConsentTokens.rowTitle)
                    Spacer(minLength: 0)
                    ConsentSwitch(on: checked, label: label,
                                  value: saving ? AlarmConsentStrings.STATE_BUSY : (disabled ? AlarmConsentStrings.STATE_DISABLED : (checked ? AlarmConsentStrings.STATE_ON : AlarmConsentStrings.STATE_OFF)),
                                  enabled: !disabled) { model.toggle(key, $0) }
                        .accessibilityIdentifier("switch-\(key)")
                }
                .padding(.vertical, ConsentTokens.rowVertical)
                .frame(minHeight: ConsentTokens.touchMinimum)
                if marketingBlocked {
                    copy(AlarmConsentStrings.S_MARKETING_REQUIRED, size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                        .accessibilityIdentifier("marketing-required")
                }
                switch model.edit {
                case .saving(let savingKey) where savingKey == key:
                    rowStatus(AlarmConsentStrings.S_SAVING, error: false)
                case .error(let errorKey, let network) where errorKey == key:
                    rowStatus(network ? AlarmConsentStrings.S_SAVE_OFFLINE : AlarmConsentStrings.S_SAVE_ERROR, error: true)
                    secondaryButton(AlarmConsentStrings.RETRY, action: model.retryEdit)
                case .uncertain:
                    rowStatus(AlarmConsentStrings.S_UNCERTAIN, error: true)
                    secondaryButton(AlarmConsentStrings.RETRY, action: model.retryEdit)
                default:
                    EmptyView()
                }
                Divider().overlay(ConsentTokens.separator)
            }
        }
    }

    private var historyPage: some View {
        VStack(spacing: ConsentTokens.spacingNone) {
            header(AlarmConsentStrings.H_TITLE, back: goBack)
            ScrollView {
                VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
                    if model.withdrawDone {
                        copy(AlarmConsentStrings.H_WITHDRAW_DONE, size: ConsentTokens.rowTitle, bold: true)
                            .accessibilityIdentifier("withdraw-done")
                        copy(AlarmConsentStrings.H_WITHDRAW_EFFECT, color: ConsentTokens.secondaryText)
                        Spacer().frame(height: ConsentTokens.sectionGap)
                    }
                    copy(AlarmConsentStrings.H_HEADING, size: ConsentTokens.stateTitle, bold: true).accessibilityAddTraits(.isHeader)
                    copy(AlarmConsentStrings.H_DESCRIPTION, color: ConsentTokens.secondaryText)
                    copy(marketingLabel(model.marketing), size: ConsentTokens.rowTitle, bold: true)
                        .accessibilityIdentifier("history-marketing")
                    Spacer().frame(height: ConsentTokens.sectionGap)

                    switch model.fetch {
                    case .loading: if model.records == nil { progressBlock(AlarmConsentStrings.H_LOADING) }
                    case .error:
                        stateBlock(AlarmConsentStrings.H_ERROR)
                        secondaryButton(AlarmConsentStrings.RETRY, action: model.load)
                    case .offline:
                        stateBlock(AlarmConsentStrings.H_OFFLINE)
                        secondaryButton(AlarmConsentStrings.RETRY, action: model.load)
                    default: EmptyView()
                    }
                    if let records = model.records, records.isEmpty {
                        copy(AlarmConsentStrings.H_EMPTY, size: ConsentTokens.rowTitle, bold: true).accessibilityIdentifier("history-empty")
                        copy(AlarmConsentStrings.H_EMPTY_GUIDE, color: ConsentTokens.secondaryText)
                    }
                    ForEach(Array((model.records ?? []).enumerated()), id: \.offset) { entry in
                        let record = entry.element
                        VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
                            copy(record.title ?? AlarmConsentStrings.H_TITLE_MISSING, size: ConsentTokens.rowTitle, bold: true)
                            copy(record.version.map(AlarmConsentStrings.hVersion) ?? AlarmConsentStrings.H_VERSION_MISSING,
                                 size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                            copy(statusLabel(record.status))
                            copy(recordedText(record.recordedAt).map(AlarmConsentStrings.hRecorded) ?? AlarmConsentStrings.H_TIME_MISSING,
                                 size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                        }
                        .padding(.vertical, ConsentTokens.rowVertical)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("history-row")
                        Divider().overlay(ConsentTokens.separator)
                    }
                    if model.marketing == .notConsented {
                        copy(AlarmConsentStrings.H_NOT_CONSENTED, size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                    }
                    if model.marketing == .unknown {
                        copy(AlarmConsentStrings.H_STATUS_UNKNOWN, size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                    }
                    Spacer().frame(height: ConsentTokens.sectionGap)
                    secondaryButton(AlarmConsentStrings.H_DOCUMENT) {
                        documentReturn = .history
                        route = .document
                        model.openDocument()
                    }
                    Spacer().frame(height: ConsentTokens.footerItemGap)
                    primaryButton(AlarmConsentStrings.H_WITHDRAW, enabled: model.canWithdraw, action: model.startWithdraw)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, ConsentTokens.screenHorizontal)
                .padding(.bottom, ConsentTokens.bodyVertical)
            }
        }
    }

    private var documentPage: some View {
        VStack(spacing: ConsentTokens.spacingNone) {
            header(AlarmConsentStrings.D_TITLE, back: goBack)
            ScrollView {
                VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
                    copy(AlarmConsentStrings.D_READ_ONLY, color: ConsentTokens.secondaryText)
                    switch model.doc {
                    case .loading: progressBlock(AlarmConsentStrings.D_LOADING)
                    case .empty: retryBlock(AlarmConsentStrings.D_EMPTY, action: model.openDocument)
                    case .error: retryBlock(AlarmConsentStrings.D_ERROR, action: model.openDocument)
                    case .offline: retryBlock(AlarmConsentStrings.D_OFFLINE, action: model.openDocument)
                    case .metaMissing: retryBlock(AlarmConsentStrings.D_META_MISSING, action: model.openDocument)
                    case .preparing: retryBlock(AlarmConsentStrings.D_PREPARING, action: model.openDocument)
                    case .ready(let version, let effectiveAt, let body, let draft):
                        copy(AlarmConsentStrings.dVersion(version), size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                        copy(AlarmConsentStrings.dEffective(effectiveAt), size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                        if draft { copy(AlarmConsentStrings.D_DRAFT, color: ConsentTokens.errorText) }
                        Spacer().frame(height: ConsentTokens.sectionGap)
                        copy(body).textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, ConsentTokens.screenHorizontal)
                .padding(.bottom, ConsentTokens.bodyVertical)
            }
            Divider().overlay(ConsentTokens.separator)
            primaryButton(AlarmConsentStrings.CLOSE, enabled: true) { route = documentReturn }
                .padding(.horizontal, ConsentTokens.screenHorizontal).padding(.vertical, ConsentTokens.footerVertical)
        }
    }

    private var withdrawModal: some View {
        ZStack {
            ConsentTokens.scrim.ignoresSafeArea().onTapGesture {
                if model.withdraw != .checking { model.dismissWithdraw() }
            }.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
                copy(AlarmConsentStrings.W_TITLE, size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                switch model.withdraw {
                case .checking:
                    progressBlock(AlarmConsentStrings.H_LOADING)
                    secondaryButton(AlarmConsentStrings.CANCEL, action: model.dismissWithdraw)
                case .question:
                    copy(AlarmConsentStrings.W_HEADING, size: ConsentTokens.stateTitle, bold: true).accessibilityAddTraits(.isHeader)
                    copy(AlarmConsentStrings.W_BODY)
                    Spacer().frame(height: ConsentTokens.stateTextGap)
                    secondaryButton(AlarmConsentStrings.CANCEL, action: model.dismissWithdraw)
                    Spacer().frame(height: ConsentTokens.footerItemGap)
                    primaryButton(AlarmConsentStrings.W_CONFIRM, enabled: !model.writesLocked, action: model.confirmWithdraw)
                case .working:
                    progressBlock(AlarmConsentStrings.W_LOADING)
                    secondaryButton(AlarmConsentStrings.CANCEL, action: model.dismissWithdraw)
                case .empty:
                    modalNotice(AlarmConsentStrings.W_EMPTY, actions: [(AlarmConsentStrings.CLOSE, model.dismissWithdraw)])
                case .unavailable:
                    modalNotice(AlarmConsentStrings.W_UNAVAILABLE, actions: [(AlarmConsentStrings.CLOSE, model.dismissWithdraw)])
                case .error:
                    modalNotice(AlarmConsentStrings.W_ERROR, actions: [(AlarmConsentStrings.RETRY, model.retryWithdraw),
                                                                      (AlarmConsentStrings.CANCEL, model.dismissWithdraw)])
                case .offline:
                    modalNotice(AlarmConsentStrings.W_OFFLINE, actions: [(AlarmConsentStrings.RETRY, model.retryWithdraw),
                                                                        (AlarmConsentStrings.CANCEL, model.dismissWithdraw)])
                case .uncertain:
                    modalNotice(AlarmConsentStrings.W_UNCERTAIN, actions: [(AlarmConsentStrings.W_CHECK, model.checkWithdraw),
                                                                          (AlarmConsentStrings.CANCEL, model.dismissWithdraw)])
                case .closed:
                    EmptyView()
                }
            }
            .padding(.horizontal, ConsentTokens.screenHorizontal)
            .padding(.vertical, ConsentTokens.bodyVertical)
            .frame(maxWidth: ConsentTokens.modalMaxWidth)
            .background(ConsentTokens.background, in: RoundedRectangle(cornerRadius: ConsentTokens.modalRadius))
            .padding(ConsentTokens.screenHorizontal)
            .accessibilityAddTraits(.isModal)
            .accessibilityIdentifier("withdraw-modal")
        }
    }

    private func permissionModal(_ state: AlarmConsentModel.Permission) -> some View {
        ZStack {
            ConsentTokens.scrim.ignoresSafeArea().onTapGesture { model.dismissPermission() }.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
                switch state {
                case .loading:
                    progressBlock(AlarmConsentStrings.P_LOADING)
                    secondaryButton(AlarmConsentStrings.P_LATER, action: model.dismissPermission)
                case .denied:
                    copy(AlarmConsentStrings.P_TITLE, size: ConsentTokens.stateTitle, bold: true).accessibilityAddTraits(.isHeader)
                    copy(AlarmConsentStrings.P_BODY)
                    if model.osOffline {
                        copy(AlarmConsentStrings.P_OFFLINE, size: ConsentTokens.metadata, color: ConsentTokens.secondaryText)
                    }
                    Spacer().frame(height: ConsentTokens.stateTextGap)
                    primaryButton(AlarmConsentStrings.S_OS_SETTINGS, enabled: true, action: model.confirmOsSettings)
                    Spacer().frame(height: ConsentTokens.footerItemGap)
                    secondaryButton(AlarmConsentStrings.P_LATER, action: model.dismissPermission)
                case .unknownOs:
                    modalNotice(AlarmConsentStrings.P_UNKNOWN, actions: [(AlarmConsentStrings.P_LATER, model.dismissPermission)])
                case .failed:
                    modalNotice(AlarmConsentStrings.P_ERROR, actions: [(AlarmConsentStrings.RETRY, model.retryOsSettings),
                                                                      (AlarmConsentStrings.P_LATER, model.dismissPermission)])
                }
            }
            .padding(.horizontal, ConsentTokens.screenHorizontal)
            .padding(.vertical, ConsentTokens.bodyVertical)
            .frame(maxWidth: ConsentTokens.modalMaxWidth)
            .background(ConsentTokens.background, in: RoundedRectangle(cornerRadius: ConsentTokens.modalRadius))
            .padding(ConsentTokens.screenHorizontal)
            .accessibilityAddTraits(.isModal)
            .accessibilityIdentifier("permission-modal")
        }
    }

    private func modalNotice(_ text: String, actions: [(String, () -> Void)]) -> some View {
        VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
            copy(text)
            Spacer().frame(height: ConsentTokens.stateTextGap)
            ForEach(Array(actions.enumerated()), id: \.offset) { entry in
                if entry.offset == 0 {
                    primaryButton(entry.element.0, enabled: true, action: entry.element.1)
                } else {
                    secondaryButton(entry.element.0, action: entry.element.1)
                }
            }
        }
    }

    private func rowStatus(_ text: String, error: Bool) -> some View {
        copy(text, size: ConsentTokens.metadata, color: error ? ConsentTokens.errorText : ConsentTokens.secondaryText)
            .accessibilityAddTraits(.updatesFrequently)
    }

    private func stateBlock(_ text: String) -> some View {
        copy(text).accessibilityAddTraits(.updatesFrequently)
    }

    private func progressBlock(_ text: String) -> some View {
        HStack(spacing: ConsentTokens.rowItemGap) {
            ProgressView().tint(ConsentTokens.heading)
            copy(text).accessibilityAddTraits(.updatesFrequently)
        }
    }

    private func retryBlock(_ text: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: ConsentTokens.textGap) {
            stateBlock(text)
            secondaryButton(AlarmConsentStrings.RETRY, action: action)
        }
    }

    private func copy(_ text: String, size: CGFloat = ConsentTokens.bodySize, bold: Bool = false,
                      color: Color = ConsentTokens.body) -> some View {
        Text(text)
            .font(.custom(bold ? "Pretendard-Bold" : "Pretendard-Regular", size: size, relativeTo: .body))
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func primaryButton(_ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            copy(label, size: ConsentTokens.action, bold: true, color: enabled ? ConsentTokens.primaryText : ConsentTokens.secondaryText)
                .frame(maxWidth: .infinity, minHeight: ConsentTokens.touchMinimum)
                .background(enabled ? ConsentTokens.primaryBackground : ConsentTokens.separator,
                            in: RoundedRectangle(cornerRadius: ConsentTokens.buttonRadius))
        }
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func secondaryButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            copy(label, size: ConsentTokens.action).frame(maxWidth: .infinity, minHeight: ConsentTokens.touchMinimum)
                .overlay(RoundedRectangle(cornerRadius: ConsentTokens.buttonRadius).stroke(ConsentTokens.separator))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

private struct ConsentSwitch: View {
    let on: Bool
    let label: String
    let value: String
    let enabled: Bool
    let change: (Bool) -> Void
    var body: some View {
        Button { change(!on) } label: {
            Capsule().fill(on ? ConsentTokens.switchOnTrack : ConsentTokens.switchOffTrack)
                .overlay(Capsule().stroke(ConsentTokens.separator, lineWidth: ConsentTokens.stroke))
                .overlay(Circle().fill(ConsentTokens.switchThumb)
                    .frame(width: ConsentTokens.switchThumbSize, height: ConsentTokens.switchThumbSize)
                    .padding(ConsentTokens.textGap / 2), alignment: on ? .trailing : .leading)
                .frame(width: ConsentTokens.switchWidth, height: ConsentTokens.switchHeight)
                .frame(width: ConsentTokens.touchMinimum, height: ConsentTokens.touchMinimum)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? ConsentTokens.enabledOpacity : ConsentTokens.disabledOpacity)
        .accessibilityLabel(label)
        .accessibilityValue(value)
        .accessibilityAddTraits(.isButton)
    }
}
