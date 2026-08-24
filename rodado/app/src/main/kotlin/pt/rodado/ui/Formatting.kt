package pt.rodado.ui

import pt.rodado.core.money.Money
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.DayOfWeek
import java.time.YearMonth
import java.util.Locale
import pt.rodado.core.model.LISBOA

private val PT = Locale("pt", "PT")

fun Money?.ou(traco: String = "—"): String = this?.format() ?: traco

fun Double?.km(): String = this?.let { String.format(PT, "%,.0f km", it) } ?: "—"

fun Double?.horas(): String = this?.let { String.format(PT, "%.1f h", it) } ?: "—"

fun Double?.percentagem(): String = this?.let { String.format(PT, "%.0f%%", it * 100) } ?: "—"

fun Double?.decimal(casas: Int = 1): String =
    this?.let { String.format(PT, "%.${casas}f", it) } ?: "—"

private val HORA = DateTimeFormatter.ofPattern("HH:mm").withZone(LISBOA)
private val DIA_HORA = DateTimeFormatter.ofPattern("dd/MM HH:mm").withZone(LISBOA)
private val DIA = DateTimeFormatter.ofPattern("dd/MM/yyyy").withZone(LISBOA)

fun Instant.horaCurta(): String = HORA.format(this)
fun Instant.diaHora(): String = DIA_HORA.format(this)
fun Instant.dia(): String = DIA.format(this)

fun DayOfWeek.nomePt(): String = when (this) {
    DayOfWeek.MONDAY -> "Segunda"
    DayOfWeek.TUESDAY -> "Terça"
    DayOfWeek.WEDNESDAY -> "Quarta"
    DayOfWeek.THURSDAY -> "Quinta"
    DayOfWeek.FRIDAY -> "Sexta"
    DayOfWeek.SATURDAY -> "Sábado"
    DayOfWeek.SUNDAY -> "Domingo"
}

private val MESES = listOf(
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez"
)

fun YearMonth.nomePt(): String = "${MESES[monthValue - 1]}/$year"
