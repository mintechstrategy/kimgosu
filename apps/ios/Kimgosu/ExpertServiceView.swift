import SwiftUI

/// 고수 서비스 목록·등록·수정 (WS-42).
///
/// 목록은 `GET /v1/me/expert`의 services[]가 정본이며 로컬에 저장하지 않는다.
/// 노출 토글은 서버 PATCH 결과로만 확정하고, 실패하면 이전 값으로 되돌린다.
/// 가격유형이 NEGOTIABLE이면 가격 입력을 비활성화하고 basePrice를 null로 보낸다.
/// 유효하지 않은 조합(가격 없는 FIXED 등)은 클라이언트가 고치지 않고 서버 400을 표시한다.

struct ExpertServiceItem: Hashable {
    let id: String
    let category: String
    let title: String
    let description: String
    let priceType: String
    let basePrice: Int?
    let visibility: String
    let imageKey: String?
    let images: [String]

    var visibilityValue: Bool { visibility == "VISIBLE" }
}

struct ServiceDraft: Hashable {
    let id: String?
    var category: String
    var title: String
    var description: String
    var priceType: String
    var price: String
    var imageKeys: [String]
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
            description: $0.description, priceType: $0.priceType, basePrice: $0.basePrice, visibility: target, imageKey: $0.imageKey,
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
            "imageKeys": draft.imageKeys.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty },
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

    private func read(_ token: String) async throws -> ExpertServicesState {
        let items = Self.decodeServices(try await repository.expertSelf(token))
        return items.isEmpty ? .empty : .ready(items)
    }

    nonisolated static func decodeServices(_ json: [String: Any]) -> [ExpertServiceItem] {
        guard let rows = json["services"] as? [[String: Any]] else { return [] }
        return rows.map { row in
            let imageKey = row["imageKey"] as? String
            let images = ((row["images"] as? [[String: Any]] ?? []).compactMap { $0["key"] as? String }).filter { !$0.isEmpty }
            return ExpertServiceItem(
                id: row["id"] as? String ?? "",
                category: row["category"] as? String ?? "",
                title: row["title"] as? String ?? "",
                description: row["description"] as? String ?? "",
                priceType: row["priceType"] as? String ?? "",
                basePrice: row["basePrice"] as? Int,
                visibility: row["visibility"] as? String ?? "",
                imageKey: imageKey,
                // 배포 전 서버는 images[]가 없고 imageKey만 준다. 그때도 한 장으로 보여준다.
                images: images.isEmpty ? (imageKey.map { [$0] } ?? []) : images
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
                            onCancel: { self.draft = nil; model.clearSave() })
                    .id(draft)
            } else {
                HStack {
                    expertCopy("서비스", size: 20, bold: true).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button("+ 등록") {
                        model.clearSave()
                        draft = ServiceDraft(id: nil, category: "", title: "", description: "",
                                             priceType: "FIXED", price: "", imageKeys: [])
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
                                                         imageKeys: item.images)
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
                if !item.images.isEmpty {
                    expertCopy("사진 \(item.images.count)장", size: 13, color: DesignTokens.muted)
                }
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
    let onCancel: () -> Void
    @State private var category: String
    @State private var title: String
    @State private var description: String
    @State private var priceType: String
    @State private var price: String
    @State private var imageKeys: [String]

    init(draft: ServiceDraft, save: ServiceSaveState, onSave: @escaping (ServiceDraft) -> Void, onCancel: @escaping () -> Void) {
        self.draft = draft
        self.save = save
        self.onSave = onSave
        self.onCancel = onCancel
        _category = State(initialValue: draft.category)
        _title = State(initialValue: draft.title)
        _description = State(initialValue: draft.description)
        _priceType = State(initialValue: draft.priceType)
        _price = State(initialValue: draft.price)
        _imageKeys = State(initialValue: draft.imageKeys)
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
                expertCopy("사진 (최대 5장, 첫 장이 대표 이미지)", size: 13, color: DesignTokens.muted)
                ForEach(imageKeys.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 4) {
                        expertField("이미지 키 \(index + 1)",
                                    text: Binding(get: { imageKeys[index] }, set: { imageKeys[index] = $0 }),
                                    lines: 1, limit: 300)
                            .accessibilityIdentifier("service-field-image-key-\(index)")
                        Button("사진 삭제") { imageKeys.remove(at: index) }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("service-image-remove-\(index)")
                    }
                }
                if imageKeys.count < 5 {
                    Button("+ 사진 추가") { imageKeys.append("") }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("service-image-add")
                }
                Button {
                    onSave(ServiceDraft(id: draft.id, category: category, title: title, description: description,
                                        priceType: priceType, price: price, imageKeys: imageKeys))
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
                                       : "저장하지 못했습니다. (\(code))", size: 13)
                        .accessibilityIdentifier(network ? "service-save-network" : "service-save-error")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 8)
        }
        .accessibilityIdentifier("service-form")
    }
}
