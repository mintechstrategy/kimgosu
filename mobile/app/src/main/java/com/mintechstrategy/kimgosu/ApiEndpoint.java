package com.mintechstrategy.kimgosu;

import android.os.Build;

final class ApiEndpoint {
    // The emulator reaches the host through 10.0.2.2; physical debug phones keep the LAN URL.
    static final String BASE = BuildConfig.DEBUG &&
            (Build.FINGERPRINT.contains("generic") || Build.MODEL.contains("Emulator"))
            ? "http://10.0.2.2:23913" : BuildConfig.API_BASE_URL;
    private ApiEndpoint() { }
}
