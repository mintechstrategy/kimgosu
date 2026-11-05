import SwiftUI

/// 관리자 공지사항 화면 — design/admin-notice-board 스펙의 ADM_NOTICE_LIST / ADM_NOTICE_DETAIL /
/// ADM_NOTICE_EDIT / ADM_NOTICE_EDIT.DISCARD.
///
/// 화면은 상태를 받아 그리기만 한다. 공지 서버 계약이 아직 없으므로 연결 전 실제 동작은
/// CAPABILITY_LOCK(스펙 §7)이며, 샘플 공지나 가짜 0건으로 대체하지 않는다.

enum NoticeText {
    static let listTitle = "공지사항 관리"
    static let detailTitle = "공지사항 상세"
    static let createTitle = "공지사항 작성"
    static let editTitle = "공지사항 수정"
    static let listBack = "목록으로"
    static let retry = "다시 시도"
    static let refresh = "새로고침"
    static let cancel = "취소"
    static let create = "공지 작성"
    static let next = "더 불러오기"
    static let edit = "초안 수정"
    static let save = "초안 저장"
    static let checkSave = "저장 결과 확인"
    static let viewLatest = "최신 내용 확인"
    static let keepInput = "현재 입력 유지"
    static let useLatest = "최신 내용으로 바꾸기"
    static let keepEditing = "계속 작성"
    static let discard = "내용 버리기"

    static let colTitle = "제목"
    static let colStatus = "상태"
    static let colUpdated = "최종 수정일시"
    static let metaStatus = "상태"
    static let metaCreated = "작성일시"
    static let metaUpdated = "최종 수정일시"
    static let contentHeading = "내용"
    static let labelTitle = "제목"
    static let labelBody = "내용"
    static let required = "필수"
    static let placeholderTitle = "공지 제목을 입력하십시오"
    static let placeholderBody = "공지 내용을 입력하십시오"

    static let statusDraft = "초안"
    static let statusPublished = "게시 중"
    static let statusHidden = "비공개"
    static let statusUnknown = "상태 확인 필요"
    static let noValue = "—"

    static let networkTitle = "네트워크에 연결하지 못했습니다"
    static let networkBody = "연결 상태를 확인한 후 다시 시도해 주십시오."
    static let deniedTitle = "접근 권한이 없습니다"
    static let deniedBody = "공지사항 관리 권한을 확인해 주십시오."
    static let writeLock = "작성 권한 또는 저장 기준을 확인하지 못했습니다. 내용을 저장할 수 없습니다."
    static let capabilityLock = "공지사항 연결 준비 중입니다. 연결이 완료되면 다시 시도해 주십시오."
    static let publishLock = "게시 기능 준비 중"
    static let publishLockBody = "게시 대상과 운영 승인 기준이 확정되기 전까지 초안만 저장할 수 있습니다. 초안은 이용자에게 공개되지 않습니다."
    static let readonlyBody = "게시 중이거나 비공개인 공지는 조회만 가능합니다. 변경하려면 운영 기준을 먼저 확인해 주십시오."
    static let unsupportedBody = "지원하지 않는 공지 상태입니다. 최신 상태를 다시 확인해 주십시오."

    static let listLoading = "공지사항을 불러오는 중입니다…"
    static let listMoreLoading = "공지사항을 더 불러오는 중입니다…"
    static let listEmptyTitle = "등록된 공지사항이 없습니다"
    static let listEmptyBody = "공지 작성에서 제목과 내용을 입력한 후 초안으로 저장하십시오."
    static let listEmptyReadonly = "조회할 공지사항이 없습니다. 작성은 권한이 있는 관리자만 가능합니다."
    static let listErrorTitle = "공지사항을 불러오지 못했습니다"
    static let listErrorBody = "잠시 후 다시 시도해 주십시오."
    static let listMoreError = "추가 공지사항을 불러오지 못했습니다. 다시 시도해 주십시오."
    static let listStale = "최신 목록을 확인하지 못했습니다. 이전 조회 결과입니다."

