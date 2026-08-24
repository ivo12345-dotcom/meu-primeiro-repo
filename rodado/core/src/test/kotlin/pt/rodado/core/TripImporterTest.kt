package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.csv.DistanceUnit
import pt.rodado.core.csv.TripField
import pt.rodado.core.csv.TripImporter
import pt.rodado.core.model.Platform
import pt.rodado.core.money.Money
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TripImporterTest {

    private val uberPortugues = """
        ID da viagem;Data e hora;Distância (km);Valor da viagem;Taxa de serviço;Gorjetas;Portagens
        abc-1;05/09/2026 21:45;7,4;14,80;3,70;0,00;0,00
        abc-2;05/09/2026 22:20;12,1;22,50;5,63;2,00;1,85
    """.trimIndent()

    @Test
    fun `importa um extrato portugues`() {
        val preview = TripImporter.preview(uberPortugues, Platform.UBER)
        assertTrue(preview.isUsable, "faltam colunas: ${preview.missingRequired.map { it.label }}")
        assertEquals(DistanceUnit.KM, preview.distanceUnit)

        val result = TripImporter.apply(preview)
        assertEquals(2, result.trips.size)
        assertEquals(0, result.skippedRows)

        val first = result.trips.first()
        assertEquals("UBER:abc-1", first.id)
        assertEquals(7.4, first.distanceKm)
        assertEquals(Money.ofEuros(14.80), first.gross)
        assertEquals(Money.ofEuros(3.70), first.commission)
        // Sem coluna de liquido, o pagamento sai das parcelas.
        assertEquals(Money.ofEuros(11.10), first.payout)

        val second = result.trips[1]
        assertEquals(Money.ofEuros(22.50 - 5.63 + 2.00 + 1.85), second.payout)
    }

    @Test
    fun `usa o liquido do extrato quando ele existe`() {
        val csv = """
            Data;Valor da viagem;Taxa de serviço;Ganhos líquidos
            05/09/2026 21:45;14,80;3,70;11,09
        """.trimIndent()
        val result = TripImporter.apply(TripImporter.preview(csv, Platform.BOLT))
        // 11,09 e nao 11,10: o total da app tem de bater certo com o do extrato.
        assertEquals(Money.ofEuros(11.09), result.trips.single().payout)
    }

    @Test
    fun `converte milhas em quilometros`() {
        val csv = """
            Date,Trip distance (mi),Fare
            2026-09-05 21:45,10.0,14.80
        """.trimIndent()
        val preview = TripImporter.preview(csv, Platform.UBER)
        assertEquals(DistanceUnit.MILHAS, preview.distanceUnit)
        val trip = TripImporter.apply(preview).trips.single()
        assertEquals(16.09344, trip.distanceKm, 0.0001)
    }

    @Test
    fun `comissao negativa entra como custo positivo`() {
        val csv = """
            Data;Valor da viagem;Comissão
            05/09/2026 21:45;14,80;-3,70
        """.trimIndent()
        val trip = TripImporter.apply(TripImporter.preview(csv, Platform.UBER)).trips.single()
        assertEquals(Money.ofEuros(3.70), trip.commission)
        assertEquals(Money.ofEuros(11.10), trip.payout)
    }

    @Test
    fun `importar duas vezes gera os mesmos identificadores`() {
        val once = TripImporter.apply(TripImporter.preview(uberPortugues, Platform.UBER)).trips
        val twice = TripImporter.apply(TripImporter.preview(uberPortugues, Platform.UBER)).trips
        assertEquals(once.map { it.id }, twice.map { it.id })
    }

    @Test
    fun `avisa quando faltam distancias`() {
        val csv = """
            Data;Valor da viagem
            05/09/2026 21:45;14,80
        """.trimIndent()
        val result = TripImporter.apply(TripImporter.preview(csv, Platform.UBER))
        assertEquals(1, result.trips.size)
        assertTrue(result.warnings.any { it.contains("distância") })
    }

    @Test
    fun `linhas sem data sao ignoradas e contadas`() {
        val csv = """
            Data;Valor da viagem
            05/09/2026 21:45;14,80
            total da semana;14,80
        """.trimIndent()
        val result = TripImporter.apply(TripImporter.preview(csv, Platform.UBER))
        assertEquals(1, result.trips.size)
        assertEquals(1, result.skippedRows)
    }

    @Test
    fun `a coluna pode ser corrigida a mao`() {
        val csv = """
            Quando;Quanto;Outra coisa
            05/09/2026 21:45;14,80;99,00
        """.trimIndent()
        val preview = TripImporter.preview(csv, Platform.UBER)
        val corrected = preview
            .withMapping(TripField.DATE, 0)
            .withMapping(TripField.GROSS, 1)
        val result = TripImporter.apply(corrected)
        assertEquals(Money.ofEuros(14.80), result.trips.single().gross)
    }
}
