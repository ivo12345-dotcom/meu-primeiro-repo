import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
}

// Sem `jvmToolchain`: fixar uma toolchain obriga a ter esse JDK exacto instalado
// ou a descarrega-lo. Fixar so o alvo do bytecode chega para o Android e deixa o
// modulo compilar com qualquer JDK 17 ou superior.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("failed", "skipped") }
}
