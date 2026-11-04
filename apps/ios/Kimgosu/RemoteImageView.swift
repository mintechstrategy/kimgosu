import SwiftUI
import UIKit

/// 공개 사진 한 장을 메모리 → URLCache 순서로 읽는다. 같은 URL은 다시 내려받지 않는다.
final class KGImageLoader {
    static let shared = KGImageLoader()
    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        // 사진 URL은 업로드마다 새로 생기는 불변 주소라 캐시된 바이트를 그대로 써도 된다.
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.urlCache = URLCache(memoryCapacity: 20 * 1024 * 1024, diskCapacity: 100 * 1024 * 1024,
                                   diskPath: "kg-images")
        session = URLSession(configuration: config)
    }

    func image(for url: URL) async -> UIImage? {
        if let cached = memory.object(forKey: url as NSURL) { return cached }
        guard let (data, response) = try? await session.data(from: url),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let image = UIImage(data: data) else { return nil }
        memory.setObject(image, forKey: url as NSURL)
        return image
    }
}

/// 자리표시자 → 로드 완료 페이드, 실패하면 같은 자리에 대체 아이콘을 남긴다.
struct RemoteImage: View {
    let url: String?
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            DesignTokens.soft
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if failed {
                VStack(spacing: 2) {
                    Image(systemName: "photo").font(.system(size: 18))
                    Text("사진 없음").font(.system(size: 11))
                }.foregroundStyle(DesignTokens.muted)
            }
        }
        .clipped()
        .task(id: url) {
            image = nil
            failed = false
            guard let url, let parsed = URL(string: url) else { failed = true; return }
            if let loaded = await KGImageLoader.shared.image(for: parsed) {
                withAnimation(.easeOut(duration: 0.18)) { image = loaded }
            } else {
                failed = true
            }
        }
    }
}
