package pt.rodado.core.csv

import pt.rodado.core.model.DriverWeek
import pt.rodado.core.model.Platform
import pt.rodado.core.money.DecimalStyle
import pt.rodado.core.money.Money
import pt.rodado.core.money.parseMoney
import java.time.LocalDate

/** Campos do relatorio semanal por motorista. */
object DriverWeekField {
    const val NAME = "name"
    const val DRIVER_ID = "driverId"
    const val GROSS = "gross"
    const val COMMISSION = "commission"
    const val TOTAL_FEES = "totalFees"
    const val TIPS = "tips"
    const val TOLLS = "tolls"
    const val NET = "net"
    const val GROSS_PER_HOUR = "grossPerHour"
    const val NET_PER_HOUR = "netPerHour"
}

data class DriverWeekPreview(
    val platform: Platform,
    val table: CsvTable,
    val mapping: ColumnMapping,
    val specs: List<ColumnSpec>,
    val decimalStyle: DecimalStyle,
    val weekStart: LocalDate,
    val weekEnd: LocalDate
) {
    val missingRequired: List<ColumnSpec> get() = mapping.missingRequired(specs)
    val isUsable: Boolean get() = missingRequired.isEmpty()

    fun withMapping(key: String, index: Int?) = copy(mapping = mapping.with(key, index))
    fun withWeek(start: LocalDate, end: LocalDate) = copy(weekStart = start, weekEnd = end)
}

data class DriverWeekResult(
    val weeks: List<DriverWeek>,
    val skippedRows: Int,
    val warnings: List<String>
)

/**
 * Importa o relatorio "Ganhos por motorista" que as plataformas dao a quem tem
 * frota: uma linha por motorista, com o resumo da semana.
 */
object DriverWeekImporter {

    fun specs(): List<ColumnSpec> = listOf(
        ColumnSpec(
            DriverWeekField.NAME, "Motorista",
            listOf("motorista", "nome do motorista", "driver", "driver name", "nome"),
            required = true
        ),
        ColumnSpec(
            DriverWeekField.DRIVER_ID, "Identificador do motorista",
            listOf("identificador do motorista", "driver id", "identificador individual", "uuid")
        ),
        ColumnSpec(
            DriverWeekField.GROSS, "Ganhos brutos",
            listOf(
                "ganhos brutos total", "ganhos brutos", "gross earnings total",
                "gross earnings", "total bruto", "bruto"
            ),
            required = true
        ),
        ColumnSpec(
            DriverWeekField.COMMISSION, "Comissões",
            listOf("comissoes", "comissao", "commission", "uber fee", "service fee")
        ),
        ColumnSpec(
            DriverWeekField.TOTAL_FEES, "Total de taxas",
            listOf("total de taxas", "total fees", "taxas totais")
        ),
        ColumnSpec(
            DriverWeekField.TIPS, "Gorjetas",
            listOf("gorjetas dos passageiros", "gorjetas", "gorjeta", "tips")
        ),
        ColumnSpec(
            DriverWeekField.TOLLS, "Portagens",
            listOf("portagens", "portagem", "tolls")
        ),
        ColumnSpec(
            DriverWeekField.NET, "Ganhos líquidos",
            listOf(
                "ganhos liquidos", "pagamento previsto", "net earnings",
                "expected payout", "liquido"
            ),
            required = true
        ),
        ColumnSpec(
            DriverWeekField.GROSS_PER_HOUR, "Ganhos brutos por hora",
            listOf("ganhos brutos por hora", "gross earnings per hour", "bruto por hora")
        ),
        ColumnSpec(
            DriverWeekField.NET_PER_HOUR, "Ganhos líquidos por hora",
            listOf("ganhos liquidos por hora", "net earnings per hour", "liquido por hora")
        )
    )

    fun preview(
        csvText: String,
        platform: Platform,
        fileName: String? = null,
        fallbackWeekStart: LocalDate = LocalDate.now().with(java.time.DayOfWeek.MONDAY)
    ): DriverWeekPreview {
        val table = CsvReader.parse(csvText)
        val specs = specs()
        val mapping = ColumnMapping.detect(table.headers, specs)

        val moneyColumns = listOfNotNull(
            mapping.indexOf(DriverWeekField.GROSS),
            mapping.indexOf(DriverWeekField.NET),
            mapping.indexOf(DriverWeekField.COMMISSION)
        )
        val style = DecimalStyle.detect(moneyColumns.flatMap { table.columnValues(it) })

        val period = fileName?.let { PeriodFromFileName.parse(it) }
        return DriverWeekPreview(
            platform = platform,
            table = table,
            mapping = mapping,
            specs = specs,
            decimalStyle = style,
            weekStart = period?.first ?: fallbackWeekStart,
            weekEnd = period?.second ?: fallbackWeekStart.plusDays(6)
        )
    }

