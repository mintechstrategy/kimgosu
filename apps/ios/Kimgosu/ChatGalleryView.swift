import SwiftUI

/// design/chat-media-gallery/screens.md 의 문구. 여기 없는 문장을 화면에 만들지 않는다.
enum KGGalleryCopy {
    static let entry = "사진·동영상·파일 모아보기"
    static let gTitle = "사진·동영상·파일"
    static let tabMedia = "사진·동영상"
    static let tabFiles = "파일"
    static let back = "뒤로"
    static let returnChat = "대화로 돌아가기"
    static let returnGallery = "모아보기로 돌아가기"
    static let retry = "다시 시도"
    static let net = "네트워크에 연결하지 못했습니다. 연결 상태를 확인한 후 다시 시도해 주십시오."
    static let roomDenied = "이 대화를 이용할 수 없습니다. 채팅 목록으로 돌아가 주십시오."
    static let preparing = "모아보기 기능을 준비 중입니다. 대화에서 첨부파일을 확인해 주십시오."
    static let thumbError = "미리보기 불가"
    static let thumbLoading = "미리보기 불러오는 중"
    static let photoKind = "사진"
    static let pTitle = "사진 보기"
    static let previous = "이전 첨부파일"
    static let next = "다음 첨부파일"
    static let readyA11y = "열기"

    // CHAT_MEDIA_GALLERY 상태 4종
    static let gLoading = "첨부파일을 불러오는 중입니다."
    static let gEmptyMedia = "아직 주고받은 사진과 동영상이 없습니다."
    static let gEmptyFiles = "아직 주고받은 파일이 없습니다."
    static let gError = "첨부파일을 불러오지 못했습니다. 다시 시도해 주십시오."
    static let gEmptyHelp = "대화로 돌아가 첨부파일을 주고받으십시오."

    // PHOTO_VIEWER 상태 4종
    static let pLoading = "사진을 불러오는 중입니다."
    static let pEmpty = "표시할 사진이 없습니다."
    static let pError = "사진을 불러오지 못했습니다. 다시 시도해 주십시오."
    static let vEmptyHelp = "이전 화면으로 돌아가 다른 첨부파일을 선택해 주십시오."
}

struct KGGalleryPhoto: Identifiable, Equatable {
    let id: String
    let url: String
    /// 서버 메시지 전송시각. 정렬·표시 모두 이 값을 쓴다.
    let sentAt: String
}

@MainActor final class KGChatGalleryModel: ObservableObject {
    enum State: Equatable {
        case loading
        case empty
        case failed(network: Bool, denied: Bool)
        case ready([KGGalleryPhoto])
    }

    @Published private(set) var state: State = .loading
    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    var photos: [KGGalleryPhoto] {
        if case .ready(let photos) = state { return photos }
        return []
    }

    /// 방 전체 첨부 전용 API 가 아직 없어, 서버가 허용한 메시지 첨부를 그대로 모아 보여준다.
    func load(ledgerId: String) {
        guard let token = (try? sessions.read()) ?? nil else {
            state = .failed(network: false, denied: false)
            return
        }
        if case .ready = state {} else { state = .loading }
        task?.cancel()
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let page = try await KGChatApi(transport: self.transport).list(token, ledgerId: ledgerId)
                if Task.isCancelled { return }
                let photos = page.messages
                    .filter { !$0.deleted && $0.imageUrl != nil }
                    .sorted { $0.createdAt > $1.createdAt }
                    .compactMap { message in message.imageUrl.map { KGGalleryPhoto(id: message.id, url: $0, sentAt: message.createdAt) } }
                self.state = photos.isEmpty ? .empty : .ready(photos)
            } catch {
                if Task.isCancelled { return }
                if let api = error as? KGAuthAPIError {
                    self.state = .failed(network: false, denied: api.status == 403 || api.status == 404)
                } else if KGNetworkFailure.isNetwork(error) {
                    self.state = .failed(network: true, denied: false)
                } else {
                    self.state = .failed(network: false, denied: false)
                }
            }
        }
    }
}

