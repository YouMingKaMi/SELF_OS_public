import java.net.URI
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The script supplies a temporary build directory and passes private endpoints
// outside the command line. Direct Gradle use may still set -PselfOsEndpoint.
providers.gradleProperty("selfOsBuildDirectory").orNull?.let {
    layout.buildDirectory.set(file(it))
}

val defaultEndpoint = providers.environmentVariable("SELF_OS_ANDROID_BUILD_ENDPOINT")
    .orElse(providers.gradleProperty("selfOsEndpoint"))
    .orElse("")
    .get()
require(defaultEndpoint.isEmpty() || runCatching {
    val url = URI(defaultEndpoint)
    val local = url.host?.lowercase() in setOf("127.0.0.1", "localhost", "10.0.2.2")
    url.host != null && url.rawUserInfo == null && !url.rawAuthority.endsWith(':') &&
        (url.port == -1 || url.port in 1..65535) &&
        url.rawPath.isEmpty() && url.rawQuery == null && url.rawFragment == null &&
        (url.scheme.equals("https", ignoreCase = true) || url.scheme.equals("http", ignoreCase = true) && local)
}.getOrDefault(false)) { "Invalid selfOsEndpoint origin" }

dependencyLocking {
    lockAllConfigurations()
}

android {
    namespace = "org.personalcouncil.next.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.personalcouncil.next.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 20
        versionName = "0.3.14"
        buildConfigField("String", "DEFAULT_ENDPOINT", "\"$defaultEndpoint\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}
