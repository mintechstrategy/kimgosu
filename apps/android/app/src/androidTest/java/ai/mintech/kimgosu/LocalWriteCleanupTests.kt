package ai.mintech.kimgosu

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import ai.mintech.kimgosu.auth.SecureSession
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** Test-only cleanup of this task's synthetic session slot, not device/app-data wipe. */
class LocalWriteCleanupTests {
    @Test fun clearOwnedSyntheticSession() {
        val app=ApplicationProvider.getApplicationContext<Application>()
        SecureSession(app).clear();assertNull(SecureSession(app).read())
        File(app.filesDir,"local-fixture-session-cleanup.json").writeText("{\"cleared\":true,\"readbackEmpty\":true,\"testOnly\":true}")
    }
}
