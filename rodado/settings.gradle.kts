pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "rodado"
include(":core")

// O modulo :app precisa do SDK do Android e do repositorio Google. Em maquinas
// sem eles (ou sem acesso ao repositorio da Google) da para correr na mesma os
// testes da matematica com:  gradle -PcoreOnly=true :core:test
val coreOnly = providers.gradleProperty("coreOnly").orNull == "true"
if (!coreOnly) include(":app")