    static let detailLoading = "공지사항을 확인하는 중입니다…"
    static let detailEmptyTitle = "공지사항을 찾을 수 없습니다"
    static let detailEmptyBody = "목록으로 돌아가 조회 가능한 공지사항을 확인해 주십시오."
    static let detailErrorTitle = "공지사항을 확인하지 못했습니다"
    static let detailErrorBody = "잠시 후 다시 시도해 주십시오."
    static let detailStale = "최신 공지사항을 확인하지 못했습니다. 다시 확인하기 전까지 수정할 수 없습니다."

    static let draftHelp = "초안은 관리자만 확인할 수 있으며 이용자에게 공개되지 않습니다."
    static let saving = "초안을 저장하는 중입니다…"
    static let saved = "초안을 저장했습니다. 이용자에게 공개되지 않습니다."
    static let editLoading = "작성 정보를 확인하는 중입니다…"
    static let formEmptyHelp = "제목과 내용을 입력한 후 초안 저장을 선택하십시오."
    static let editMissingTitle = "수정할 초안을 찾을 수 없습니다"
    static let editMissingBody = "목록으로 돌아가 수정 가능한 초안을 확인해 주십시오."
    static let editErrorTitle = "작성 정보를 확인하지 못했습니다"
    static let editErrorBody = "잠시 후 다시 시도해 주십시오. 입력한 내용은 이 화면에서 유지됩니다."
    static let fieldTitleRequired = "제목을 입력해 주십시오."
    static let fieldBodyRequired = "내용을 입력해 주십시오."
    static let fieldTooLong = "허용된 글자 수를 초과했습니다."
    static let saveError = "초안을 저장하지 못했습니다. 입력 내용을 확인한 후 다시 시도해 주십시오."
    static let saveNetwork = "저장 결과를 확인하지 못했습니다. 연결 후 저장 결과 확인을 선택해 주십시오."
    static let checkingSave = "저장 결과를 확인하는 중입니다…"
    static let saveNotApplied = "초안이 저장되지 않은 것을 확인했습니다. 다시 저장할 수 있습니다."
    static let saveUncertain = "저장 결과를 아직 확인하지 못했습니다. 다시 저장하지 말고 저장 결과를 확인해 주십시오."
    static let conflict = "다른 관리자가 공지를 변경했습니다. 입력 내용을 보존한 상태로 최신 내용을 확인해 주십시오."
    static let latestHeading = "최신 저장 내용"
    static let myInputHeading = "현재 입력 내용"
    static let conflictResolved = "최신 내용과 현재 입력 내용을 확인했습니다. 필요한 내용을 반영한 후 초안 저장을 선택하십시오."

    static let discardTitle = "입력한 내용을 버리시겠습니까?"
    static let discardBody = "저장하지 않은 내용은 사라집니다."

    static let seoulTimeNote = "한국 표준시 기준입니다."

    static func openNotice(_ title: String) -> String { "\(title) 상세 보기" }
    static func fieldLimit(_ max: Int) -> String { "최대 \(max)자" }
    static func fieldCount(_ count: Int, _ max: Int) -> String { "\(count)/\(max)자" }
}

enum NoticeStatus {
    case draft, published, hidden, unknown

    var label: String {
        switch self {
        case .draft: NoticeText.statusDraft
        case .published: NoticeText.statusPublished
        case .hidden: NoticeText.statusHidden
        case .unknown: NoticeText.statusUnknown
        }
    }
}

struct NoticeSummary: Identifiable, Equatable {
    let id: String
    let title: String
    let status: NoticeStatus
    let updatedAt: String?
}

struct NoticeDetailData: Equatable {
    let id: String
    let title: String
    let body: String
    let status: NoticeStatus
    let createdAt: String?
    let updatedAt: String?
}

/// 실패 원인. capability는 서버 계약이 아직 없다는 뜻이며 정상 0건이 아니다.
enum NoticeFailure { case server, network, capability, denied }

enum NoticeMore { case idle, loading, failed }

