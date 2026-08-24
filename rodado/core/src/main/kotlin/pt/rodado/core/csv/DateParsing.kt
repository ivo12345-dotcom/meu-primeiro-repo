package pt.rodado.core.csv

import pt.rodado.core.model.LISBOA
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Data e hora tal como vem nos extratos.
 *
 * O 05/09/2026 tanto pode ser 5 de Setembro como 9 de Maio, conforme o idioma da
 * conta na plataforma. Como no resto do ficheiro, a decisao e tomada uma vez para
 * o ficheiro todo: se alguma linha tiver o primeiro numero acima de 12, o dia vem
 * primeiro; se for o segundo, vem o mes.
 */
object DateParsing {

    private val NUMERIC_SLASH = Regex("^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})")

    private val PATTERNS_TIME = listOf(
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd HH:mm",
        "yyyy/MM/dd HH:mm:ss",
        "yyyy/MM/dd HH:mm"
    )

    private val PATTERNS_DATE_ONLY = listOf("yyyy-MM-dd", "yyyy/MM/dd")

    /** true = dia primeiro (05/09 = 5 de Setembro). */
    fun detectDayFirst(samples: Iterable<String>): Boolean {
        var dayFirstEvidence = 0
        var monthFirstEvidence = 0
        for (raw in samples) {
            val match = NUMERIC_SLASH.find(raw.trim()) ?: continue
            val first = match.groupValues[1].toIntOrNull() ?: continue
            val second = match.groupValues[2].toIntOrNull() ?: continue
            if (first > 12 && second <= 12) dayFirstEvidence++
            if (second > 12 && first <= 12) monthFirstEvidence++
        }
        // Empate ou amostra inconclusiva: o formato portugues poe o dia primeiro.
        return monthFirstEvidence <= dayFirstEvidence
    }

    fun parse(raw: String?, dayFirst: Boolean): Instant? {
        val text = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null

        // Formatos com fuso explicito: valem por si, sem adivinhar nada.
        runCatching { return OffsetDateTime.parse(text).toInstant() }
        runCatching { return Instant.parse(text) }
        runCatching {
            return OffsetDateTime.parse(text, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss XX"))
                .toInstant()
        }

        val normalized = text.replace('T', ' ').substringBefore('+').trim()

        for (pattern in PATTERNS_TIME) {
            val parsed = tryLocalDateTime(normalized, pattern)
            if (parsed != null) return parsed.atZone(LISBOA).toInstant()
        }

        val slash = NUMERIC_SLASH.find(normalized)
        if (slash != null) {
            val a = slash.groupValues[1].toInt()
            val b = slash.groupValues[2].toInt()
            val year = expandYear(slash.groupValues[3].toInt())
            val day = if (dayFirst) a else b
            val month = if (dayFirst) b else a
            if (month in 1..12 && day in 1..31) {
                val time = normalized.substring(slash.value.length).trim()
                val date = runCatching { LocalDate.of(year, month, day) }.getOrNull() ?: return null
                val localTime = parseTimeOfDay(time)
                return date.atTime(localTime).atZone(LISBOA).toInstant()
            }
        }

        for (pattern in PATTERNS_DATE_ONLY) {
            val parsed = runCatching {
                LocalDate.parse(normalized, DateTimeFormatter.ofPattern(pattern))
            }.getOrNull()
            if (parsed != null) return parsed.atStartOfDay(LISBOA).toInstant()
        }
        return null
    }

    private fun tryLocalDateTime(text: String, pattern: String): LocalDateTime? = try {
        LocalDateTime.parse(text, DateTimeFormatter.ofPattern(pattern))
    } catch (_: DateTimeParseException) {
        null
    }

    private fun parseTimeOfDay(raw: String): java.time.LocalTime {
        if (raw.isEmpty()) return java.time.LocalTime.MIDNIGHT
        val cleaned = raw.uppercase().replace(".", "")
        val pm = cleaned.contains("PM")
        val am = cleaned.contains("AM")
        val digits = Regex("(\\d{1,2}):(\\d{2})(?::(\\d{2}))?").find(cleaned)
            ?: return java.time.LocalTime.MIDNIGHT
        var hour = digits.groupValues[1].toInt()
        val minute = digits.groupValues[2].toInt()
        val second = digits.groupValues.getOrNull(3)?.toIntOrNull() ?: 0
        if (pm && hour < 12) hour += 12
        if (am && hour == 12) hour = 0
        if (hour > 23 || minute > 59 || second > 59) return java.time.LocalTime.MIDNIGHT
        return java.time.LocalTime.of(hour, minute, second)
    }

    private fun expandYear(year: Int): Int = when {
        year >= 1000 -> year
        year >= 70 -> 1900 + year
        else -> 2000 + year
    }
}
