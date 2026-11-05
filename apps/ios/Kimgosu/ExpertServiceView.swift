import PhotosUI
import SwiftUI

/// 고수 서비스 목록·등록·수정 (WS-42).
///
/// 목록은 `GET /v1/me/expert`의 services[]가 정본이며 로컬에 저장하지 않는다.
/// 노출 토글은 서버 PATCH 결과로만 확정하고, 실패하면 이전 값으로 되돌린다.
/// 가격유형이 NEGOTIABLE이면 가격 입력을 비활성화하고 basePrice를 null로 보낸다.
/// 유효하지 않은 조합(가격 없는 FIXED 등)은 클라이언트가 고치지 않고 서버 400을 표시한다.

struct ServiceImage: Hashable {
    let key: String
    let url: String?
    let sortOrder: Int
}

struct ExpertServiceItem: Hashable {
    let id: String
    let category: String
    let title: String
    let description: String
    let priceType: String
    let basePrice: Int?
    let visibility: String
    let images: [ServiceImage]

    var visibilityValue: Bool { visibility == "VISIBLE" }
}

struct ServiceDraft: Hashable {
    let id: String?
    var category: String
    var title: String
    var description: String
    var priceType: String
    var price: String
    var images: [ServiceImage]
}

enum ExpertServicesState: Equatable {
    case loading
    case empty
    case failed(network: Bool, code: String)
    case ready([ExpertServiceItem])
}

enum ServiceSaveState: Equatable {
    case idle
    case saving
    case saved(String)
    case failed(network: Bool, code: String)
}

@MainActor final class ExpertServiceModel: ObservableObject {
    @Published private(set) var state: ExpertServicesState = .loading
    @Published private(set) var save: ServiceSaveState = .idle
    /// 목록 조작(노출 토글 등) 실패 문구. 폼의 저장 오류와 자리를 구분한다.
    @Published private(set) var notice: String?
    private let repository: KGAuthRepository
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(repository: KGAuthRepository = KGAuthRepository(), sessions: KGSessionStorage = KGSecureSession()) {
        self.repository = repository
        self.sessions = sessions
    }

    func load() {
        task?.cancel()
        notice = nil
        guard let token = (try? sessions.read()) ?? nil else {
            state = .failed(network: false, code: "SIGN_IN_REQUIRED")
            return
        }
        state = .loading
        task = Task { [weak self] in
            guard let self else { return }
            do { state = try await read(token) }
            catch is CancellationError { return }
            catch let error as KGAuthAPIError { state = .failed(network: false, code: error.code) }
            catch { state = .failed(network: KGNetworkFailure.isNetwork(error), code: "NETWORK_UNAVAILABLE") }
        }
    }

