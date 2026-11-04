import SwiftUI

/// 고객이 보는 서비스 사진 갤러리. 서버가 준 sortOrder 순서대로 좌우 스와이프한다.
/// 사진은 4:3 틀 안에서 scaledToFit으로 그려 원본 비율을 유지한다(찌그러짐·강제 크롭 없음).
struct ServiceImageGallery: View {
    let images: [ServiceImage]

    var body: some View {
        let ordered = images.sorted { $0.sortOrder < $1.sortOrder }
        if !ordered.isEmpty {
            TabView {
                ForEach(Array(ordered.enumerated()), id: \.element.key) { index, image in
                    ServiceGalleryPage(url: image.url)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: ordered.count > 1 ? .always : .never))
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .background(Color(white: 0.96))
            .accessibilityIdentifier("service-gallery")
        }
    }
}

private struct ServiceGalleryPage: View {
    let url: String?

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit()
            case .failure:
                Text("사진을 불러오지 못했습니다.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            case .empty:
                ProgressView()
            @unknown default:
                Color.clear
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
