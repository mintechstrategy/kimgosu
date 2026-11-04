plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "ai.mintech.kimgosu"
    compileSdk = 35
    defaultConfig {
        applicationId = "ai.mintech.kimgosu"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "0.1.6"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    // Development and production are separate installable apps with separate
    // backends. Nothing here falls back across environments: a build either
    // targets the dev API or the prod API, decided at build time.
    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "API_BASE_URL", "\"https://api-dev-kimgosu.mintech.ai\"")
            manifestPlaceholders["appLabel"] = "김고수 개발"
        }
        create("prod") {
            dimension = "environment"
            buildConfigField("String", "API_BASE_URL", "\"https://api-kimgosu.mintech.ai\"")
            manifestPlaceholders["appLabel"] = "김고수"
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("androidTest").assets.srcDir("../../../records/engineering/auth-v03-app-01/test-inputs")
    sourceSets.getByName("main").assets.srcDir("../../mobile-shared/MobileAssets")
    sourceSets.getByName("main").res.srcDir(layout.buildDirectory.dir("generated/launcher"))
}
val launcher by tasks.registering(Copy::class) {
    from("../../mobile-shared/MobileAssets/app_icon.png")
    into(layout.buildDirectory.dir("generated/launcher/drawable-nodpi"))
}
tasks.named("preBuild") { dependsOn(launcher) }
configurations.all { resolutionStrategy.activateDependencyLocking() }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    debugImplementation("androidx.compose.ui:ui-tooling")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
