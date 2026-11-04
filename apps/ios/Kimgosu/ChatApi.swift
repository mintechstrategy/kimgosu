import Foundation

/// WS-51 채팅 이미지 첨부 — 서버 계약(contracts/chat.v0.1.json)의 iOS 구현.
///
/// 사진 바이트는 API를 통과하지 않는다. `POST /v1/uploads {contentType, kind:"chat"}`이
/// 준 presigned URL로 직접 PUT하고, 돌려받은 키(`chat/<memberId>/...`)만 메시지에 넣는다.
/// imageUrl은 서버가 R2 공개 도메인으로 합성한 값이므로 클라이언트가 만들지 않는다.
struct KGChatMessage: Identifiable, Equatable {
    let id, ledgerId, senderId, body, createdAt: String
    let imageUrl: String?
    let imageWidth, imageHeight: Int?
    let deleted: Bool

    static func decode(_ o: [String: Any]) -> KGChatMessage? {
        guard let id = o["id"] as? String, let ledgerId = o["ledgerId"] as? String,
              let senderId = o["senderId"] as? String, let createdAt = o["createdAt"] as? String else { return nil }
        func text(_ key: String) -> String? {
            guard let value = o[key] as? String, !value.isEmpty else { return nil }
            return value
        }
        func number(_ key: String) -> Int? {
            if let n = o[key] as? Int { return n }
            if let d = o[key] as? Double { return Int(d) }
            return nil
        }
        return KGChatMessage(
            id: id, ledgerId: ledgerId, senderId: senderId, body: text("body") ?? "",
            createdAt: createdAt,
            imageUrl: text("imageUrl"), imageWidth: number("imageWidth"), imageHeight: number("imageHeight"),
            deleted: o["deleted"] as? Bool ?? false)
    }
}

struct KGChatPage {
    let messages: [KGChatMessage]
    let total: Int
    let nextCursor: String?
}

struct KGChatApi {
    var transport: KGAuthTransport = KGMembershipHTTP()

    func list(_ token: String, ledgerId: String, before: String? = nil) async throws -> KGChatPage {
        var path = "/v1/ledgers/\(ledgerId)/messages"
        if let before, let encoded = before.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?before=" + encoded
        }
        let body = try await transport.request("GET", path, token: token, body: nil)
        let rows = body["messages"] as? [[String: Any]] ?? []
        return KGChatPage(messages: rows.compactMap(KGChatMessage.decode),
                          total: body["total"] as? Int ?? 0,
                          nextCursor: body["nextCursor"] as? String)
    }

    func sendText(_ token: String, ledgerId: String, body: String) async throws -> KGChatMessage {
        try await send(token, ledgerId, payload: ["body": body])
    }

    /// 사진을 R2에 올린 뒤 그 키로 메시지를 보낸다. 본문은 선택이다.
    func sendPhoto(_ token: String, ledgerId: String, bytes: Data, contentType: String,
                   width: Int, height: Int, body: String = "") async throws -> KGChatMessage {
        let key = try await upload(token, bytes, contentType)
        var payload: [String: Any] = ["imageKey": key, "imageWidth": width, "imageHeight": height]
        if !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { payload["body"] = body }
        return try await send(token, ledgerId, payload: payload)
    }

    private func send(_ token: String, _ ledgerId: String, payload: [String: Any]) async throws -> KGChatMessage {
        let body = try await transport.request("POST", "/v1/ledgers/\(ledgerId)/messages", token: token, body: payload)
        guard let message = KGChatMessage.decode(body) else {
            throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE")
        }
        return message
    }

    private func upload(_ token: String, _ bytes: Data, _ contentType: String) async throws -> String {
        let slot = try await transport.request("POST", "/v1/uploads", token: token,
                                                body: ["contentType": contentType, "kind": "chat"])
        guard let raw = slot["uploadUrl"] as? String, let url = URL(string: raw), url.scheme == "https" else {
            throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 15
        request.setValue(slot["contentType"] as? String ?? contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = bytes
        let (_, response) = try await URLSession.shared.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        guard (200...299).contains(http.statusCode) else {
            throw KGAuthAPIError(status: http.statusCode, code: "UPLOAD_FAILED")
        }
        guard let key = slot["key"] as? String, !key.isEmpty else {
            throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE")
        }
        return key
    }
}
