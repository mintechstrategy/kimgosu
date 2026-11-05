import SwiftUI
import UIKit

/// 문구 정본은 design/report-block/screens.md 다. 클라이언트가 새 문구를 만들지 않는다.
/// 서버 계약(길이·허용문자·접수/차단/해제 경로)이 없으므로 REASON_TOO_LONG·REASON_INVALID는
/// 쓰지 않는다(spec.md §7 G2).
enum KGReportBlockStrings {
    static let rEntry = "신고하기"
    static let bEntry = "차단하기"
    static let close = "닫기"
    static let cancel = "취소"
    static let done = "확인"
    static let targetLabel = "대상"
    static let retry = "다시 시도"
    static let checkResult = "처리 결과 확인"
    static let backChatList = "채팅 목록으로"
    static let support = "고객센터"
    static let loadError = "불러오지 못했습니다. 다시 시도해 주십시오."
    static let networkError = "네트워크에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주십시오."
    static let unknown = "처리 결과를 확인하지 못했습니다. 다시 실행하기 전에 처리 결과를 확인해 주십시오."
    static let networkUnknown = "네트워크 연결이 끊겨 처리 결과를 확인하지 못했습니다. 연결 후 처리 결과를 확인해 주십시오."
    static let uTarget = "이 대화를 이용할 수 없습니다. 채팅 목록으로 돌아가 주십시오."
    static let preparing = "이 기능을 준비 중입니다. 잠시 후 다시 확인해 주십시오."

    static let rTitle = "대화 신고"
    static let rScope = "현재 대화와 상대방을 신고합니다."
    static let reasonLabel = "신고 사유 (필수)"
    static let reasonPlaceholder = "신고 사유를 입력해 주십시오."
    static let rHelp = "신고 사유를 입력한 뒤 내용을 확인해 주십시오."
    static let reasonRequired = "신고 사유를 입력해 주십시오. 공백만 입력할 수 없습니다."
    static let rReview = "신고 내용 확인"
    static let rReviewTitle = "신고 내용 확인"
    static let rFinalNote = "접수 후에는 이 화면에서 신고를 취소할 수 없습니다. 신고만으로 상대방이 차단되지는 않습니다."
    static let rSubmit = "신고 접수하기"
    static let editReason = "사유 수정"
    static let rLoading = "신고 대상을 확인하고 있습니다."
    static let rSending = "신고를 접수하고 있습니다."
    static let rSendError = "신고를 접수하지 못했습니다. 입력한 내용을 확인한 뒤 다시 시도해 주십시오."
    static let rDoneTitle = "신고가 접수되었습니다"
    static let rDoneBody = "접수된 내용은 확인 절차에 따라 검토됩니다. 상대방은 차단되지 않았습니다."
    static let discardTitle = "신고 작성을 그만두시겠습니까?"
    static let discardBody = "입력한 신고 사유는 저장되지 않습니다."
    static let keepEdit = "계속 작성"
    static let discard = "작성 그만두기"

    static let bTitle = "상대방을 차단하시겠습니까?"
    static let bScope = "차단하면 이 대화에서 서로 메시지를 보낼 수 없습니다."
    static let bHistory = "이전 대화의 열람 범위는 이용 권한에 따라 달라집니다. 차단은 해제할 수 있습니다."
    static let bConfirm = "차단하기"
    static let bLoading = "차단 대상을 확인하고 있습니다."
    static let bSaving = "차단하고 있습니다."
    static let bSendError = "차단하지 못했습니다. 다시 시도해 주십시오."

    static let blockedTitle = "대화가 제한되었습니다"
    static let blockedSelf = "상대방을 차단하여 메시지를 보낼 수 없습니다."
    static let blockedOther = "현재 이 대화에서 메시지를 보낼 수 없습니다."
    static let blockedLoading = "대화 이용 상태를 확인하고 있습니다."
    static let historyEmpty = "표시할 이전 대화가 없습니다"
    static let historyNext = "신고하거나 고객센터에 문의할 수 있습니다."
    static let historyUnavailable = "이전 대화를 표시할 수 없습니다. 도움이 필요하면 고객센터에 문의해 주십시오."
    static let historyError = "이전 대화를 불러오지 못했습니다. 다시 시도해 주십시오."
    static let retryHistory = "이전 대화 다시 불러오기"
    static let unblock = "차단 해제"
    static let unblockTitle = "차단을 해제하시겠습니까?"
    static let unblockNote = "해제 후 이용 권한을 다시 확인합니다. 보내지 않은 메시지는 자동으로 전송되지 않습니다."
    static let unblockConfirm = "차단 해제하기"
    static let unblockSaving = "차단을 해제하고 있습니다."
    static let unblockError = "차단을 해제하지 못했습니다. 다시 시도해 주십시오."

