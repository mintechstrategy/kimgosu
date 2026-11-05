import SwiftUI

/// 설정·알림 동의 화면이 쓰는 값. 화면 코드에는 수치·색을 직접 쓰지 않고 여기 이름만 쓴다.
/// 이름과 값은 design/settings-alarm-consent/tokens.json → design/tokens.json(confirmed)에서 온다.
enum ConsentTokens {
    // color
    static let background = Color.white // color.canvas
    static let heading = DesignTokens.navy // color.navy
    static let body = DesignTokens.navy
    static let secondaryText = DesignTokens.muted // color.muted
    static let separator = DesignTokens.border // color.border
    static let primaryBackground = DesignTokens.navy // color.navy
    static let primaryText = Color.white // color.canvas
    static let switchThumb = DesignTokens.navy // color.navy
    static let switchOffTrack = DesignTokens.track // color.track
    static let switchOnTrack = DesignTokens.lime // color.lime
    static let errorText = Color(red: 180 / 255, green: 35 / 255, blue: 50 / 255) // color.danger
    static let errorBackground = Color(red: 255 / 255, green: 241 / 255, blue: 242 / 255) // color.dangerBg
    static let scrim = Color.black.opacity(0.35)

    // space
    static let screenHorizontal: CGFloat = 20 // space.xl
    static let headerVertical: CGFloat = 8 // space.sm
    static let headerItemGap: CGFloat = 12 // space.md
    static let bodyVertical: CGFloat = 24 // space.2xl
    static let sectionGap: CGFloat = 24 // space.2xl
    static let rowVertical: CGFloat = 16 // space.lg
    static let rowItemGap: CGFloat = 12 // space.md
    static let textGap: CGFloat = 4 // space.xs
    static let stateTextGap: CGFloat = 12 // space.md
    static let footerVertical: CGFloat = 16 // space.lg
    static let footerItemGap: CGFloat = 8 // space.sm
    static let buttonHorizontal: CGFloat = 16 // space.lg
    static let buttonVertical: CGFloat = 12 // space.md

    // radius
    static let buttonRadius: CGFloat = 6 // radius.sm
    static let modalRadius: CGFloat = 10 // radius.md

    // type size (pt)
    static let screenTitle: CGFloat = 16 // type.subtitle
    static let stateTitle: CGFloat = 20 // type.title
    static let sectionTitle: CGFloat = 16 // type.subtitle
    static let rowTitle: CGFloat = 14 // type.bodyStrong
    static let bodySize: CGFloat = 14 // type.body
    static let metadata: CGFloat = 12 // type.caption
    static let action: CGFloat = 14 // type.bodyStrong

    // touch
    static let touchMinimum: CGFloat = 44 // touch.iosMinPt

    // platform switch geometry (기존 iOS 스위치 형태 유지)
    static let switchWidth: CGFloat = 51
    static let switchHeight: CGFloat = 31
    static let switchThumbSize: CGFloat = 27
    static let stroke: CGFloat = 1
    static let spacingNone: CGFloat = 0
    static let modalMaxWidth: CGFloat = 480
    static let enabledOpacity: Double = 1
    static let disabledOpacity: Double = 0.6
}
