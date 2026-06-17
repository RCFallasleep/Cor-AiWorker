plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij") version "1.17.3"
}

group = "com.example"
version = "2.0.0"

kotlin {
    jvmToolchain(17)
}

repositories {
    mavenCentral()
}

intellij {
    // 使用 IntelliJ IDEA Community 233.x 版本编译（对应 Android Studio Hedgehog/Iguana 内核）
    // 运行时安装到 Android Studio 使用
    version.set("233.15619.7")
    type.set("IC")
    // com.intellij.java 是 IC 内置插件；Android 插件从市场下载对应版本
    plugins.set(listOf("com.intellij.java", "org.jetbrains.android:233.15619.7"))
}

dependencies {
    implementation(kotlin("stdlib"))
    implementation(kotlin("reflect"))
}

tasks {
    buildSearchableOptions {
        enabled = false
    }

    // instrumentCode 在部分环境下因 ant-tasks 缺失而失败，禁用以保证 buildPlugin 可用
    instrumentCode {
        enabled = false
    }

    patchPluginXml {
        sinceBuild.set("233")
        untilBuild.set("253.*")  // 支持到 Android Studio Meerkat 2025.2（AI-252.x）及以上
    }

    wrapper {
        gradleVersion = "8.6"
    }

    compileKotlin {
        kotlinOptions.jvmTarget = "17"
    }

    compileTestKotlin {
        kotlinOptions.jvmTarget = "17"
    }
}