enum NoticeListState {
    case loading
    case empty
    case failed(NoticeFailure)
    case ready(rows: [NoticeSummary], hasNext: Bool, more: NoticeMore, moreFailure: NoticeFailure, stale: Bool)
}

enum NoticeDetailState {
    case loading
    case empty
    case failed(NoticeFailure)
    case ready(notice: NoticeDetailData, editable: Bool, stale: Bool)
}

struct NoticeFormInput: Equatable {
    let title: String
    let body: String
}

enum NoticeSave: Equatable {
    case idle, saving, saved, error, network, checking, notApplied, uncertain
    case conflict(latest: NoticeDetailData, latestVisible: Bool)
}

struct NoticeForm: Equatable {
    var title: String = ""
    var body: String = ""
    var titleError: String?
    var bodyError: String?
    /// 서버가 내려준 승인 한도. 없으면 저장을 잠근다(§6).
    var titleMax: Int?
    var bodyMax: Int?
    var changed: Bool = false
    var save: NoticeSave = .idle
}

enum NoticeEditState {
    case loading
    case capabilityLocked
    case missing
    case failed(NoticeFailure)
    case editing(NoticeForm)
}

private let noticeTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
    formatter.dateFormat = "yyyy.MM.dd HH:mm"
    return formatter
}()

private let noticeInputFormatter = ISO8601DateFormatter()

/// 서버 시각을 Asia/Seoul "YYYY.MM.DD HH:mm"으로 표시한다. 없는 시각은 채우지 않고 noValue다(§7).
func noticeTimeText(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty, let date = noticeInputFormatter.date(from: iso) else { return NoticeText.noValue }
    return noticeTimeFormatter.string(from: date)
}

/// 안내·실패 묶음: 제목 → 설명 → (보조 설명) → 행동. 실패를 색만으로 전달하지 않는다.
private func noticeBlock<Actions: View>(
    title: String? = nil,
    text: String,
    danger: Bool = false,
    note: String? = nil,
    tag: String,
    @ViewBuilder actions: () -> Actions
) -> some View {
    VStack(alignment: .leading, spacing: DesignTokens.space_md) {
        if let title {
            expertCopy(title, size: DesignTokens.type_subtitle, bold: true)
                .accessibilityAddTraits(.isHeader)
        }
        expertCopy(text, color: danger ? DesignTokens.danger : DesignTokens.navy)
            .padding(danger ? DesignTokens.space_lg : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(danger ? DesignTokens.dangerBg : DesignTokens.canvas,
                        in: RoundedRectangle(cornerRadius: DesignTokens.radius_md))
        if let note {
            expertCopy(note, size: DesignTokens.type_caption, color: DesignTokens.muted)
        }
        actions()
    }
    .padding(.horizontal, DesignTokens.space_xl)
    .padding(.vertical, DesignTokens.space_2xl)
    .accessibilityIdentifier(tag)
}

private func noticeProgress(_ text: String, tag: String) -> some View {
    HStack(spacing: DesignTokens.space_md) {
        ProgressView()
        expertCopy(text, color: DesignTokens.muted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(DesignTokens.space_xl)
    .accessibilityIdentifier(tag)
}

private func noticePrimaryButton(_ text: String, tag: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        expertCopy(text, size: DesignTokens.type_bodyStrong, bold: true,
                   color: enabled ? DesignTokens.canvas : DesignTokens.muted)
            .padding(.horizontal, DesignTokens.space_lg)
            .padding(.vertical, DesignTokens.space_md)
            .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
            .background(enabled ? DesignTokens.navy : DesignTokens.track,
                        in: RoundedRectangle(cornerRadius: DesignTokens.radius_sm))
    }
    .disabled(!enabled)
    .accessibilityIdentifier(tag)
}

private func noticeSecondaryButton(_ text: String, tag: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        expertCopy(text, size: DesignTokens.type_bodyStrong, bold: true)
            .padding(.horizontal, DesignTokens.space_lg)
            .padding(.vertical, DesignTokens.space_md)
            .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt)
            .background(DesignTokens.canvas, in: RoundedRectangle(cornerRadius: DesignTokens.radius_sm))
            .overlay(RoundedRectangle(cornerRadius: DesignTokens.radius_sm).strokeBorder(DesignTokens.border))
    }
    .accessibilityIdentifier(tag)
}

