package ai.mintech.kimgosu.chat

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * design/chat-media-gallery/tokens.json 의 별칭을 design/tokens.json 확정값에 고정한다.
 * 화면 코드는 이 별칭만 쓰고 수치·색을 직접 적지 않는다.
 */
internal object ChatGalleryTokens {
    // space
    val screenInset = 20.dp // space.xl
    val headerVertical = 8.dp // space.sm
    val headerGap = 12.dp // space.md
    val sectionGap = 24.dp // space.2xl
    val itemGap = 8.dp // space.sm
    val metadataGap = 4.dp // space.xs
    val stateGap = 12.dp // space.md
    val footerInset = 16.dp // space.lg
    val actionGap = 8.dp // space.sm
    val buttonHorizontal = 16.dp // space.lg
    val buttonVertical = 12.dp // space.md

    // radius
    val radiusButton = 6.dp // radius.sm

    // touch
    val minTouch = 48.dp // touch.androidMinDp

    // type — ExpertCopy 가 sp 로 변환하므로 단위 없는 값으로 둔다.
    val screenTitle = 16 // type.subtitle
    val stateTitle = 20 // type.title
    val sectionTitle = 14 // type.bodyStrong
    val body = 14 // type.body
    val metadata = 12 // type.caption
    val action = 14 // type.bodyStrong

    // color — DesignTokens 에 아직 없는 확정 색만 여기서 한 번 정의한다.
    val errorText = Color(0xFFB42332) // color.danger
    val errorSurface = Color(0xFFFFF1F2) // color.dangerBg
}