    /// 노출/숨김 토글. 화면은 즉시 새 값으로 바뀌고, 서버 PATCH가 실패하면 이전 목록으로 되돌린다.
    func setVisibility(_ item: ExpertServiceItem, visible: Bool) {
        guard case .ready(let items) = state, let token = (try? sessions.read()) ?? nil else { return }
        let target = visible ? "VISIBLE" : "HIDDEN"
        notice = nil
        state = .ready(items.map { $0.id == item.id ? ExpertServiceItem(id: $0.id, category: $0.category, title: $0.title,
            description: $0.description, priceType: $0.priceType, basePrice: $0.basePrice, visibility: target,
            images: $0.images) : $0 })
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await repository.patchExpertService(token, id: item.id, body: ["visibility": target])
                state = try await read(token)
            } catch is CancellationError {
                return
            } catch let error as KGAuthAPIError {
                state = .ready(items)
                notice = "노출 상태를 바꾸지 못했습니다. (\(error.code))"
            } catch {
                state = .ready(items)
                notice = "네트워크에 연결할 수 없습니다. 노출 상태를 되돌렸습니다."
            }
        }
    }

    func save(_ draft: ServiceDraft) {
        guard let token = (try? sessions.read()) ?? nil else { return }
        save = .saving
        task?.cancel()
        let body: [String: Any] = [
            "category": draft.category,
            "title": draft.title,
            "description": draft.description,
            "priceType": draft.priceType,
            "basePrice": draft.priceType == "NEGOTIABLE" || draft.price.isEmpty ? NSNull() : (Int(draft.price) ?? NSNull()),
            "imageKeys": draft.images.map(\.key),
        ]
        task = Task { [weak self] in
            guard let self else { return }
            do {
                if let id = draft.id { _ = try await repository.patchExpertService(token, id: id, body: body) }
                else { _ = try await repository.createExpertService(token, body: body) }
            } catch is CancellationError {
                return
            } catch let error as KGAuthAPIError {
                save = .failed(network: error.status == 0, code: error.code)
                return
            } catch {
                save = .failed(network: KGNetworkFailure.isNetwork(error), code: "NETWORK_UNAVAILABLE")
                return
            }
            do {
                state = try await read(token)
                save = .saved(draft.id == nil ? "서비스를 등록했습니다." : "서비스를 수정했습니다.")
            } catch is CancellationError {
                return
            } catch {
                save = .saved("저장했습니다. 최신 목록을 다시 불러오지 못했습니다.")
            }
        }
    }

    func clearSave() { save = .idle }

    /// 사진은 앱이 R2로 직접 올리고 키만 서버에 넘긴다. 키는 업로드 응답이 발급한
    /// `service/<memberId>/…`여야 서버가 소유권을 인정한다.
    func uploadPhoto(_ item: PhotosPickerItem, sortOrder: Int) async throws -> ServiceImage {
        guard let token = (try? sessions.read()) ?? nil else {
            throw KGAuthAPIError(status: 401, code: "SIGN_IN_REQUIRED")
        }
        guard let data = try await item.loadTransferable(type: Data.self) else {
            throw KGAuthAPIError(status: 400, code: "UNSUPPORTED_IMAGE_TYPE")
        }
        let contentType = item.supportedContentTypes.first(where: { $0.preferredMIMEType?.hasPrefix("image/") == true })?
            .preferredMIMEType ?? "image/jpeg"
        let presigned = try await repository.createUpload(token, contentType: contentType)
        guard let uploadUrl = presigned["uploadUrl"] as? String, let key = presigned["key"] as? String,
              let url = URL(string: uploadUrl) else {
            throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 15
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.cannotParseResponse)
        }
        return ServiceImage(key: key, url: presigned["publicUrl"] as? String, sortOrder: sortOrder)
    }

    private func read(_ token: String) async throws -> ExpertServicesState {
        let items = Self.decodeServices(try await repository.expertSelf(token))
        return items.isEmpty ? .empty : .ready(items)
    }

    nonisolated static func decodeServices(_ json: [String: Any]) -> [ExpertServiceItem] {
        guard let rows = json["services"] as? [[String: Any]] else { return [] }
        return rows.map { row in
            let imageKey = row["imageKey"] as? String
            // images[]가 없는 구서버 응답은 대표 이미지 한 장으로 본다.
            let images: [ServiceImage]
            if let rows = row["images"] as? [[String: Any]] {
                images = rows.enumerated().map { position, image in
                    ServiceImage(key: image["key"] as? String ?? "",
                                 url: image["url"] as? String,
                                 sortOrder: image["sortOrder"] as? Int ?? position)
                }
            } else if let imageKey, !imageKey.isEmpty {
                images = [ServiceImage(key: imageKey, url: row["imageUrl"] as? String, sortOrder: 0)]
            } else {
                images = []
            }
            return ExpertServiceItem(
                id: row["id"] as? String ?? "",
                category: row["category"] as? String ?? "",
                title: row["title"] as? String ?? "",
                description: row["description"] as? String ?? "",
                priceType: row["priceType"] as? String ?? "",
                basePrice: row["basePrice"] as? Int,
                visibility: row["visibility"] as? String ?? "",
                images: images
            )
        }
    }
}

private func priceLabel(_ item: ExpertServiceItem) -> String {
    switch item.priceType {
    case "NEGOTIABLE": return "가격 협의"
    case "HOURLY": return "시간당 " + (item.basePrice.map { "\($0)원" } ?? "가격 없음")
    case "FIXED": return item.basePrice.map { "\($0)원" } ?? "가격 없음"
    default: return item.priceType
    }
}

struct ExpertServiceView: View {
    @StateObject private var model = ExpertServiceModel()
    @State private var draft: ServiceDraft?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let draft {
                ServiceForm(draft: draft, save: model.save, onSave: model.save,
                            onUpload: { item, order in try await model.uploadPhoto(item, sortOrder: order) },
                            onCancel: { self.draft = nil; model.clearSave() })
                    .id(draft)
            } else {
                HStack {
                    expertCopy("서비스", size: 20, bold: true).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button("+ 등록") {
                        model.clearSave()
                        draft = ServiceDraft(id: nil, category: "", title: "", description: "",
                                             priceType: "FIXED", price: "", images: [])
                    }
                    .frame(minHeight: 48)
                    .accessibilityIdentifier("service-add")
                }
                .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 8)
                if let notice = model.notice {
                    expertCopy(notice, size: 13, color: DesignTokens.muted)
                        .padding(.horizontal, 20).padding(.vertical, 4)
                        .accessibilityIdentifier("service-notice")
                }
                if case .saved(let message) = model.save {
                    expertCopy(message, size: 13, color: DesignTokens.muted)
                        .padding(.horizontal, 20).padding(.vertical, 4)
                        .accessibilityIdentifier("service-save-saved")
                }
                switch model.state {
                case .loading:
                    expertLoading()
                case .empty:
                    expertEmpty("등록된 서비스가 없습니다. 서비스를 등록하면 고객 검색에 노출됩니다.", onRetry: model.load)
                case .failed(let network, let code):
                    expertFailure(network: network, code: code, onRetry: model.load)
                case .ready(let items):
                    ServiceList(items: items,
                                onEdit: { item in
                                    model.clearSave()
                                    draft = ServiceDraft(id: item.id, category: item.category, title: item.title,
                                                         description: item.description, priceType: item.priceType,
                                                         price: item.basePrice.map(String.init) ?? "",
                                                         images: item.images)
                                },
                                onToggle: { item, visible in model.setVisibility(item, visible: visible) })
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white)
        .accessibilityIdentifier("expert-services")
        .task { model.load() }
        // 저장이 끝나면 목록으로 돌아가 방금 등록·수정한 항목을 바로 보여준다.
        .onChange(of: model.save) { _, newValue in
            if case .saved = newValue { draft = nil }
        }
    }
}

