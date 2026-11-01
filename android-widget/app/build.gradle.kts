plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 서명 키: 저장소 Secrets 에 넣어 두면 매번 같은 키로 서명해서 다시 깔지 않고 덮어 설치된다.
// 없으면 디버그 키로 서명한다 (빌드할 때마다 키가 달라져 새 버전은 지우고 다시 깔아야 함).
val keystore = rootProject.file("release.keystore")
val keystorePassword: String? = System.getenv("WIDGET_KEYSTORE_PASSWORD")

android {
    namespace = "io.github.yeobbun.classapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.yeobbun.classapp"
        minSdk = 26
        // 35 로 올리면 화면이 상태 표시줄 밑까지 깔려(edge-to-edge 강제) 학급관리 머리글이 가려진다
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    signingConfigs {
        if (keystore.exists() && keystorePassword != null) {
            create("release") {
                storeFile = keystore
                storePassword = keystorePassword
                keyAlias = System.getenv("WIDGET_KEY_ALIAS") ?: "widget"
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.core:core-ktx:1.13.1")
    // 위젯 목록을 갱신 때 통째로 넘긴다 (옛 안드로이드에서도)
    implementation("androidx.core:core-remoteviews:1.0.0")
    // 휴대폰의 구글 로그인 (드라이브·캘린더 권한)
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    testImplementation("junit:junit:4.13.2")
    // 안드로이드 단위 시험에서는 org.json 이 껍데기뿐이라 진짜를 넣는다
    testImplementation("org.json:json:20240303")
}