private func noticePageHeader(_ title: String, tag: String) -> some View {
    expertCopy(title, size: DesignTokens.type_title, bold: true)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier(tag)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, DesignTokens.space_xl)
        .padding(.vertical, DesignTokens.space_md)
}

private func noticeMetaLine(_ label: String, _ value: String, tag: String) -> some View {
    VStack(alignment: .leading, spacing: DesignTokens.space_xs) {
        expertCopy(label, size: DesignTokens.type_caption, color: DesignTokens.muted)
        expertCopy(value)
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier(tag)
}

// ── ADM_NOTICE_LIST ────────────────────────────────────────────────────────────

struct AdminNoticeListView: View {
    let state: NoticeListState
    let canCreate: Bool
    let onBack: () -> Void
    var onRetry: () -> Void = {}
    var onRefresh: () -> Void = {}
    var onLoadMore: () -> Void = {}
    var onOpen: (String) -> Void = { _ in }
    var onCreate: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            noticePageHeader(NoticeText.listTitle, tag: "notice-list-title")
            ScrollView {
                switch state {
                case .loading:
                    noticeProgress(NoticeText.listLoading, tag: "notice-list-loading")

                case .empty:
                    noticeBlock(title: NoticeText.listEmptyTitle,
                                text: canCreate ? NoticeText.listEmptyBody : NoticeText.listEmptyReadonly,
                                tag: "notice-list-empty") {
                        if canCreate { noticePrimaryButton(NoticeText.create, tag: "notice-list-create", action: onCreate) }
                    }

                case .failed(let failure):
                    switch failure {
                    case .network:
                        noticeBlock(title: NoticeText.networkTitle, text: NoticeText.networkBody,
                                    danger: true, tag: "notice-list-network") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-list-retry", action: onRetry)
                        }
                    case .capability:
                        noticeBlock(text: NoticeText.capabilityLock, tag: "notice-list-capability") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-list-retry", action: onRetry)
                        }
                    case .denied:
                        noticeBlock(title: NoticeText.deniedTitle, text: NoticeText.deniedBody,
                                    danger: true, tag: "notice-list-denied") {
                            noticeSecondaryButton(NoticeText.listBack, tag: "notice-list-close", action: onBack)
                        }
                    case .server:
                        noticeBlock(title: NoticeText.listErrorTitle, text: NoticeText.listErrorBody,
                                    danger: true, tag: "notice-list-error") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-list-retry", action: onRetry)
                        }
                    }

                case .ready(let rows, let hasNext, let more, let moreFailure, let stale):
                    if stale {
                        expertCopy(NoticeText.listStale, size: DesignTokens.type_caption, color: DesignTokens.muted)
                            .padding(.horizontal, DesignTokens.space_xl)
                            .padding(.vertical, DesignTokens.space_sm)
                    }
                    HStack(spacing: DesignTokens.space_lg) {
                        expertCopy(NoticeText.colTitle, size: DesignTokens.type_caption, color: DesignTokens.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        expertCopy(NoticeText.colStatus, size: DesignTokens.type_caption, color: DesignTokens.muted)
                        expertCopy(NoticeText.colUpdated, size: DesignTokens.type_caption, color: DesignTokens.muted)
                    }
                    .padding(.horizontal, DesignTokens.space_xl)
                    .padding(.vertical, DesignTokens.space_sm)

                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: DesignTokens.space_xs) {
                            Button {
                                onOpen(row.id)
                            } label: {
                                expertCopy(row.title, size: DesignTokens.type_bodyStrong, bold: true)
                                    .frame(maxWidth: .infinity, minHeight: DesignTokens.touchIosMinPt, alignment: .leading)
                            }
                            .accessibilityLabel(NoticeText.openNotice(row.title))
                            .accessibilityIdentifier("notice-open-" + row.id)
                            HStack(spacing: DesignTokens.space_lg) {
                                expertCopy(row.status.label)
                                expertCopy(noticeTimeText(row.updatedAt), size: DesignTokens.type_caption, color: DesignTokens.muted)
                            }
                        }
                        .padding(.horizontal, DesignTokens.space_xl)
                        .padding(.vertical, DesignTokens.space_lg)
                        Divider().overlay(DesignTokens.border)
                    }

                    switch more {
                    case .loading:
                        noticeProgress(NoticeText.listMoreLoading, tag: "notice-list-more-loading")
                    case .failed:
                        noticeBlock(text: moreFailure == .network ? NoticeText.networkBody : NoticeText.listMoreError,
                                    danger: moreFailure != .capability, tag: "notice-list-more-error") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-list-more-retry", action: onLoadMore)
                        }
                    case .idle:
                        if hasNext {
                            noticeSecondaryButton(NoticeText.next, tag: "notice-list-next", action: onLoadMore)
                                .padding(.horizontal, DesignTokens.space_xl)
                        }
                    }

                    VStack(alignment: .leading, spacing: DesignTokens.space_sm) {
                        expertCopy(NoticeText.publishLock, size: DesignTokens.type_bodyStrong, bold: true)
                        expertCopy(NoticeText.publishLockBody, color: DesignTokens.muted)
                        if canCreate {
                            noticePrimaryButton(NoticeText.create, tag: "notice-list-create", action: onCreate)
                        }
                    }
                    .padding(.horizontal, DesignTokens.space_xl)
                    .padding(.vertical, DesignTokens.space_2xl)
                }
            }
            Divider().overlay(DesignTokens.border)
            HStack(spacing: DesignTokens.space_sm) {
                noticeSecondaryButton(NoticeText.listBack, tag: "notice-list-close", action: onBack)
                noticeSecondaryButton(NoticeText.refresh, tag: "notice-list-refresh", action: onRefresh)
            }
            .padding(.horizontal, DesignTokens.space_xl)
            .padding(.vertical, DesignTokens.space_lg)
        }
        .background(DesignTokens.canvas)
        .accessibilityIdentifier("notice-list")
    }
}

