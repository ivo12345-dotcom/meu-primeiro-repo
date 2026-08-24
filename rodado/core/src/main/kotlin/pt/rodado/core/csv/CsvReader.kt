package pt.rodado.core.csv

/** Uma tabela lida de um CSV: cabecalhos e linhas, tudo como texto. */
data class CsvTable(
    val headers: List<String>,
    val rows: List<List<String>>,
    val delimiter: Char
) {
    fun cell(row: List<String>, index: Int): String? =
        row.getOrNull(index)?.trim()?.takeIf { it.isNotEmpty() }

    /** Todos os valores de uma coluna, para deduzir formatos. */
    fun columnValues(index: Int): List<String> =
        rows.mapNotNull { cell(it, index) }
}

/**
 * Leitor de CSV segundo o RFC 4180, com deteccao do separador.
 *
 * As exportacoes portuguesas usam ponto e virgula quase sempre, porque a virgula
 * ja esta ocupada a separar as casas decimais; as inglesas usam virgula. Em vez
 * de assumir um, conta-se qual deles parte a primeira linha num numero de
 * colunas consistente com as restantes.
 */
object CsvReader {

    private val CANDIDATE_DELIMITERS = listOf(';', ',', '\t', '|')

    fun parse(text: String): CsvTable {
        val content = text.removePrefix("﻿")
        if (content.isBlank()) return CsvTable(emptyList(), emptyList(), ',')

        val delimiter = detectDelimiter(content)
        val records = splitRecords(content, delimiter).filter { record ->
            record.any { it.isNotBlank() }
        }
        if (records.isEmpty()) return CsvTable(emptyList(), emptyList(), delimiter)

        val headers = records.first().map { it.trim() }
        return CsvTable(headers, records.drop(1), delimiter)
    }

    private fun detectDelimiter(content: String): Char {
        var best = ','
        var bestScore = -1
        for (candidate in CANDIDATE_DELIMITERS) {
            val records = splitRecords(content, candidate).take(20).filter { record ->
                record.any { it.isNotBlank() }
            }
            if (records.isEmpty()) continue
            val headerWidth = records.first().size
            if (headerWidth < 2) continue
            // Premeia muitas colunas, penaliza linhas com largura diferente do cabecalho.
            val consistent = records.count { it.size == headerWidth }
            val score = headerWidth * 10 + consistent
            if (score > bestScore) {
                bestScore = score
                best = candidate
            }
        }
        return best
    }

    private fun splitRecords(content: String, delimiter: Char): List<List<String>> {
        val records = mutableListOf<List<String>>()
        var fields = mutableListOf<String>()
        val field = StringBuilder()
        var inQuotes = false
        var index = 0

        fun endField() {
            fields.add(field.toString())
            field.setLength(0)
        }

        fun endRecord() {
            endField()
            records.add(fields)
            fields = mutableListOf()
        }

        while (index < content.length) {
            val character = content[index]
            when {
                inQuotes && character == '"' ->
                    if (index + 1 < content.length && content[index + 1] == '"') {
                        field.append('"')
                        index++
                    } else {
                        inQuotes = false
                    }

                inQuotes -> field.append(character)
                character == '"' -> inQuotes = true
                character == delimiter -> endField()
                character == '\r' -> {
                    // \r\n conta como um unico fim de linha.
                    if (index + 1 < content.length && content[index + 1] == '\n') index++
                    endRecord()
                }

                character == '\n' -> endRecord()
                else -> field.append(character)
            }
            index++
        }
        if (field.isNotEmpty() || fields.isNotEmpty()) endRecord()
        return records
    }
}
