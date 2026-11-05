package ai.mintech.kimgosu.settings

import ai.mintech.kimgosu.ui.DesignTokens
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * 설정·알림 동의 화면이 쓰는 값. 화면 코드에는 수치·색을 직접 쓰지 않고 여기 이름만 쓴다.
 * 이름과 값은 design/settings-alarm-consent/tokens.json → design/tokens.json(confirmed)에서 온다.
 */
object ConsentTokens {
    // color
    val background = Color.White // color.canvas
    val heading = DesignTokens.navy // color.navy
    val body = DesignTokens.navy
    val secondaryText = DesignTokens.muted // color.muted
    val separator = DesignTokens.border // color.border
    val primaryBackground = DesignTokens.navy // color.navy
    val primaryText = Color.White // color.canvas
    val switchThumb = DesignTokens.navy // color.navy
    val switchOffTrack = DesignTokens.track // color.track
    val switchOnTrack = DesignTokens.lime // color.lime
    val errorText = Color(0xFFB42332) // color.danger
    val errorBackground = Color(0xFFFFF1F2) // color.dangerBg

    // space
    val screenHorizontal = 20.dp // space.xl
    val headerVertical = 8.dp // space.sm
    val headerItemGap = 12.dp // space.md
    val bodyVertical = 24.dp // space.2xl
    val sectionGap = 24.dp // space.2xl
    val rowVertical = 16.dp // space.lg
    val rowItemGap = 12.dp // space.md
    val textGap = 4.dp // space.xs
    val stateTextGap = 12.dp // space.md
    val footerVertical = 16.dp // space.lg
    val footerItemGap = 8.dp // space.sm
    val buttonHorizontal = 16.dp // space.lg
    val buttonVertical = 12.dp // space.md

    // radius
    val buttonRadius = 6.dp // radius.sm
    val modalRadius = 10.dp // radius.md

    // type size (sp)
    const val screenTitle = 16 // type.subtitle
    const val stateTitle = 20 // type.title
    const val sectionTitle = 16 // type.subtitle
    const val rowTitle = 14 // type.bodyStrong
    const val bodySize = 14 // type.body
    const val metadata = 12 // type.caption
    const val action = 14 // type.bodyStrong

    // touch
    val touchMinimum = 48.dp // touch.androidMinDp
    val strokeWidth = 1.dp // color.border 선 두께(기존 구분선 상속)

    // platform switch geometry (기존 Material 기본 형태 유지, 크기만 이름으로 고정)
    val switchWidth = 52.dp
    val switchHeight = 32.dp
}