    static func targetA11y(_ subject: String) -> String { "대상: \(subject)" }
}

enum KGWriteProblem: Equatable { case failed, unknown, networkUnknown }

enum KGGatewayFailure: Error { case unsupported, failed, unknown, offline }

enum KGAttempt<T> {
    case ok(T), unsupported, failed, unknown, offline
}

@MainActor
func kgAttempt<T>(_ body: () async throws -> T) async -> KGAttempt<T> {
    do { return .ok(try await body()) }
    catch let failure as KGGatewayFailure {
        switch failure {
        case .unsupported: return .unsupported
        case .failed: return .failed
        case .unknown: return .unknown
        case .offline: return .offline
        }
    } catch { return .unknown }
}

struct KGConversationTarget { let displayName: String; let alreadyBlockedByMe: Bool }
struct KGBlockState { let blockedByMe: Bool; let historyAllowed: Bool; let history: [KGCustomerMessage] }

/// 신고·차단 서버 계약이 아직 확정되지 않았다(spec.md §7 G1/G2). 경로·필드를 이 레인에서
/// 만들지 않고, 서버가 붙으면 이 프로토콜만 구현한다. 구현이 없으면 쓰기는 PREPARING으로 잠근다.
protocol KGReportBlockGateway {
    func loadTarget(ledgerId: String) async throws -> KGConversationTarget
    func submitReport(ledgerId: String, reason: String) async throws
    func reportReceipt(ledgerId: String) async throws -> Bool
    func block(ledgerId: String) async throws
    func blockState(ledgerId: String) async throws -> KGBlockState
    func unblock(ledgerId: String) async throws
}

struct KGUnavailableReportBlockGateway: KGReportBlockGateway {
    func loadTarget(ledgerId: String) async throws -> KGConversationTarget { throw KGGatewayFailure.unsupported }
    func submitReport(ledgerId: String, reason: String) async throws { throw KGGatewayFailure.unsupported }
    func reportReceipt(ledgerId: String) async throws -> Bool { throw KGGatewayFailure.unsupported }
    func block(ledgerId: String) async throws { throw KGGatewayFailure.unsupported }
    func blockState(ledgerId: String) async throws -> KGBlockState { throw KGGatewayFailure.unsupported }
    func unblock(ledgerId: String) async throws { throw KGGatewayFailure.unsupported }
}

enum KGReportSheetState: Equatable {
    case loading
    case targetUnavailable
    case loadFailed(network: Bool)
    case form(subject: String, reason: String, showReasonError: Bool, preparing: Bool)
    case review(subject: String, reason: String, preparing: Bool)
    case sending(subject: String, reason: String)
    case done(subject: String)
    case discard(subject: String, reason: String)
    case submitFailed(subject: String, reason: String, problem: KGWriteProblem)
}

@MainActor final class KGChatReportModel: ObservableObject {
    @Published private(set) var state: KGReportSheetState = .loading
    private let gateway: KGReportBlockGateway
    private var reason = ""

    init(gateway: KGReportBlockGateway) { self.gateway = gateway }

    func load(ledgerId: String, subject: String) async {
        reason = ""
        state = .loading
        switch await kgAttempt({ try await gateway.loadTarget(ledgerId: ledgerId) }) {
        case .ok(let target): state = form(target.displayName, preparing: false)
        case .unsupported: state = form(subject, preparing: true)
        case .offline: state = .loadFailed(network: true)
        case .failed, .unknown: state = .loadFailed(network: false)
        }
    }

    private func form(_ subject: String, preparing: Bool) -> KGReportSheetState {
        subject.isEmpty
            ? .targetUnavailable
            : .form(subject: subject, reason: reason, showReasonError: false, preparing: preparing)
    }

    func onReasonChange(_ text: String) {
        reason = text
        guard case .form(let subject, _, _, let preparing) = state else { return }
        state = .form(subject: subject, reason: text, showReasonError: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, preparing: preparing)
    }

