import SwiftUI

/// design/chat-media-gallery/tokens.json 의 별칭을 design/tokens.json 확정값에 고정한다.
/// 화면 코드는 이 별칭만 쓰고 수치·색을 직접 적지 않는다. 단위는 논리 pt.
enum KGGalleryTokens {
    // space
    static let screenInset: CGFloat = 20 // space.xl
    static let headerVertical: CGFloat = 8 // space.sm
    static let headerGap: CGFloat = 12 // space.md
    static let sectionGap: CGFloat = 24 // space.2xl
    static let itemGap: CGFloat = 8 // space.sm
    static let metadataGap: CGFloat = 4 // space.xs
    static let stateGap: CGFloat = 12 // space.md
    static let footerInset: CGFloat = 16 // space.lg
    static let actionGap: CGFloat = 8 // space.sm
    static let buttonHorizontal: CGFloat = 16 // space.lg
    static let buttonVertical: CGFloat = 12 // space.md

    // radius
    static let radiusButton: CGFloat = 6 // radius.sm

    // touch
    static let minTouch: CGFloat = 44 // touch.iosMinPt

    // type
    static let screenTitle: CGFloat = 16 // type.subtitle
    static let stateTitle: CGFloat = 20 // type.title
    static let sectionTitle: CGFloat = 14 // type.bodyStrong
    static let body: CGFloat = 14 // type.body
    static let metadata: CGFloat = 12 // type.caption
    static let action: CGFloat = 14 // type.bodyStrong

    // color — DesignTokens 에 아직 없는 확정 색
    static let errorText = Color(red: 180 / 255, green: 35 / 255, blue: 50 / 255) // color.danger
    static let errorSurface = Color(red: 255 / 255, green: 241 / 255, blue: 242 / 255) // color.dangerBg
}
