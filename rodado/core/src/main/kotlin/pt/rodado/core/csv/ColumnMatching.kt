package pt.rodado.core.csv

import java.text.Normalizer

/** Normaliza um cabecalho para comparacao: sem acentos, sem pontuacao, minusculas. */
fun normalizeHeader(raw: String): String {
    val withoutAccents = Normalizer.normalize(raw, Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "")
    return withoutAccents
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), " ")
        .trim()
}

/** Um campo que o importador precisa de encontrar no CSV. */
data class ColumnSpec(
    val key: String,
    val label: String,
    val aliases: List<String>,
    val required: Boolean = false
)

/** A coluna escolhida para cada campo. Pode ser corrigida a mao na app. */
data class ColumnMapping(val byKey: Map<String, Int>) {

    fun indexOf(key: String): Int? = byKey[key]

    fun with(key: String, index: Int?): ColumnMapping = ColumnMapping(
        if (index == null) byKey - key else byKey + (key to index)
    )

    fun missingRequired(specs: List<ColumnSpec>): List<ColumnSpec> =
        specs.filter { it.required && !byKey.containsKey(it.key) }

    companion object {
        /**
         * Tenta ligar cada campo a uma coluna do ficheiro.
         *
         * Faz duas passagens: primeiro so aceita cabecalhos exactamente iguais a
         * um alias, e so depois aceita que o cabecalho contenha o alias. Sem essa
         * ordem, "Portagens" apanharia "Portagens reembolsadas" tao depressa como
         * a coluna certa, conforme a ordem em que aparecessem no ficheiro.
         */
        fun detect(headers: List<String>, specs: List<ColumnSpec>): ColumnMapping {
            val normalized = headers.map { normalizeHeader(it) }
            val taken = mutableSetOf<Int>()
            val result = mutableMapOf<String, Int>()

            fun findColumn(spec: ColumnSpec, exact: Boolean): Int? {
                for (alias in spec.aliases) {
                    val target = normalizeHeader(alias)
                    if (target.isEmpty()) continue
                    for (index in normalized.indices) {
                        if (index in taken) continue
                        val header = normalized[index]
                        val hit = if (exact) header == target else header.contains(target)
                        if (hit) return index
                    }
                }
                return null
            }

            for (exact in listOf(true, false)) {
                for (spec in specs) {
                    if (result.containsKey(spec.key)) continue
                    val index = findColumn(spec, exact) ?: continue
                    result[spec.key] = index
                    taken.add(index)
                }
            }
            return ColumnMapping(result)
        }
    }
}