    func review() {
        guard case .form(let subject, let reason, _, let preparing) = state else { return }
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            state = .form(subject: subject, reason: reason, showReasonError: true, preparing: preparing)
            return
        }
        state = .review(subject: subject, reason: reason, preparing: preparing)
    }

    func edit() {
        guard case .review(let subject, let reason, let preparing) = state else { return }
        state = .form(subject: subject, reason: reason, showReasonError: false, preparing: preparing)
    }

    func requestDiscard() -> Bool {
        guard case .form(let subject, let reason, _, _) = state,
              !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        state = .discard(subject: subject, reason: reason)
        return true
    }

    func keepEditing() {
        guard case .discard(let subject, let reason) = state else { return }
        state = .form(subject: subject, reason: reason, showReasonError: false, preparing: false)
    }

    func submit(ledgerId: String) async {
        guard case .review(let subject, let reason, let preparing) = state, !preparing else { return }
        state = .sending(subject: subject, reason: reason)
        switch await kgAttempt({ try await gateway.submitReport(ledgerId: ledgerId, reason: reason) }) {
        case .ok: state = .done(subject: subject)
        case .unsupported: state = .review(subject: subject, reason: reason, preparing: true)
        case .failed: state = .submitFailed(subject: subject, reason: reason, problem: .failed)
        case .offline: state = .submitFailed(subject: subject, reason: reason, problem: .networkUnknown)
        case .unknown: state = .submitFailed(subject: subject, reason: reason, problem: .unknown)
        }
    }

    func retry() {
        guard case .submitFailed(let subject, let reason, _) = state else { return }
        state = .review(subject: subject, reason: reason, preparing: false)
    }

    func checkResult(ledgerId: String) async {
        guard case .submitFailed(let subject, let reason, _) = state else { return }
        switch await kgAttempt({ try await gateway.reportReceipt(ledgerId: ledgerId) }) {
        case .ok(let accepted):
            state = accepted ? .done(subject: subject) : .review(subject: subject, reason: reason, preparing: false)
        default:
            break
        }
    }
}

enum KGBlockConfirmState: Equatable {
    case loading
    case targetUnavailable
    case loadFailed(network: Bool)
    case ready(subject: String, preparing: Bool, saving: Bool, problem: KGWriteProblem?)
}

@MainActor final class KGChatBlockConfirmModel: ObservableObject {
    @Published private(set) var state: KGBlockConfirmState = .loading
    @Published private(set) var blockedConfirmed = false
    private let gateway: KGReportBlockGateway

    init(gateway: KGReportBlockGateway) { self.gateway = gateway }

    /// 이미 본인이 차단한 대화면 true를 돌려주고 호출자가 CHAT_BLOCKED로 이동한다.
    func load(ledgerId: String, subject: String) async -> Bool {
        state = .loading
        switch await kgAttempt({ try await gateway.loadTarget(ledgerId: ledgerId) }) {
        case .ok(let target):
            if target.alreadyBlockedByMe { return true }
            state = .ready(subject: target.displayName, preparing: false, saving: false, problem: nil)
            return false
        case .unsupported:
            if subject.isEmpty {
                state = .targetUnavailable
            } else {
                state = .ready(subject: subject, preparing: true, saving: false, problem: nil)
            }
            return false
        case .offline: state = .loadFailed(network: true); return false
        case .failed, .unknown: state = .loadFailed(network: false); return false
        }
    }

    func confirm(ledgerId: String) async {
        guard case .ready(let subject, let preparing, let saving, _) = state, !preparing, !saving else { return }
        state = .ready(subject: subject, preparing: false, saving: true, problem: nil)
        switch await kgAttempt({ try await gateway.block(ledgerId: ledgerId) }) {
        case .ok:
            blockedConfirmed = true
            state = .ready(subject: subject, preparing: false, saving: false, problem: nil)
        case .unsupported: state = .ready(subject: subject, preparing: true, saving: false, problem: nil)
        case .failed: state = .ready(subject: subject, preparing: false, saving: false, problem: .failed)
        case .offline: state = .ready(subject: subject, preparing: false, saving: false, problem: .networkUnknown)
        case .unknown: state = .ready(subject: subject, preparing: false, saving: false, problem: .unknown)
        }
    }