// ── ADM_NOTICE_DETAIL ──────────────────────────────────────────────────────────

struct AdminNoticeDetailView: View {
    let state: NoticeDetailState
    let onBack: () -> Void
    var onRetry: () -> Void = {}
    var onEdit: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            noticePageHeader(NoticeText.detailTitle, tag: "notice-detail-title")
            ScrollView {
                switch state {
                case .loading:
                    noticeProgress(NoticeText.detailLoading, tag: "notice-detail-loading")

                case .empty:
                    noticeBlock(title: NoticeText.detailEmptyTitle, text: NoticeText.detailEmptyBody,
                                tag: "notice-detail-empty") { EmptyView() }

                case .failed(let failure):
                    switch failure {
                    case .denied:
                        noticeBlock(title: NoticeText.deniedTitle, text: NoticeText.deniedBody,
                                    danger: true, tag: "notice-detail-denied") {
                            noticeSecondaryButton(NoticeText.listBack, tag: "notice-detail-close", action: onBack)
                        }
                    case .network:
                        noticeBlock(title: NoticeText.networkTitle, text: NoticeText.networkBody,
                                    danger: true, tag: "notice-detail-error") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-detail-retry", action: onRetry)
                        }
                    case .server, .capability:
                        noticeBlock(title: NoticeText.detailErrorTitle, text: NoticeText.detailErrorBody,
                                    danger: true, tag: "notice-detail-error") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-detail-retry", action: onRetry)
                        }
                    }

