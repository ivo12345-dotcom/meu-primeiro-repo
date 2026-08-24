package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.csv.DateParsing
import pt.rodado.core.model.LISBOA
import java.time.LocalDateTime
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DateParsingTest {

    private fun lisbon(text: String) = LocalDateTime.parse(text).atZone(LISBOA).toInstant()

    @Test
    fun `le o formato ISO com fuso`() {
        assertEquals(
            java.time.Instant.parse("2026-09-05T20:30:00Z"),
            DateParsing.parse("2026-09-05T20:30:00Z", dayFirst = true)
        )
    }

    @Test
    fun `le data e hora sem fuso como hora de Lisboa`() {
        assertEquals(
            lisbon("2026-09-05T21:30:00"),
            DateParsing.parse("2026-09-05 21:30:00", dayFirst = true)
        )
    }

    @Test
    fun `le o formato portugues com dia primeiro`() {
        assertEquals(
            lisbon("2026-09-05T21:30:00"),
            DateParsing.parse("05/09/2026 21:30", dayFirst = true)
        )
    }

    @Test
    fun `le o formato americano com mes primeiro`() {
        assertEquals(
            lisbon("2026-05-09T21:30:00"),
            DateParsing.parse("05/09/2026 21:30", dayFirst = false)
        )
    }

    @Test
    fun `deduz a ordem a partir do ficheiro`() {
        assertTrue(DateParsing.detectDayFirst(listOf("05/09/2026", "23/09/2026")))
        assertTrue(!DateParsing.detectDayFirst(listOf("09/05/2026", "09/23/2026")))
        // Sem pistas, assume o formato portugues.
        assertTrue(DateParsing.detectDayFirst(listOf("05/09/2026", "01/02/2026")))
    }

    @Test
    fun `le hora com AM e PM`() {
        assertEquals(
            lisbon("2026-09-05T21:30:00"),
            DateParsing.parse("05/09/2026 9:30 PM", dayFirst = true)
        )
        assertEquals(
            lisbon("2026-09-05T00:15:00"),
            DateParsing.parse("05/09/2026 12:15 AM", dayFirst = true)
        )
    }

    @Test
    fun `data sozinha comeca a meia noite`() {
        assertEquals(
            lisbon("2026-09-05T00:00:00"),
            DateParsing.parse("2026-09-05", dayFirst = true)
        )
    }

    @Test
    fun `texto que nao e data devolve nulo`() {
        assertNull(DateParsing.parse("sem data", dayFirst = true))
        assertNull(DateParsing.parse("", dayFirst = true))
        assertNull(DateParsing.parse(null, dayFirst = true))
    }
}
