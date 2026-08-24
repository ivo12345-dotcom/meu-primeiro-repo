package pt.rodado.core.csv

import pt.rodado.core.model.Platform
import pt.rodado.core.model.Trip
import pt.rodado.core.money.DecimalStyle
import pt.rodado.core.money.Money
import pt.rodado.core.money.parseDecimal
import pt.rodado.core.money.parseMoney

enum class DistanceUnit(val label: String, val toKm: Double) {
    KM("km", 1.0),
    MILHAS("milhas", 1.609344)
}

/** Chaves dos campos que o importador procura no extrato. */
object TripField {
    const val ID = "id"
    const val DATE = "date"
    const val DISTANCE = "distance"
    const val GROSS = "gross"
    const val COMMISSION = "commission"
    const val TIPS = "tips"
    const val TOLLS = "tolls"
    const val NET = "net"
}

/**
 * O que o importador percebeu do ficheiro, antes de o aplicar.
 *
 * Os cabecalhos dos extratos mudam com o idioma da conta e com as actualizacoes
 * das plataformas, por isso nada disto e dado como garantido: a app mostra este
 * mapeamento ao utilizador e deixa corrigir a coluna que tenha sido mal
 * apanhada, em vez de importar valores errados em silencio.
 */
data class ImportPreview(
    val platform: Platform,
    val table: CsvTable,
    val mapping: ColumnMapping,
    val specs: List<ColumnSpec>,
    val decimalStyle: DecimalStyle,
    val dayFirst: Boolean,
    val distanceUnit: DistanceUnit
) {
    val missingRequired: List<ColumnSpec> get() = mapping.missingRequired(specs)
    val isUsable: Boolean get() = missingRequired.isEmpty()

    fun withMapping(key: String, index: Int?) = copy(mapping = mapping.with(key, index))
    fun withDistanceUnit(unit: DistanceUnit) = copy(distanceUnit = unit)
    fun withDecimalStyle(style: DecimalStyle) = copy(decimalStyle = style)
}

data class ImportResult(
    val trips: List<Trip>,
    val skippedRows: Int,
    val warnings: List<String>
)

object TripImporter {

    fun specsFor(platform: Platform): List<ColumnSpec> = listOf(
        ColumnSpec(
            TripField.ID, "Identificador da viagem",
            listOf(
                "id da viagem", "uuid da viagem", "trip id", "trip uuid", "id",
                "order id", "id da encomenda", "id do pedido", "ride id", "uuid"
            )
        ),
        ColumnSpec(
            TripField.DATE, "Data e hora",
            listOf(
                "data e hora", "data da viagem", "inicio da viagem", "hora de inicio",
                "hora do pedido", "data do pedido", "request time", "trip start",
                "start time", "accepted time", "data", "date", "datetime"
            ),
            required = true
        ),
        ColumnSpec(
            TripField.DISTANCE, "Distância",
            listOf(
                "distancia km", "distancia da viagem", "distancia percorrida",
                "trip distance", "distance km", "quilometros", "distancia",
                "distance", "km", "miles"
            )
        ),
        ColumnSpec(
            TripField.GROSS, "Valor da viagem (bruto)",
            listOf(
                "valor da viagem", "preco da viagem", "tarifa", "receita bruta",
                "ganhos brutos", "gross fare", "fare", "trip price", "ride price",
                "bruto", "valor bruto", "subtotal"
            )
        ),
        ColumnSpec(
            TripField.COMMISSION, "Comissão da plataforma",
            listOf(
                "comissao da plataforma", "taxa de servico", "comissao bolt",
                "comissao uber", "service fee", "platform fee", "uber fee",
                "bolt fee", "comissao", "commission"
            )
        ),
        ColumnSpec(
            TripField.TIPS, "Gorjetas",
            listOf("gorjetas", "gorjeta", "tips", "tip")
        ),
        ColumnSpec(
            TripField.TOLLS, "Portagens reembolsadas",
            listOf(
                "portagens reembolsadas", "reembolso de portagens", "portagens",
                "portagem", "tolls", "toll"
            )
        ),
        ColumnSpec(
            TripField.NET, "Ganho líquido da viagem",
            listOf(
                "ganhos liquidos", "ganho liquido", "valor liquido", "o teu ganho",
                "seu ganho", "net earnings", "your earnings", "driver earnings",
                "payout", "total a receber", "liquido"
            )
        )
    )

