package ai.mintech.kimgosu.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// 목록을 오르내려도 같은 사진을 다시 받지 않는다: 메모리 → 캐시 파일 → 네트워크.
private val memoryCache = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
}

/** 공개 URL 사진. 자리표시자 → 로드 완료 페이드, 실패하면 같은 자리에 대체 표시를 남긴다. */
@Composable
fun RemoteImage(
    url: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val context = LocalContext.current.applicationContext
    var bitmap by remember(url) { mutableStateOf(url?.let(memoryCache::get)) }
    var failed by remember(url) { mutableStateOf(false) }
    LaunchedEffect(url) {
        if (url == null || bitmap != null) return@LaunchedEffect
        val cached = withContext(Dispatchers.IO) { readCachedBytes(context, url) }
        val loaded = cached ?: withContext(Dispatchers.IO) { download(context, url) }
        if (loaded == null) {
            failed = true
        } else {
            memoryCache.put(url, loaded)
            bitmap = loaded
        }
    }
    val fade by animateFloatAsState(if (bitmap != null) 1f else 0f, tween(180), label = "remote-image-fade")
    Box(modifier.background(DesignTokens.soft, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), contentDescription = null, modifier = Modifier.fillMaxSize().alpha(fade),
                contentScale = contentScale)
        } else if (failed) {
            Text("사진 없음", color = DesignTokens.muted, fontSize = 11.sp)
        }
    }
}

private fun cacheFile(context: Context, url: String): File {
    val name = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    return File(File(context.cacheDir, "images").apply { mkdirs() }, name)
}

private fun readCachedBytes(context: Context, url: String): Bitmap? {
    val file = cacheFile(context, url)
    if (!file.isFile) return null
    return BitmapFactory.decodeFile(file.path)
}

private fun download(context: Context, url: String): Bitmap? {
    val bytes = runCatching {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            if (connection.responseCode !in 200..299) return@runCatching null
            connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }.getOrNull() ?: return null
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    runCatching { cacheFile(context, url).writeBytes(bytes) }
    return bitmap
}