/// 서비스 목록 렌더. 화면 본문과 QA 하네스가 같은 구성을 쓴다.
struct ServiceList: View {
    let items: [ExpertServiceItem]
    let onEdit: (ExpertServiceItem) -> Void
    let onToggle: (ExpertServiceItem, Bool) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    ServiceRow(item: item, index: index,
                               onEdit: { onEdit(item) },
                               onToggle: { onToggle(item, $0) })
                }
            }
            .padding(.horizontal, 20)
        }
    }
}

private struct ServiceRow: View {
    let item: ExpertServiceItem
    let index: Int
    let onEdit: () -> Void
    let onToggle: (Bool) -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                expertCopy(item.title, size: 15, semibold: true)
                expertCopy(item.category + " · " + priceLabel(item), size: 13, color: DesignTokens.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(perform: onEdit)
            .accessibilityIdentifier("service-row-\(index)")
            Toggle("", isOn: Binding(get: { item.visibilityValue }, set: onToggle))
                .labelsHidden()
                .tint(DesignTokens.navy)
                .accessibilityIdentifier("service-visibility-\(index)")
        }
        .padding(.vertical, 12)
        .overlay(Rectangle().fill(DesignTokens.border).frame(height: 1), alignment: .bottom)
    }
}

struct ServiceForm: View {
    let draft: ServiceDraft
    let save: ServiceSaveState
    let onSave: (ServiceDraft) -> Void
    let onUpload: (PhotosPickerItem, Int) async throws -> ServiceImage
    let onCancel: () -> Void
    @State private var category: String
    @State private var title: String
    @State private var description: String
    @State private var priceType: String
    @State private var price: String
    @State private var images: [ServiceImage]
    @State private var pickingPhotos = false
    @State private var selection: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var photoError: String?

