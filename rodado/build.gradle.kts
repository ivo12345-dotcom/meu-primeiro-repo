// Sem bloco `plugins` na raiz de proposito: declarar aqui o plugin do Android
// obrigaria a resolve-lo mesmo para correr apenas os testes do modulo :core, que
// e Kotlin puro. Cada modulo declara o que precisa.
tasks.register("limpar") {
    group = "build"
    description = "Apaga os directorios de build de todos os modulos."
    doLast { subprojects.forEach { it.layout.buildDirectory.get().asFile.deleteRecursively() } }
}