    func checkResult(ledgerId: String) async {
        guard case .ready(let subject, let preparing, _, _) = state else { return }
        switch await kgAttempt({ try await gateway.blockState(ledgerId: ledgerId) }) {
        case .ok(let block):
            if block.blockedByMe {
                blockedConfirmed = true
                state = .ready(subject: subject, preparing: preparing, saving: false, problem: nil)
            } else {
                state = .ready(subject: subject, preparing: preparing, saving: false, problem: nil)
            }
        default:
            break
        }
    }
}

enum KGBlockedState: Equatable {
    case loading
    case loadFailed(network: Bool)
    case ready(subject: String, blockedByMe: Bool, history: [KGCustomerMessage]?, historyError: Bool,
               unblockConfirm: Bool, unblockSaving: Bool, unblockProblem: KGWriteProblem?)
}

@MainActor final class KGChatBlockedModel: ObservableObject {
    @Published private(set) var state: KGBlockedState = .loading
    @Published private(set) var restored = false
    private let gateway: KGReportBlockGateway
    private var ledgerId = ""
    private var subject = ""
    private var blockedByMe = true

    init(gateway: KGReportBlockGateway) { self.gateway = gateway }

    func load(ledgerId: String, subject: String, blockedByMe: Bool) async {
        self.ledgerId = ledgerId
        self.subject = subject
        self.blockedByMe = blockedByMe
        state = .loading
        switch await kgAttempt({ try await gateway.blockState(ledgerId: ledgerId) }) {
        case .ok(let block):
            state = ready(blockedByMe: block.blockedByMe,
                          history: block.historyAllowed ? block.history : nil,
                          historyError: false)
        // 차단 확정 자체가 서버 응답이므로 게이트웨이가 없으면 기록 열람은 확인할 수 없다.
        case .unsupported: state = ready(blockedByMe: blockedByMe, history: nil, historyError: false)
        case .offline: state = .loadFailed(network: true)
        case .failed, .unknown: state = .loadFailed(network: false)
        }
    }

    private func ready(blockedByMe: Bool, history: [KGCustomerMessage]?, historyError: Bool) -> KGBlockedState {
        .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
               unblockConfirm: false, unblockSaving: false, unblockProblem: nil)
    }

    func retryHistory() async {
        guard case .ready(let subject, let blockedByMe, _, _, _, _, _) = state else { return }
        switch await kgAttempt({ try await gateway.blockState(ledgerId: ledgerId) }) {
        case .ok(let block):
            state = .ready(subject: subject, blockedByMe: blockedByMe,
                           history: block.historyAllowed ? block.history : nil, historyError: false,
                           unblockConfirm: false, unblockSaving: false, unblockProblem: nil)
        case .failed, .unknown:
            state = .ready(subject: subject, blockedByMe: blockedByMe, history: nil, historyError: true,
                           unblockConfirm: false, unblockSaving: false, unblockProblem: nil)
        case .offline:
            state = .loadFailed(network: true)
        case .unsupported:
            state = .ready(subject: subject, blockedByMe: blockedByMe, history: nil, historyError: false,
                           unblockConfirm: false, unblockSaving: false, unblockProblem: nil)
        }
    }

    func askUnblock() {
        guard case .ready(let subject, let blockedByMe, let history, let historyError, _, _, _) = state else { return }
        state = .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
                       unblockConfirm: true, unblockSaving: false, unblockProblem: nil)
    }

    func cancelUnblock() {
        guard case .ready(let subject, let blockedByMe, let history, let historyError, _, _, _) = state else { return }
        state = .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
                       unblockConfirm: false, unblockSaving: false, unblockProblem: nil)
    }

    func unblock() async {
        guard case .ready(let subject, let blockedByMe, let history, let historyError, _, let saving, _) = state, !saving else { return }
        state = .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
                       unblockConfirm: true, unblockSaving: true, unblockProblem: nil)
        let problem: KGWriteProblem?
        switch await kgAttempt({ try await gateway.unblock(ledgerId: ledgerId) }) {
        case .ok: restored = true; problem = nil
        case .unsupported, .failed: problem = .failed
        case .offline: problem = .networkUnknown
        case .unknown: problem = .unknown
        }
        state = .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
                       unblockConfirm: problem != nil, unblockSaving: false, unblockProblem: problem)
    }

    func checkResult() async {
        guard case .ready(let subject, let blockedByMe, let history, let historyError, _, _, _) = state else { return }
        switch await kgAttempt({ try await gateway.blockState(ledgerId: ledgerId) }) {
        case .ok(let block):
            if block.blockedByMe {
                state = .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
                               unblockConfirm: true, unblockSaving: false, unblockProblem: nil)
            } else {
                restored = true
                state = .ready(subject: subject, blockedByMe: blockedByMe, history: history, historyError: historyError,
                               unblockConfirm: false, unblockSaving: false, unblockProblem: nil)
            }
        default:
            break
        }
    }
}