struct KGChatMediaGalleryView: View {
    let ledgerId: String
    let onClose: () -> Void
    @StateObject private var model = KGChatGalleryModel()
    @State private var tab = 0
    @State private var viewing: KGGalleryPhoto?

    var body: some View {
        Group {
            if let photo = viewing {
                KGPhotoViewerView(photo: photo, photos: model.photos, onBack: { viewing = nil })
            } else {
                gallery
            }
        }
        .background(Color.white)
        .task(id: ledgerId) { model.load(ledgerId: ledgerId) }
    }

    private var gallery: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: KGGalleryTokens.headerGap) {
                Button(KGGalleryCopy.back) { onClose() }
                    .frame(minHeight: KGGalleryTokens.minTouch)
                    .accessibilityIdentifier("chat-gallery-back")
                customerCopy(KGGalleryCopy.gTitle, size: KGGalleryTokens.screenTitle, bold: true)
                Spacer(minLength: 0)
            }.padding(.horizontal, KGGalleryTokens.screenInset).padding(.vertical, KGGalleryTokens.headerVertical)
            HStack(spacing: 0) {
                tabButton(KGGalleryCopy.tabMedia, index: 0)
                tabButton(KGGalleryCopy.tabFiles, index: 1)
            }.padding(.horizontal, KGGalleryTokens.screenInset)
            content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Button {
                onClose()
            } label: {
                customerCopy(KGGalleryCopy.returnChat, bold: true, color: .white)
                    .frame(maxWidth: .infinity, minHeight: KGGalleryTokens.minTouch)
                    .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: KGGalleryTokens.radiusButton))
            }.buttonStyle(.plain).padding(.horizontal, KGGalleryTokens.screenInset)
                .padding(.vertical, KGGalleryTokens.footerInset)
                .accessibilityIdentifier("chat-gallery-return-chat")
        }.accessibilityIdentifier("chat-gallery")
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            VStack(alignment: .leading, spacing: KGGalleryTokens.stateGap) {
                ProgressView()
                customerCopy(KGGalleryCopy.gLoading, size: KGGalleryTokens.body, color: DesignTokens.muted)
            }.padding(.horizontal, KGGalleryTokens.screenInset).padding(.vertical, KGGalleryTokens.sectionGap)
                .accessibilityIdentifier("chat-gallery-loading")
        case .failed(let network, let denied):
            VStack(alignment: .leading, spacing: KGGalleryTokens.stateGap) {
                customerCopy(denied ? KGGalleryCopy.roomDenied : (network ? KGGalleryCopy.net : KGGalleryCopy.gError),
                             size: KGGalleryTokens.body, color: KGGalleryTokens.errorText)
                    .padding(.horizontal, KGGalleryTokens.buttonHorizontal).padding(.vertical, KGGalleryTokens.buttonVertical)
                    .background(KGGalleryTokens.errorSurface, in: RoundedRectangle(cornerRadius: KGGalleryTokens.radiusButton))
                if !denied {
                    Button(KGGalleryCopy.retry) { model.load(ledgerId: ledgerId) }
                        .frame(minHeight: KGGalleryTokens.minTouch).accessibilityIdentifier("chat-gallery-retry")
                }
            }.padding(.horizontal, KGGalleryTokens.screenInset).padding(.vertical, KGGalleryTokens.sectionGap)
                .accessibilityIdentifier("chat-gallery-error")
        case .empty:
            notice(title: tab == 0 ? KGGalleryCopy.gEmptyMedia : KGGalleryCopy.gEmptyFiles,
                   help: tab == 0 ? KGGalleryCopy.gEmptyHelp : KGGalleryCopy.preparing)
        case .ready(let photos):
            if tab == 0 { mediaGrid(photos) } else { notice(title: KGGalleryCopy.gEmptyFiles, help: KGGalleryCopy.preparing) }
        }
    }

    private func tabButton(_ title: String, index: Int) -> some View {
        Button { tab = index } label: {
            customerCopy(title, size: KGGalleryTokens.body, bold: tab == index,
                         color: tab == index ? DesignTokens.navy : DesignTokens.muted)
                .frame(maxWidth: .infinity, minHeight: KGGalleryTokens.minTouch)
        }.buttonStyle(.plain).accessibilityAddTraits(tab == index ? .isSelected : [])
            .accessibilityIdentifier("chat-gallery-tab-\(index)")
    }

    private func notice(title: String, help: String) -> some View {
        VStack(alignment: .leading, spacing: KGGalleryTokens.stateGap) {
            customerCopy(title, size: KGGalleryTokens.stateTitle, bold: true)
            customerCopy(help, size: KGGalleryTokens.body, color: DesignTokens.muted)
        }.padding(.horizontal, KGGalleryTokens.screenInset).padding(.vertical, KGGalleryTokens.sectionGap)
    }

    private func mediaGrid(_ photos: [KGGalleryPhoto]) -> some View {
        GeometryReader { geometry in
            let inner = geometry.size.width - KGGalleryTokens.screenInset * 2
            // 슬롯이 최소 터치 폭보다 작아지면 3 → 2 → 1열로 줄인다.
            let columns = (inner - KGGalleryTokens.itemGap * 2) / 3 >= KGGalleryTokens.minTouch ? 3
                : ((inner - KGGalleryTokens.itemGap) / 2 >= KGGalleryTokens.minTouch ? 2 : 1)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: KGGalleryTokens.itemGap) {
                    ForEach(groups(photos)) { group in
                        customerCopy(group.id, size: KGGalleryTokens.sectionTitle, bold: true)
                            .padding(.top, KGGalleryTokens.sectionGap)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: KGGalleryTokens.itemGap),
                                                 count: columns),
                                  spacing: KGGalleryTokens.itemGap) {
                            ForEach(group.photos) { photo in
                                slot(photo)
                            }
                        }
                    }
                }.padding(.horizontal, KGGalleryTokens.screenInset)
            }.accessibilityIdentifier("chat-gallery-media")
        }
    }

    private struct DateGroup: Identifiable {
        let id: String
        var photos: [KGGalleryPhoto]
    }

    private func groups(_ photos: [KGGalleryPhoto]) -> [DateGroup] {
        var out: [DateGroup] = []
        for photo in photos {
            let date = kstDate(photo.sentAt)
            if out.last?.id == date {
                out[out.count - 1].photos.append(photo)
            } else {
                out.append(DateGroup(id: date, photos: [photo]))
            }
        }
        return out
    }

    private func slot(_ photo: KGGalleryPhoto) -> some View {
        KGallerySlotView(photo: photo) { viewing = photo }
    }
}

