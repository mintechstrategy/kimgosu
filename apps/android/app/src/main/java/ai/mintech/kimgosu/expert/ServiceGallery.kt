package ai.mintech.kimgosu.expert

import ai.mintech.kimgosu.ui.DesignTokens
import ai.mintech.kimgosu.ui.RemoteImage
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * 고객이 보는 서비스 사진 갤러리. 서버가 준 sortOrder 순서대로 좌우 스와이프한다.
 * 사진은 4:3 틀 안에서 Fit으로 그려 원본 비율을 유지한다(찌그러짐·강제 크롭 없음).
 */
@Composable
fun ServiceImageGallery(images: List<ServiceImage>, modifier: Modifier = Modifier) {
    val ordered = images.sortedBy { it.sortOrder }
    if (ordered.isEmpty()) return
    val pager = rememberPagerState(pageCount = { ordered.size })
    Column(modifier) {
        HorizontalPager(
            state = pager,
            modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f).testTag("service-gallery"),
        ) { page ->
            RemoteImage(ordered[page].url, Modifier.fillMaxSize().testTag("service-gallery-page-$page"),
                contentScale = ContentScale.Fit)
        }
        if (ordered.size > 1) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.Center) {
                ordered.indices.forEach { index ->
                    Box(
                        Modifier.padding(horizontal = 3.dp).size(6.dp).background(
                            if (pager.currentPage == index) DesignTokens.navy else Color(0xFFDDDDDD),
                            CircleShape,
                        ),
                    )
                }
            }
        }
    }
}