private struct KGPrimaryAction: View {
    let label: String
    let id: String
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            customerCopy(label, size: DesignTokens.typeBodyStrongSize, bold: true,
                         color: enabled ? DesignTokens.canvas : DesignTokens.muted)
                .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
                .background(enabled ? DesignTokens.navy : DesignTokens.track,
                            in: RoundedRectangle(cornerRadius: DesignTokens.radiusSm))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityIdentifier(id)
    }
}

private struct KGSecondaryAction: View {
    let label: String
    let id: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            customerCopy(label, size: DesignTokens.typeBodyStrongSize, bold: true)
                .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusSm).stroke(DesignTokens.border))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}

private struct KGStatusText: View {
    let text: String
    let id: String
    var error = false

    var body: some View {
        customerCopy(text, color: error ? DesignTokens.danger : DesignTokens.navy)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.spaceSm)
            .background(error ? DesignTokens.dangerBg : Color.clear,
                        in: RoundedRectangle(cornerRadius: DesignTokens.radiusSm))
            .accessibilityIdentifier(id)
    }
}

private struct KGProgressLine: View {
    let text: String
    let id: String

    var body: some View {
        HStack(spacing: DesignTokens.spaceSm) {
            ProgressView().controlSize(.small)
            customerCopy(text, color: DesignTokens.muted)
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier(id)
    }
}

private struct KGProblemActions: View {
    let problem: KGWriteProblem
    let errorText: String
    let prefix: String
    let onRetry: () -> Void
    let onCheckResult: () -> Void

    var body: some View {
        switch problem {
        case .failed:
            KGStatusText(text: errorText, id: "\(prefix)-failed", error: true)
            KGPrimaryAction(label: KGReportBlockStrings.retry, id: "\(prefix)-retry", action: onRetry)
        case .unknown:
            KGStatusText(text: KGReportBlockStrings.unknown, id: "\(prefix)-unknown", error: true)
            KGPrimaryAction(label: KGReportBlockStrings.checkResult, id: "\(prefix)-check", action: onCheckResult)
        case .networkUnknown:
            KGStatusText(text: KGReportBlockStrings.networkUnknown, id: "\(prefix)-network-unknown", error: true)
            KGPrimaryAction(label: KGReportBlockStrings.checkResult, id: "\(prefix)-check", action: onCheckResult)
        }
    }
}

private struct KGTargetLine: View {
    let subject: String