    fun apply(preview: DriverWeekPreview): DriverWeekResult {
        if (!preview.isUsable) {
            return DriverWeekResult(
                emptyList(),
                preview.table.rows.size,
                listOf("Faltam colunas: " + preview.missingRequired.joinToString(", ") { it.label })
            )
        }

        val table = preview.table
        val mapping = preview.mapping
        val weeks = mutableListOf<DriverWeek>()
        val warnings = mutableListOf<String>()
        var skipped = 0
        var semHoras = 0

        fun text(row: List<String>, key: String): String? =
            mapping.indexOf(key)?.let { table.cell(row, it) }

        fun money(row: List<String>, key: String): Money? =
            text(row, key)?.let { parseMoney(it, preview.decimalStyle) }

        for (row in table.rows) {
            val name = text(row, DriverWeekField.NAME)
            val gross = money(row, DriverWeekField.GROSS)
            val net = money(row, DriverWeekField.NET)
            if (name.isNullOrBlank() || gross == null || net == null) {
                skipped++
                continue
            }

            val driverId = text(row, DriverWeekField.DRIVER_ID) ?: name
            val grossPerHour = money(row, DriverWeekField.GROSS_PER_HOUR)
            if (grossPerHour == null || grossPerHour.cents <= 0) semHoras++

            val commission = money(row, DriverWeekField.COMMISSION) ?: Money.ZERO
            val totalFees = money(row, DriverWeekField.TOTAL_FEES) ?: commission

            weeks += DriverWeek(
                id = "${preview.platform.name}:$driverId:${preview.weekStart}",
                platform = preview.platform,
                driverId = driverId,
                driverName = name,
                weekStart = preview.weekStart,
                weekEnd = preview.weekEnd,
                gross = gross,
                commission = commission,
                // As taxas incluem a comissao; o que sobra sao taxas de outra natureza.
                otherFees = (totalFees - commission).let { if (it.cents > 0) it else Money.ZERO },
                tips = money(row, DriverWeekField.TIPS) ?: Money.ZERO,
                tolls = money(row, DriverWeekField.TOLLS) ?: Money.ZERO,
                net = net,
                grossPerHour = grossPerHour,
                netPerHour = money(row, DriverWeekField.NET_PER_HOUR)
            )
        }

        if (semHoras > 0) {
            warnings += "$semHoras motoristas sem ganhos por hora: não dá para saber quantas horas estiveram ligados."
        }
        if (weeks.isEmpty()) warnings += "Não foi importado nenhum motorista. Confirma as colunas."
        return DriverWeekResult(weeks, skipped, warnings)
    }
}

/**
 * Descobre o periodo a partir do nome do ficheiro.
 *
 * A Uber poe as datas no nome — "Ganhos_por_motorista17_ago_2026 23_ago_2026 ..."
 * — e em lado nenhum dentro do ficheiro. Sem isto, todas as semanas importadas
 * ficavam empilhadas na mesma data.
 */
object PeriodFromFileName {

    private val MESES = mapOf(
        "jan" to 1, "fev" to 2, "mar" to 3, "abr" to 4, "mai" to 5, "jun" to 6,
        "jul" to 7, "ago" to 8, "set" to 9, "out" to 10, "nov" to 11, "dez" to 12,
        "sep" to 9, "oct" to 10, "dec" to 12, "may" to 5, "apr" to 4, "aug" to 8
    )

    private val DATA = Regex("(\\d{1,2})[_ -]([a-zç]{3,12})[_ -](\\d{4})", RegexOption.IGNORE_CASE)

    fun parse(fileName: String): Pair<LocalDate, LocalDate>? {
        val encontradas = DATA.findAll(fileName.lowercase()).mapNotNull { match ->
            val dia = match.groupValues[1].toIntOrNull() ?: return@mapNotNull null
            val mes = MESES[match.groupValues[2].take(3)] ?: return@mapNotNull null
            val ano = match.groupValues[3].toIntOrNull() ?: return@mapNotNull null
            runCatching { LocalDate.of(ano, mes, dia) }.getOrNull()
        }.toList()

        return when {
            encontradas.size >= 2 -> encontradas[0] to encontradas[1]
            encontradas.size == 1 -> encontradas[0] to encontradas[0].plusDays(6)
            else -> null
        }
    }
}
