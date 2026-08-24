package pt.rodado.core.csv

/** Os dois tipos de relatorio que as plataformas dao. */
enum class ReportKind {
    /** Uma linha por viagem, com distancia e hora. */
    VIAGENS,

    /** Uma linha por motorista e por semana, o relatorio de quem tem frota. */
    FROTA,

    DESCONHECIDO
}

/**
 * Descobre que relatorio e que o utilizador escolheu.
 *
 * Obrigar a escolher o tipo antes de abrir o ficheiro seria uma decisao que ele
 * nao tem como tomar — os nomes dos ficheiros exportados nao ajudam nada. Os
 * cabecalhos, esses, sao inequivocos: so o relatorio de frota tem uma coluna de
 * motorista, e so o de viagens tem uma coluna de distancia por linha.
 */
object ReportDetector {

    private val MOTORISTA = listOf("motorista", "driver", "nome do motorista", "driver name")
    private val POR_HORA = listOf("ganhos brutos por hora", "gross earnings per hour", "por hora")
    private val DISTANCIA = listOf("distancia", "distance", "km", "miles", "quilometros")
    private val DATA = listOf("data e hora", "hora do pedido", "request time", "trip start", "data")

    fun detect(table: CsvTable): ReportKind {
        val cabecalhos = table.headers.map { normalizeHeader(it) }

        fun tem(aliases: List<String>) = aliases.any { alias ->
            val alvo = normalizeHeader(alias)
            cabecalhos.any { it == alvo || it.contains(alvo) }
        }

        val motorista = tem(MOTORISTA)
        val porHora = tem(POR_HORA)
        val distancia = tem(DISTANCIA)
        val data = tem(DATA)

        return when {
            motorista && (porHora || !data) -> ReportKind.FROTA
            distancia && data -> ReportKind.VIAGENS
            data -> ReportKind.VIAGENS
            else -> ReportKind.DESCONHECIDO
        }
    }

    fun detect(csvText: String): ReportKind = detect(CsvReader.parse(csvText))
}