    var body: some View {
        customerCopy(KGReportBlockStrings.targetLabel + "  " + subject, bold: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(KGReportBlockStrings.targetA11y(subject))
            .accessibilityIdentifier("report-block-target")
    }
}

private func reportTitle(for state: KGReportSheetState) -> String {
    switch state {
    case .review, .sending, .submitFailed: return KGReportBlockStrings.rReviewTitle
    case .done: return KGReportBlockStrings.rDoneTitle
    case .discard: return KGReportBlockStrings.discardTitle
    default: return KGReportBlockStrings.rTitle
    }
}

struct KGChatReportSheet: View {
    @ObservedObject var model: KGChatReportModel
    let ledgerId: String
    let onClose: () -> Void
    let onDone: () -> Void
    let onDiscard: () -> Void
    let onBackToList: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spaceMd) {
            HStack {
                customerCopy(reportTitle(for: model.state), size: DesignTokens.typeTitleSize, bold: true)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button(KGReportBlockStrings.close) { onClose() }
                    .frame(minHeight: DesignTokens.touchIosMinPt)
                    .accessibilityIdentifier("report-close")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.spaceMd) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(DesignTokens.spaceXl)
        .background(DesignTokens.canvas)
        .onChange(of: model.state) { _, newState in
            let message = reportTitle(for: newState)
            UIAccessibility.post(notification: .announcement, argument: message)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            KGProgressLine(text: KGReportBlockStrings.rLoading, id: "report-loading")
        case .targetUnavailable:
            KGStatusText(text: KGReportBlockStrings.uTarget, id: "report-target-unavailable", error: true)
            KGPrimaryAction(label: KGReportBlockStrings.backChatList, id: "report-back-to-list", action: onBackToList)
        case .loadFailed(let network):
            KGStatusText(text: network ? KGReportBlockStrings.networkError : KGReportBlockStrings.loadError,
                         id: network ? "report-network-error" : "report-load-error", error: true)
            KGPrimaryAction(label: KGReportBlockStrings.retry, id: "report-load-retry") {
                Task { await model.load(ledgerId: ledgerId, subject: currentSubject) }
            }
            KGSecondaryAction(label: KGReportBlockStrings.close, id: "report-load-close", action: onClose)
        case .form(let subject, let reason, let showReasonError, let preparing):
            KGTargetLine(subject: subject)
            customerCopy(KGReportBlockStrings.rScope, color: DesignTokens.muted)
            VStack(alignment: .leading, spacing: DesignTokens.spaceSm) {
                customerCopy(KGReportBlockStrings.reasonLabel, color: DesignTokens.muted)
                ZStack(alignment: .topLeading) {
                    TextEditor(text: Binding(get: { reason }, set: { model.onReasonChange($0) }))
                        .font(.custom("Pretendard-Regular", size: DesignTokens.typeBodySize, relativeTo: .body))
                        .foregroundStyle(DesignTokens.navy)
                        .frame(minHeight: DesignTokens.touchIosMinPt)
                        .padding(DesignTokens.spaceXs)
                        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusSm).stroke(DesignTokens.border))
                        .accessibilityLabel(KGReportBlockStrings.reasonLabel)
                        .accessibilityIdentifier("report-reason")
                    if reason.isEmpty {
                        customerCopy(KGReportBlockStrings.reasonPlaceholder, color: DesignTokens.muted)
                            .padding(DesignTokens.spaceSm)
                            .allowsHitTesting(false)
                    }
                }
            }
            if showReasonError {
                KGStatusText(text: KGReportBlockStrings.reasonRequired, id: "report-reason-required", error: true)
            } else {
                customerCopy(KGReportBlockStrings.rHelp, size: DesignTokens.typeCaptionSize, color: DesignTokens.muted)
                    .accessibilityIdentifier("report-help")
            }
            KGPrimaryAction(label: KGReportBlockStrings.rReview, id: "report-review",
                            enabled: !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !preparing,
                            action: model.review)
            if preparing {
                KGStatusText(text: KGReportBlockStrings.preparing, id: "report-preparing", error: true)
            }
            KGSecondaryAction(label: KGReportBlockStrings.cancel, id: "report-cancel", action: onClose)
        case .review(let subject, let reason, let preparing):
            KGTargetLine(subject: subject)
            customerCopy(reason).accessibilityIdentifier("report-review-reason")
            customerCopy(KGReportBlockStrings.rFinalNote, size: DesignTokens.typeCaptionSize, color: DesignTokens.muted)
                .accessibilityIdentifier("report-final-note")
            KGPrimaryAction(label: KGReportBlockStrings.rSubmit, id: "report-submit", enabled: !preparing) {
                Task { await model.submit(ledgerId: ledgerId) }
            }
            if preparing {
                KGStatusText(text: KGReportBlockStrings.preparing, id: "report-preparing", error: true)
            }
            KGSecondaryAction(label: KGReportBlockStrings.editReason, id: "report-edit", action: model.edit)
        case .sending:
            KGProgressLine(text: KGReportBlockStrings.rSending, id: "report-sending")
        case .done:
            KGStatusText(text: KGReportBlockStrings.rDoneTitle, id: "report-done-title")
            customerCopy(KGReportBlockStrings.rDoneBody).accessibilityIdentifier("report-done-body")
            KGPrimaryAction(label: KGReportBlockStrings.done, id: "report-done", action: onDone)
        case .discard:
            customerCopy(KGReportBlockStrings.discardBody).accessibilityIdentifier("report-discard-body")
            KGPrimaryAction(label: KGReportBlockStrings.keepEdit, id: "report-keep-edit", action: model.keepEditing)
            KGSecondaryAction(label: KGReportBlockStrings.discard, id: "report-discard", action: onDiscard)
        case .submitFailed(let subject, let reason, let problem):
            KGTargetLine(subject: subject)
            customerCopy(reason, color: DesignTokens.muted)
            KGProblemActions(problem: problem, errorText: KGReportBlockStrings.rSendError, prefix: "report-send", onRetry: {
                model.retry()
                Task { await model.submit(ledgerId: ledgerId) }
            }, onCheckResult: {
                Task { await model.checkResult(ledgerId: ledgerId) }
            })
            KGSecondaryAction(label: KGReportBlockStrings.cancel, id: "report-submit-cancel", action: onClose)
        }
    }

    private var currentSubject: String {
        switch model.state {
        case .form(let subject, _, _, _): return subject
        case .review(let subject, _, _): return subject
        case .sending(let subject, _): return subject
        case .submitFailed(let subject, _, _): return subject
        default: return ""
        }
    }
}