private struct KGallerySlotView: View {
    let photo: KGGalleryPhoto
    let onOpen: () -> Void
    @State private var attempt = 0

    var body: some View {
        VStack(alignment: .leading, spacing: KGGalleryTokens.metadataGap) {
            AsyncImage(url: URL(string: photo.url)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Button(KGGalleryCopy.thumbError) { attempt += 1 }
                        .frame(maxWidth: .infinity, minHeight: KGGalleryTokens.minTouch, maxHeight: .infinity)
                default:
                    customerCopy(KGGalleryCopy.thumbLoading, size: KGGalleryTokens.metadata, color: DesignTokens.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .id(attempt)
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .background(DesignTokens.track)
            .contentShape(Rectangle())
            .onTapGesture { onOpen() }
            .accessibilityLabel(mediaLabel(photo))
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("chat-gallery-slot")
            customerCopy(KGGalleryCopy.photoKind, size: KGGalleryTokens.metadata, color: DesignTokens.muted)
        }
    }
}

struct KGPhotoViewerView: View {
    let photo: KGGalleryPhoto
    let photos: [KGGalleryPhoto]
    let onBack: () -> Void
    @State private var index: Int
    @State private var attempt = 0

    init(photo: KGGalleryPhoto, photos: [KGGalleryPhoto], onBack: @escaping () -> Void) {
        self.photo = photo
        self.photos = photos
        self.onBack = onBack
        _index = State(initialValue: max(0, photos.firstIndex(of: photo) ?? 0))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: KGGalleryTokens.headerGap) {
                Button(KGGalleryCopy.back) { onBack() }
                    .frame(minHeight: KGGalleryTokens.minTouch)
                customerCopy(KGGalleryCopy.pTitle, size: KGGalleryTokens.screenTitle, bold: true)
                Spacer(minLength: 0)
            }.padding(.horizontal, KGGalleryTokens.screenInset).padding(.vertical, KGGalleryTokens.headerVertical)
            viewerContent(for: photos[safe: index]).frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, KGGalleryTokens.screenInset)
            HStack(spacing: KGGalleryTokens.actionGap) {
                Button(KGGalleryCopy.previous) { index = max(0, index - 1) }
                    .frame(maxWidth: .infinity, minHeight: KGGalleryTokens.minTouch)
                    .disabled(index == 0)
                Button(KGGalleryCopy.next) { index = min(photos.count - 1, index + 1) }
                    .frame(maxWidth: .infinity, minHeight: KGGalleryTokens.minTouch)
                    .disabled(index >= photos.count - 1)
            }.padding(.horizontal, KGGalleryTokens.screenInset).padding(.vertical, KGGalleryTokens.itemGap)
            Button {
                onBack()
            } label: {
                customerCopy(KGGalleryCopy.returnGallery, bold: true, color: .white)
                    .frame(maxWidth: .infinity, minHeight: KGGalleryTokens.minTouch)
                    .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: KGGalleryTokens.radiusButton))
            }.buttonStyle(.plain).padding(.horizontal, KGGalleryTokens.screenInset)
                .padding(.vertical, KGGalleryTokens.footerInset)
        }.accessibilityIdentifier("chat-photo-viewer")
    }

    @ViewBuilder private func viewerContent(for photo: KGGalleryPhoto?) -> some View {
        if let photo {
            AsyncImage(url: URL(string: photo.url)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    VStack(spacing: KGGalleryTokens.stateGap) {
                        customerCopy(KGGalleryCopy.pError, size: KGGalleryTokens.body, color: KGGalleryTokens.errorText)
                        Button(KGGalleryCopy.retry) { attempt += 1 }
                            .frame(minHeight: KGGalleryTokens.minTouch)
                    }
                default:
                    VStack(spacing: KGGalleryTokens.stateGap) {
                        ProgressView()
                        customerCopy(KGGalleryCopy.pLoading, size: KGGalleryTokens.body, color: DesignTokens.muted)
                    }
                }
            }.id(attempt).accessibilityLabel(mediaLabel(photo))
        } else {
            VStack(alignment: .leading, spacing: KGGalleryTokens.stateGap) {
                customerCopy(KGGalleryCopy.pEmpty, size: KGGalleryTokens.stateTitle, bold: true)
                customerCopy(KGGalleryCopy.vEmptyHelp, size: KGGalleryTokens.body, color: DesignTokens.muted)
            }
        }
    }
}

private func mediaLabel(_ photo: KGGalleryPhoto) -> String {
    KGGalleryCopy.photoKind + ", " + kstDateTime(photo.sentAt) + ", " + KGGalleryCopy.readyA11y
}

/// DATE_GROUP: KST 날짜. 연도 네 자리, 월·일 앞 0 없음.
func kstDate(_ iso: String) -> String {
    guard let time = kgKst(iso) else { return "" }
    let parts = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "Asia/Seoul")!, from: time)
    return "\(parts.year ?? 0)년 \(parts.month ?? 0)월 \(parts.day ?? 0)일"
}

/// SENT_AT: KST 날짜 + 24시간제 두 자리 시·분.
func kstDateTime(_ iso: String) -> String {
    guard let time = kgKst(iso) else { return "" }
    let parts = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "Asia/Seoul")!, from: time)
    return String(format: "%d년 %d월 %d일 %02d:%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0,
                  parts.hour ?? 0, parts.minute ?? 0)
}

private func kgKst(_ iso: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
