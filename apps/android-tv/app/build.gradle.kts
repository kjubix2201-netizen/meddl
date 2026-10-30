import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from the repository package.json so desktop, web and TV
// builds always carry the same number.
val rootPackageJson = rootDir.resolve("../../package.json").readText()
val appVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(rootPackageJson)
    ?.groupValues?.get(1) ?: "0.0.0"
val versionParts = appVersion.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
val appVersionCode = versionParts.getOrElse(0) { 0 } * 1_000_000 +
    versionParts.getOrElse(1) { 0 } * 1_000 + versionParts.getOrElse(2) { 0 }

// Release signing from environment (GitHub secrets). Without them the
// release build falls back to the repository test key (see signing/README.md).
val signingProps = Properties().apply {
    val file = rootDir.resolve("signing/test-signing.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: signingProps.getProperty(prop)

android {
    namespace = "io.github.kjubix2201_netizen.meddl.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.kjubix2201_netizen.meddl.tv"
        // Fire OS 5 (first Fire TV Sticks) is API 22.
        minSdk = 22
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        create("release") {
            val storePath = signingValue("MEDDL_ANDROID_KEYSTORE", "storeFile")
            if (storePath != null) {
                storeFile = rootDir.resolve(storePath).takeIf { it.exists() } ?: file(storePath)
                storePassword = signingValue("MEDDL_ANDROID_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("MEDDL_ANDROID_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("MEDDL_ANDROID_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // The WireGuard tunnel library uses Java 8 APIs (Optional …) that
        // Fire OS 5 / Android 5.1 lack.
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

val media3 = "1.5.0"

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    // Native player for streams the WebView plays silently (Dolby / DTS).
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    // FFmpeg audio decoder built by Jellyfin for this Media3 release:
    // AC-3, E-AC-3, DTS, TrueHD and more, decoded in software.
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:$media3+1")
    // Built-in VPN: the viewer's own WireGuard profile (Proton, Mullvad …),
    // only for meddl's own traffic. Last release that still supports API 21.
    implementation("com.wireguard.android:tunnel:1.0.20250531")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