struct KGChatBlockConfirmDialog: View {
    @ObservedObject var model: KGChatBlockConfirmModel
    let ledgerId: String
    let onCancel: () -> Void
    let onBackToList: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spaceMd) {
            customerCopy(KGReportBlockStrings.bTitle, size: DesignTokens.typeTitleSize, bold: true)
                .accessibilityAddTraits(.isHeader)
            switch model.state {
            case .loading:
                KGProgressLine(text: KGReportBlockStrings.bLoading, id: "block-loading")
            case .targetUnavailable:
                KGStatusText(text: KGReportBlockStrings.uTarget, id: "block-target-unavailable", error: true)
                KGPrimaryAction(label: KGReportBlockStrings.backChatList, id: "block-back-to-list", action: onBackToList)
            case .loadFailed(let network):
                KGStatusText(text: network ? KGReportBlockStrings.networkError : KGReportBlockStrings.loadError,
                             id: network ? "block-network-error" : "block-load-error", error: true)
                KGPrimaryAction(label: KGReportBlockStrings.retry, id: "block-load-retry") {
                    Task { await model.load(ledgerId: ledgerId, subject: subject) }
                }
                KGSecondaryAction(label: KGReportBlockStrings.cancel, id: "block-load-cancel", action: onCancel)
            case .ready(let readySubject, let preparing, let saving, let problem):
                KGTargetLine(subject: readySubject)
                if preparing {
                    KGStatusText(text: KGReportBlockStrings.preparing, id: "block-preparing", error: true)
                } else {
                    customerCopy(KGReportBlockStrings.bScope, color: DesignTokens.muted)
                        .accessibilityIdentifier("block-scope")
                    customerCopy(KGReportBlockStrings.bHistory, size: DesignTokens.typeCaptionSize,
                                 color: DesignTokens.muted)
                        .accessibilityIdentifier("block-history")
                }
                if problem == nil {
                    KGPrimaryAction(label: KGReportBlockStrings.bConfirm, id: "block-confirm",
                                    enabled: !preparing && !saving) {
                        Task { await model.confirm(ledgerId: ledgerId) }
                    }
                }
                if saving { KGProgressLine(text: KGReportBlockStrings.bSaving, id: "block-saving") }
                if let problem {
                    KGProblemActions(problem: problem, errorText: KGReportBlockStrings.bSendError, prefix: "block-send", onRetry: {
                        Task { await model.confirm(ledgerId: ledgerId) }
                    }, onCheckResult: {
                        Task { await model.checkResult(ledgerId: ledgerId) }
                    })
                }
                KGSecondaryAction(label: KGReportBlockStrings.cancel, id: "block-cancel", action: onCancel)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DesignTokens.spaceXl)
        .background(DesignTokens.canvas)
    }

    private var subject: String {
        if case .ready(let subject, _, _, _) = model.state { return subject }
        return ""
    }
}

