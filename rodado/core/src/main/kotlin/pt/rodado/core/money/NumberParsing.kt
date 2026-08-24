package pt.rodado.core.money

/**
 * Os CSV do Uber e da Bolt chegam em formatos diferentes conforme o pais e o
 * idioma da conta: ora "1.234,56", ora "1,234.56", ora "1234.56". Adivinhar
 * valor a valor da erros — "1,234" tanto pode ser mil duzentos e trinta e quatro
 * como um virgula duzentos e trinta e quatro.
 *
 * Por isso a decisao e tomada uma vez para o ficheiro inteiro: olha-se para
 * todos os valores da coluna e ve-se qual dos separadores se comporta como
 * decimal.
 */
enum class DecimalStyle {
    /** 1.234,56 — virgula decimal, ponto a separar milhares. */
    COMMA,

    /** 1,234.56 — ponto decimal, virgula a separar milhares. */
    DOT;

    companion object {
        /**
         * Deduz o estilo a partir de uma amostra de valores.
         *
         * Um separador que apareca com um numero de casas diferente de tres a
         * seguir so pode ser decimal. Se a amostra nao for conclusiva, assume
         * [COMMA], que e o formato das exportacoes portuguesas.
         */
        fun detect(samples: Iterable<String>): DecimalStyle {
            var commaEvidence = 0
            var dotEvidence = 0
            for (raw in samples) {
                val cleaned = cleanNumeric(raw)
                if (cleaned.isEmpty()) continue
                val lastComma = cleaned.lastIndexOf(',')
                val lastDot = cleaned.lastIndexOf('.')
                // Os dois presentes: o ultimo a aparecer e o decimal.
                if (lastComma >= 0 && lastDot >= 0) {
                    if (lastComma > lastDot) commaEvidence += 2 else dotEvidence += 2
                    continue
                }
                if (lastComma >= 0) {
                    val digitsAfter = cleaned.length - lastComma - 1
                    if (digitsAfter != 3) commaEvidence++
                }
                if (lastDot >= 0) {
                    val digitsAfter = cleaned.length - lastDot - 1
                    if (digitsAfter != 3) dotEvidence++
                }
            }
            return if (dotEvidence > commaEvidence) DOT else COMMA
        }
    }
}

/** Remove simbolos de moeda, espacos (incluindo o nao separavel) e sinais soltos. */
internal fun cleanNumeric(raw: String): String = buildString {
    var negative = false
    for (character in raw.trim()) {
        when {
            character.isDigit() || character == ',' || character == '.' -> append(character)
            character == '-' || character == '−' -> negative = true
            character == '(' -> negative = true
        }
    }
    if (negative && isNotEmpty()) insert(0, '-')
}

/**
 * Le um numero escrito no [style] indicado. Devolve null se a celula estiver
 * vazia ou nao contiver digitos — um campo em branco nao e um erro, e um zero
 * silencioso e que seria.
 */
fun parseDecimal(raw: String?, style: DecimalStyle): Double? {
    if (raw == null) return null
    val cleaned = cleanNumeric(raw)
    if (cleaned.isEmpty() || cleaned.none { it.isDigit() }) return null
    val normalized = when (style) {
        DecimalStyle.COMMA -> cleaned.replace(".", "").replace(',', '.')
        DecimalStyle.DOT -> cleaned.replace(",", "")
    }
    return normalized.toDoubleOrNull()
}

fun parseMoney(raw: String?, style: DecimalStyle): Money? =
    parseDecimal(raw, style)?.let { Money.ofEuros(it) }

/**
 * Le um numero escrito por uma pessoa no teclado, onde tanto aparece "0,03" como
 * "0.03".
 *
 * Aqui nao ha ficheiro nenhum de onde deduzir o estilo, por isso a regra e
 * simples: se ha virgula, e ela o separador decimal; se nao ha, e o ponto.
 */
fun parseUserDecimal(raw: String?): Double? {
    val cleaned = cleanNumeric(raw ?: return null)
    if (cleaned.isEmpty()) return null
    val style = if (cleaned.contains(',')) DecimalStyle.COMMA else DecimalStyle.DOT
    return parseDecimal(cleaned, style)
}

fun parseUserMoney(raw: String?): Money? = parseUserDecimal(raw)?.let { Money.ofEuros(it) }