    fun preview(csvText: String, platform: Platform): ImportPreview {
        val table = CsvReader.parse(csvText)
        val specs = specsFor(platform)
        val mapping = ColumnMapping.detect(table.headers, specs)

        val moneyColumns = listOfNotNull(
            mapping.indexOf(TripField.GROSS),
            mapping.indexOf(TripField.NET),
            mapping.indexOf(TripField.COMMISSION),
            mapping.indexOf(TripField.TIPS)
        )
        val decimalSamples = moneyColumns.flatMap { table.columnValues(it) }
        val decimalStyle = DecimalStyle.detect(decimalSamples)

        val dateColumn = mapping.indexOf(TripField.DATE)
        val dayFirst = DateParsing.detectDayFirst(
            dateColumn?.let { table.columnValues(it) }.orEmpty()
        )

        val distanceHeader = mapping.indexOf(TripField.DISTANCE)
            ?.let { normalizeHeader(table.headers.getOrElse(it) { "" }) }
            .orEmpty()
        val unit = if (
            distanceHeader.contains("mile") || distanceHeader.contains("milha") ||
            Regex("\\bmi\\b").containsMatchIn(distanceHeader)
        ) DistanceUnit.MILHAS else DistanceUnit.KM

        return ImportPreview(platform, table, mapping, specs, decimalStyle, dayFirst, unit)
    }

    fun apply(preview: ImportPreview): ImportResult {
        if (!preview.isUsable) {
            val missing = preview.missingRequired.joinToString(", ") { it.label }
            return ImportResult(emptyList(), preview.table.rows.size, listOf("Faltam colunas: $missing"))
        }

        val table = preview.table
        val mapping = preview.mapping
        val trips = mutableListOf<Trip>()
        val warnings = mutableListOf<String>()
        var skipped = 0
        var withoutDistance = 0
        var withoutValue = 0

        fun moneyAt(row: List<String>, key: String): Money? =
            mapping.indexOf(key)
                ?.let { table.cell(row, it) }
                ?.let { parseMoney(it, preview.decimalStyle) }

        for ((rowIndex, row) in table.rows.withIndex()) {
            val moment = mapping.indexOf(TripField.DATE)
                ?.let { table.cell(row, it) }
                ?.let { DateParsing.parse(it, preview.dayFirst) }
            if (moment == null) {
                skipped++
                continue
            }

            val gross = moneyAt(row, TripField.GROSS)
            val net = moneyAt(row, TripField.NET)
            if (gross == null && net == null) {
                skipped++
                withoutValue++
                continue
            }

            val distanceRaw = mapping.indexOf(TripField.DISTANCE)
                ?.let { table.cell(row, it) }
                ?.let { parseDecimal(it, preview.decimalStyle) }
            if (distanceRaw == null) withoutDistance++

            val commission = moneyAt(row, TripField.COMMISSION) ?: Money.ZERO
            val externalId = mapping.indexOf(TripField.ID)?.let { table.cell(row, it) }

            trips += Trip(
                id = buildId(preview.platform, externalId, moment, rowIndex),
                platform = preview.platform,
                start = moment,
                distanceKm = (distanceRaw ?: 0.0) * preview.distanceUnit.toKm,
                gross = gross ?: net!!,
                // A comissao vem sempre positiva nas contas, venha ela com que sinal vier.
                commission = if (commission.cents < 0) -commission else commission,
                tips = moneyAt(row, TripField.TIPS) ?: Money.ZERO,
                tollsReimbursed = moneyAt(row, TripField.TOLLS) ?: Money.ZERO,
                net = net
            )
        }

        if (withoutDistance > 0) {
            warnings += "$withoutDistance viagens sem distância: os km com cliente ficam por baixo do real."
        }
        if (withoutValue > 0) {
            warnings += "$withoutValue linhas sem valor foram ignoradas."
        }
        if (trips.isEmpty()) {
            warnings += "Não foi importada nenhuma viagem. Confirma o mapeamento das colunas."
        }
        return ImportResult(trips, skipped, warnings)
    }

    /**
     * Identificador estavel da viagem.
     *
     * Importar o extrato da mesma semana duas vezes nao pode duplicar ganhos, por
     * isso o id tem de sair sempre igual para a mesma viagem. Quando a plataforma
     * da um identificador proprio, e esse; quando nao da, usa-se o instante da
     * viagem, que ja e praticamente unico.
     */
    private fun buildId(
        platform: Platform,
        externalId: String?,
        moment: java.time.Instant,
        rowIndex: Int
    ): String = when {
        !externalId.isNullOrBlank() -> "${platform.name}:$externalId"
        else -> "${platform.name}:${moment.epochSecond}:$rowIndex"
    }
}