    init(draft: ServiceDraft, save: ServiceSaveState,
         onSave: @escaping (ServiceDraft) -> Void,
         onUpload: @escaping (PhotosPickerItem, Int) async throws -> ServiceImage,
         onCancel: @escaping () -> Void) {
        self.draft = draft
        self.save = save
        self.onSave = onSave
        self.onUpload = onUpload
        self.onCancel = onCancel
        _category = State(initialValue: draft.category)
        _title = State(initialValue: draft.title)
        _description = State(initialValue: draft.description)
        _priceType = State(initialValue: draft.priceType)
        _price = State(initialValue: draft.price)
        _images = State(initialValue: draft.images)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    expertCopy(draft.id == nil ? "서비스 등록" : "서비스 수정", size: 18, bold: true)
                    Spacer()
                    Button("취소", action: onCancel).frame(minHeight: 48)
                        .accessibilityIdentifier("service-cancel")
                }
                expertField("카테고리", text: $category, lines: 1, limit: 50)
                    .accessibilityIdentifier("service-field-category")
                expertField("제목", text: $title, lines: 1, limit: 100)
                    .accessibilityIdentifier("service-field-title")
                expertField("설명", text: $description, lines: 4, limit: 2000)
                    .accessibilityIdentifier("service-field-description")
                expertCopy("가격유형", size: 13, color: DesignTokens.muted)
                HStack(spacing: 8) {
                    ForEach([("FIXED", "고정가"), ("HOURLY", "시간당"), ("NEGOTIABLE", "협의")], id: \.0) { value, label in
                        Button {
                            priceType = value
                            // 협의는 서버가 basePrice를 받지 않는다. 다른 유형으로 돌아오면 사용자가 다시 입력한다.
                            if value == "NEGOTIABLE" { price = "" }
                        } label: {
                            expertCopy(label, semibold: priceType == value)
                                .padding(.horizontal, 14).frame(minHeight: 36)
                                .background(priceType == value ? DesignTokens.soft : Color.white, in: Capsule())
                                .overlay(Capsule().stroke(DesignTokens.border))
                        }
                        .buttonStyle(.plain)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("service-price-type-\(value)")
                        .accessibilityAddTraits(priceType == value ? .isSelected : [])
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    expertCopy("기본가(원)", size: 13, color: DesignTokens.muted)
                    TextField("기본가(원)", text: $price)
                        .keyboardType(.numberPad)
                        .disabled(priceType == "NEGOTIABLE")
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                        .onChange(of: price) { _, newValue in
                            let digits = String(newValue.filter(\.isNumber).prefix(9))
                            if digits != newValue { price = digits }
                        }
                        .accessibilityIdentifier("service-field-price")
                    if priceType == "NEGOTIABLE" {
                        expertCopy("협의 유형은 가격을 입력하지 않습니다.", size: 12, color: DesignTokens.muted)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        expertCopy("사진 (\(images.count)/5)", size: 13, color: DesignTokens.muted)
                        Spacer()
                        Button("+ 사진 추가") { pickingPhotos = true }
                            .frame(minHeight: 48)
                            .disabled(uploading)
                            .accessibilityIdentifier("service-photo-add")
                    }
                    ForEach(Array(images.enumerated()), id: \.element.key) { index, image in
                        HStack(spacing: 12) {
                            ServicePhotoThumb(url: image.url, size: 64)
                            expertCopy(index == 0 ? "대표 사진" : "사진 \(index + 1)", size: 13, color: DesignTokens.muted)
                            Spacer()
                            Button("삭제") { images.remove(at: index) }
                                .frame(minHeight: 48)
                                .accessibilityIdentifier("service-photo-remove-\(index)")
                        }
                        .accessibilityIdentifier("service-photo-\(index)")
                    }
                    if uploading {
                        expertCopy("사진 업로드 중…", size: 13, color: DesignTokens.muted)
                            .accessibilityIdentifier("service-photo-uploading")
                    }
                    if let photoError {
                        expertCopy(photoError, size: 13, color: DesignTokens.muted)
                            .accessibilityIdentifier("service-photo-error")
                    }
                }
                // 서버가 5장을 넘으면 400 TOO_MANY_IMAGES로 거절한다. 선택 단계에서
                // 잘라내면 사용자는 왜 5장만 등록됐는지 알 수 없으므로 장수를 제한하지 않는다.
                .photosPicker(isPresented: $pickingPhotos, selection: $selection, matching: .images)
                .onChange(of: selection) { _, picked in
                    guard !picked.isEmpty else { return }
                    Task { await upload(picked) }
                }
                Button {
                    onSave(ServiceDraft(id: draft.id, category: category, title: title, description: description,
                                        priceType: priceType, price: price, images: images))
                } label: {
                    expertCopy(save == .saving ? "저장 중…" : "저장", size: 15, semibold: true, color: .white)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(save == .saving)
                .accessibilityIdentifier("service-save")
                switch save {
                case .idle, .saving, .saved:
                    EmptyView()
                case .failed(let network, let code):
                    expertCopy(network ? "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                                       : code == "TOO_MANY_IMAGES" ? "사진은 최대 5장까지 등록할 수 있습니다. (TOO_MANY_IMAGES)"
                                       : "저장하지 못했습니다. (\(code))", size: 13)
                        .accessibilityIdentifier(network ? "service-save-network" : "service-save-error")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 8)
        }
        .accessibilityIdentifier("service-form")
    }

    @MainActor
    private func upload(_ picked: [PhotosPickerItem]) async {
        uploading = true
        photoError = nil
        var added: [ServiceImage] = []
        var failure: String?
        for item in picked {
            do {
                added.append(try await onUpload(item, images.count + added.count))
            } catch let error as KGAuthAPIError {
                failure = error.status == 0
                    ? "네트워크에 연결할 수 없습니다. 사진을 올리지 못했습니다. (\(error.code))"
                    : "사진을 올리지 못했습니다. (\(error.code))"
                break
            } catch {
                failure = "네트워크에 연결할 수 없습니다. 사진을 올리지 못했습니다."
                break
            }
        }
        images.append(contentsOf: added)
        uploading = false
        photoError = failure
        // 같은 선택으로 onChange가 다시 돌지 않게 비운다.
        selection = []
    }
}

/// 원격 사진 썸네일. 실패하면 자리를 유지해 목록이 흔들리지 않게 한다.
struct ServicePhotoThumb: View {
    let url: String?
    let size: CGFloat

    var body: some View {
        RemoteImage(url: url, contentMode: .fill)
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