                case .ready(let notice, _, let stale):
                    if stale {
                        noticeBlock(text: NoticeText.detailStale, danger: true, tag: "notice-detail-stale") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-detail-retry", action: onRetry)
                        }
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        expertCopy(notice.title, size: DesignTokens.type_subtitle, bold: true)
                            .accessibilityIdentifier("notice-detail-heading")
                        VStack(alignment: .leading, spacing: DesignTokens.space_md) {
                            noticeMetaLine(NoticeText.metaStatus, notice.status.label, tag: "notice-detail-status")
                            noticeMetaLine(NoticeText.metaCreated, noticeTimeText(notice.createdAt), tag: "notice-detail-created")
                            noticeMetaLine(NoticeText.metaUpdated, noticeTimeText(notice.updatedAt), tag: "notice-detail-updated")
                        }
                        .padding(.top, DesignTokens.space_lg)
                        expertCopy(NoticeText.seoulTimeNote, size: DesignTokens.type_caption, color: DesignTokens.muted)
                            .padding(.top, DesignTokens.space_sm)
                        expertCopy(NoticeText.contentHeading, size: DesignTokens.type_subtitle, bold: true)
                            .accessibilityAddTraits(.isHeader)
                            .padding(.top, DesignTokens.space_2xl)
                        // 본문은 서버 원문 그대로다. HTML 해석·자동 링크·말줄임을 하지 않는다.
                        expertCopy(notice.body)
                            .padding(.top, DesignTokens.space_sm)
                        switch notice.status {
                        case .draft:
                            EmptyView()
                        case .unknown:
                            expertCopy(NoticeText.unsupportedBody, color: DesignTokens.muted)
                                .padding(.top, DesignTokens.space_2xl)
                        case .published, .hidden:
                            expertCopy(NoticeText.readonlyBody, color: DesignTokens.muted)
                                .padding(.top, DesignTokens.space_2xl)
                        }
                    }
                    .padding(.horizontal, DesignTokens.space_xl)
                }
            }
            Divider().overlay(DesignTokens.border)
            HStack(spacing: DesignTokens.space_sm) {
                noticeSecondaryButton(NoticeText.listBack, tag: "notice-detail-close", action: onBack)
                if case .ready(let notice, let editable, let stale) = state,
                   editable, !stale, notice.status == .draft {
                    noticePrimaryButton(NoticeText.edit, tag: "notice-detail-edit", action: onEdit)
                }
            }
            .padding(.horizontal, DesignTokens.space_xl)
            .padding(.vertical, DesignTokens.space_lg)
        }
        .background(DesignTokens.canvas)
        .accessibilityIdentifier("notice-detail")
    }
}

// ── ADM_NOTICE_EDIT ────────────────────────────────────────────────────────────

struct AdminNoticeEditView: View {
    let state: NoticeEditState
    let createMode: Bool
    let onBack: () -> Void
    var onRetry: () -> Void = {}
    var onChange: (NoticeFormInput) -> Void = { _ in }
    var onSave: () -> Void = {}
    var onCheckSave: () -> Void = {}
    var onViewLatest: () -> Void = {}
    var onKeepInput: () -> Void = {}
    var onUseLatest: () -> Void = {}

    @State private var confirmingDiscard = false

    private var form: NoticeForm? {
        if case .editing(let form) = state { return form }
        return nil
    }