struct KGChatBlockedView: View {
    @ObservedObject var model: KGChatBlockedModel
    let ledgerId: String
    let onReport: () -> Void
    let onBackToList: () -> Void
    let onSupport: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spaceMd) {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.spaceMd) {
                    customerCopy(KGReportBlockStrings.blockedTitle, size: DesignTokens.typeTitleSize, bold: true)
                        .accessibilityAddTraits(.isHeader)
                    blockedContent
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            footer
        }
        .padding(DesignTokens.spaceXl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(DesignTokens.canvas)
        .accessibilityIdentifier("chat-blocked")
    }

    @ViewBuilder private var blockedContent: some View {
        switch model.state {
        case .loading:
            KGProgressLine(text: KGReportBlockStrings.blockedLoading, id: "blocked-loading")
        case .loadFailed(let network):
            KGStatusText(text: network ? KGReportBlockStrings.networkError : KGReportBlockStrings.loadError,
                         id: network ? "blocked-network-error" : "blocked-load-error", error: true)
            KGPrimaryAction(label: KGReportBlockStrings.retry, id: "blocked-load-retry") {
                Task { await model.load(ledgerId: ledgerId, subject: subject, blockedByMe: blockedByMe) }
            }
        case .ready(_, let blockedByMe, let history, let historyError, _, _, let problem):
            customerCopy(blockedByMe ? KGReportBlockStrings.blockedSelf : KGReportBlockStrings.blockedOther,
                         color: DesignTokens.muted)
                .accessibilityIdentifier("blocked-reason")
            if historyError {
                KGStatusText(text: KGReportBlockStrings.historyError, id: "blocked-history-error", error: true)
                KGPrimaryAction(label: KGReportBlockStrings.retryHistory, id: "blocked-history-retry") {
                    Task { await model.retryHistory() }
                }
            } else if let history {
                if history.isEmpty {
                    customerCopy(KGReportBlockStrings.historyEmpty, bold: true)
                        .accessibilityIdentifier("blocked-history-empty")
                    customerCopy(KGReportBlockStrings.historyNext, color: DesignTokens.muted)
                } else {
                    ForEach(history) { message in
                        customerCopy(message.body.isEmpty ? "삭제된 메시지" : message.body)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(DesignTokens.spaceMd)
                            .background(DesignTokens.track, in: RoundedRectangle(cornerRadius: DesignTokens.radiusSm))
                            .accessibilityIdentifier("blocked-history-message")
                    }
                }
            } else {
                customerCopy(KGReportBlockStrings.historyUnavailable, color: DesignTokens.muted)
                    .accessibilityIdentifier("blocked-history-unavailable")
            }
            if let problem {
                KGProblemActions(problem: problem, errorText: KGReportBlockStrings.unblockError, prefix: "unblock", onRetry: {
                    Task { await model.unblock() }
                }, onCheckResult: {
                    Task { await model.checkResult() }
                })
            }
        }
    }

    @ViewBuilder private var footer: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spaceSm) {
            KGPrimaryAction(label: KGReportBlockStrings.backChatList, id: "blocked-back-to-list", action: onBackToList)
            Button(KGReportBlockStrings.rEntry, action: onReport)
                .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
                .accessibilityIdentifier("blocked-report")
            if let onSupport {
                Button(KGReportBlockStrings.support, action: onSupport)
                    .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
                    .accessibilityIdentifier("blocked-support")
            }
            if case .ready(_, let blockedByMe, _, _, let unblockConfirm, let unblockSaving, _) = model.state, blockedByMe {
                Button(KGReportBlockStrings.unblock) { model.askUnblock() }
                    .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
                    .disabled(unblockSaving)
                    .accessibilityIdentifier("blocked-unblock")
                if unblockConfirm {
                    unblockConfirmBox
                }
            }
        }
    }

    private var unblockConfirmBox: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spaceMd) {
            customerCopy(KGReportBlockStrings.unblockTitle, size: DesignTokens.typeTitleSize, bold: true)
                .accessibilityAddTraits(.isHeader)
            customerCopy(KGReportBlockStrings.unblockNote, color: DesignTokens.muted)
                .accessibilityIdentifier("unblock-note")
            KGPrimaryAction(label: KGReportBlockStrings.unblockConfirm, id: "unblock-confirm") {
                Task { await model.unblock() }
            }
            KGSecondaryAction(label: KGReportBlockStrings.cancel, id: "unblock-cancel", action: model.cancelUnblock)
        }
        .padding(DesignTokens.spaceLg)
        .background(DesignTokens.canvas, in: RoundedRectangle(cornerRadius: DesignTokens.radiusMd))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusMd).stroke(DesignTokens.border))
    }

    private var subject: String {
        if case .ready(let subject, _, _, _, _, _, _) = model.state { return subject }
        return ""
    }

    private var blockedByMe: Bool {
        if case .ready(_, let blockedByMe, _, _, _, _, _) = model.state { return blockedByMe }
        return true
    }
}
