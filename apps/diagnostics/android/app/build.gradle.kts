plugins { id("com.android.application") }
android {
    namespace = "ai.mintech.kimgosu.diagnostic"
    compileSdk = 35
    defaultConfig { applicationId = "ai.mintech.kimgosu.diagnostic"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.0.1" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