    private var saveEnabled: Bool {
        guard let form else { return false }
        let save = form.save
        let editableSave = save == .idle || save == .notApplied
        return editableSave && form.changed
            && !form.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !form.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && form.titleError == nil && form.bodyError == nil
            && form.titleMax != nil && form.bodyMax != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            noticePageHeader(createMode ? NoticeText.createTitle : NoticeText.editTitle, tag: "notice-edit-title")
            ScrollView {
                switch state {
                case .loading:
                    noticeProgress(NoticeText.editLoading, tag: "notice-edit-loading")

                case .capabilityLocked:
                    noticeBlock(text: NoticeText.capabilityLock, tag: "notice-edit-capability") {
                        noticeSecondaryButton(NoticeText.retry, tag: "notice-edit-retry", action: onRetry)
                    }

                case .missing:
                    noticeBlock(title: NoticeText.editMissingTitle, text: NoticeText.editMissingBody,
                                tag: "notice-edit-missing") { EmptyView() }

                case .failed(let failure):
                    if failure == .network {
                        noticeBlock(title: NoticeText.networkTitle, text: NoticeText.networkBody,
                                    danger: true, tag: "notice-edit-error") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-edit-retry", action: onRetry)
                        }
                    } else {
                        noticeBlock(title: NoticeText.editErrorTitle, text: NoticeText.editErrorBody,
                                    danger: true, tag: "notice-edit-error") {
                            noticeSecondaryButton(NoticeText.retry, tag: "notice-edit-retry", action: onRetry)
                        }
                    }

                case .editing(let form):
                    noticeEditForm(form, tag: "notice-edit-form")
                }
            }
            Divider().overlay(DesignTokens.border)
            HStack(spacing: DesignTokens.space_sm) {
                noticeSecondaryButton(NoticeText.cancel, tag: "notice-edit-cancel") {
                    if form?.changed == true { confirmingDiscard = true } else { onBack() }
                }
                if let form {
                    switch form.save {
                    case .network, .uncertain:
                        noticePrimaryButton(NoticeText.checkSave, tag: "notice-edit-check-save", action: onCheckSave)
                    case .conflict:
                        EmptyView()
                    default:
                        noticePrimaryButton(NoticeText.save, tag: "notice-edit-save", enabled: saveEnabled, action: onSave)
                    }
                }
            }
            .padding(.horizontal, DesignTokens.space_xl)
            .padding(.vertical, DesignTokens.space_lg)
        }
        .background(DesignTokens.canvas)
        .accessibilityIdentifier("notice-edit")
        .alert(NoticeText.discardTitle, isPresented: $confirmingDiscard) {
            Button(NoticeText.keepEditing) {}
            Button(NoticeText.discard, role: .destructive) { onBack() }
        } message: {
            Text(NoticeText.discardBody)
        }
    }

    @ViewBuilder
    private func noticeEditForm(_ form: NoticeForm, tag: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            expertCopy(NoticeText.draftHelp, color: DesignTokens.muted)

            // 승인된 필드 한도를 아직 받지 못하면 값을 지어내지 않고 저장을 잠근다(§6).
            if form.titleMax == nil || form.bodyMax == nil {
                noticeBlock(text: NoticeText.writeLock, danger: true, tag: "notice-edit-write-lock") { EmptyView() }
            }

            switch form.save {
            case .saving:
                noticeProgress(NoticeText.saving, tag: "notice-edit-saving")
            case .saved:
                expertCopy(NoticeText.saved).padding(.top, DesignTokens.space_md)
            case .error:
                noticeBlock(text: NoticeText.saveError, danger: true, tag: "notice-edit-save-error") { EmptyView() }
            case .network:
                noticeBlock(text: NoticeText.saveNetwork, danger: true, tag: "notice-edit-save-network") { EmptyView() }
            case .checking:
                noticeProgress(NoticeText.checkingSave, tag: "notice-edit-checking")
            case .notApplied:
                noticeBlock(text: NoticeText.saveNotApplied, tag: "notice-edit-not-applied") { EmptyView() }
            case .uncertain:
                noticeBlock(text: NoticeText.saveUncertain, danger: true, tag: "notice-edit-uncertain") { EmptyView() }
            case .conflict(let latest, let latestVisible):
                noticeBlock(text: NoticeText.conflict, danger: true, tag: "notice-edit-conflict") { EmptyView() }
                if latestVisible {
                    noticeConflictPanels(form, latest: latest)
                } else {
                    noticeSecondaryButton(NoticeText.viewLatest, tag: "notice-edit-view-latest", action: onViewLatest)
                        .padding(.horizontal, DesignTokens.space_xl)
                }
            case .idle:
                EmptyView()
            }

            if form.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               form.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               form.titleError == nil, form.bodyError == nil {
                expertCopy(NoticeText.formEmptyHelp, color: DesignTokens.muted)
                    .padding(.top, DesignTokens.space_md)
            }

            noticeField(label: NoticeText.labelTitle,
                        value: form.title,
                        placeholder: NoticeText.placeholderTitle,
                        error: form.titleError,
                        limit: form.titleMax,
                        singleLine: true,
                        tag: "notice-edit-title") { onChange(NoticeFormInput(title: $0, body: form.body)) }

            noticeField(label: NoticeText.labelBody,
                        value: form.body,
                        placeholder: NoticeText.placeholderBody,
                        error: form.bodyError,
                        limit: form.bodyMax,
                        singleLine: false,
                        tag: "notice-edit-body") { onChange(NoticeFormInput(title: form.title, body: $0)) }

            VStack(alignment: .leading, spacing: DesignTokens.space_xs) {
                expertCopy(NoticeText.publishLock, size: DesignTokens.type_bodyStrong, bold: true)
                expertCopy(NoticeText.publishLockBody, color: DesignTokens.muted)
            }
            .padding(.top, DesignTokens.space_2xl)
        }
        .padding(.horizontal, DesignTokens.space_xl)
        .padding(.vertical, DesignTokens.space_lg)
        .accessibilityIdentifier(tag)
    }

    @ViewBuilder
    private func noticeConflictPanels(_ form: NoticeForm, latest: NoticeDetailData) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.space_sm) {
            expertCopy(NoticeText.latestHeading, size: DesignTokens.type_subtitle, bold: true)
            expertCopy(latest.title, size: DesignTokens.type_bodyStrong, bold: true)
            expertCopy(latest.body)
            expertCopy(NoticeText.myInputHeading, size: DesignTokens.type_subtitle, bold: true)
                .padding(.top, DesignTokens.space_2xl)
            expertCopy(form.title, size: DesignTokens.type_bodyStrong, bold: true)
            expertCopy(form.body)
            expertCopy(NoticeText.conflictResolved, color: DesignTokens.muted)
                .padding(.top, DesignTokens.space_lg)
            HStack(spacing: DesignTokens.space_sm) {
                noticeSecondaryButton(NoticeText.keepInput, tag: "notice-edit-keep-input", action: onKeepInput)
                noticeSecondaryButton(NoticeText.useLatest, tag: "notice-edit-use-latest", action: onUseLatest)
            }
            .padding(.top, DesignTokens.space_md)
        }
        .padding(.horizontal, DesignTokens.space_xl)
        .padding(.top, DesignTokens.space_lg)
    }

    /// 레이블 → 필수/한도 → 입력 → (오류). 오류는 해당 입력 바로 아래에 둔다(§6).
    @ViewBuilder
    private func noticeField(
        label: String,
        value: String,
        placeholder: String,
        error: String?,
        limit: Int?,
        singleLine: Bool,
        tag: String,
        onChange: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.space_xs) {
            HStack(spacing: DesignTokens.space_sm) {
                expertCopy(label, size: DesignTokens.type_bodyStrong, bold: true)
                expertCopy(NoticeText.required, size: DesignTokens.type_caption, color: DesignTokens.muted)
            }
            if let limit {
                expertCopy(NoticeText.fieldLimit(limit), size: DesignTokens.type_caption, color: DesignTokens.muted)
            }
            Group {
                if singleLine {
                    TextField("", text: Binding(get: { value }, set: onChange), prompt: Text(placeholder))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } else {
                    TextEditor(text: Binding(get: { value }, set: onChange))
                        .frame(minHeight: DesignTokens.space_2xl * 5)
                }
            }
            .font(.custom(DesignTokens.fontFamilyIos, size: DesignTokens.type_body))
            .foregroundStyle(DesignTokens.navy)
            .padding(DesignTokens.space_md)
            .background(DesignTokens.canvas, in: RoundedRectangle(cornerRadius: DesignTokens.radius_sm))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radius_sm)
                    .strokeBorder(error == nil ? DesignTokens.border : DesignTokens.danger)
            )
            .padding(.top, DesignTokens.space_sm)
            .accessibilityIdentifier(tag)

            if let limit {
                expertCopy(NoticeText.fieldCount(value.count, limit), size: DesignTokens.type_caption, color: DesignTokens.muted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            if let error {
                expertCopy(error, size: DesignTokens.type_caption, color: DesignTokens.danger)
            }
        }
        .padding(.top, DesignTokens.space_2xl)
    }
}
