package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.csv.DriverWeekImporter
import pt.rodado.core.csv.PeriodFromFileName
import pt.rodado.core.model.Platform
import pt.rodado.core.money.Money
import pt.rodado.core.money.sumOfMoney
import java.time.LocalDate
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Corre sobre uma copia do relatorio real "Ganhos por motorista" da Uber, com a
 * estrutura toda preservada e os dados pessoais dos motoristas substituidos.
 */
class DriverWeekImporterTest {

    private val ficheiro = "Ganhos_por_motorista17_ago_202623_ago_2026Empresa_Lda.csv"

    private fun csv(): String = requireNotNull(
        javaClass.getResourceAsStream("/uber_ganhos_por_motorista.csv")
    ).bufferedReader().use { it.readText() }

    private fun importar() = DriverWeekImporter.apply(
        DriverWeekImporter.preview(csv(), Platform.UBER, ficheiro)
    )

    @Test
    fun `le o relatorio de frota da Uber`() {
        val preview = DriverWeekImporter.preview(csv(), Platform.UBER, ficheiro)
        assertTrue(preview.isUsable, "faltam: ${preview.missingRequired.map { it.label }}")
        assertEquals(29, preview.table.headers.size)

        val resultado = importar()
        assertEquals(7, resultado.weeks.size)
        assertEquals(0, resultado.skippedRows)
    }

    @Test
    fun `os totais batem certo com o relatorio`() {
        val semanas = importar().weeks
        assertEquals(Money.ofEuros(1413.74), semanas.sumOfMoney { it.gross })
        assertEquals(Money.ofEuros(311.67), semanas.sumOfMoney { it.commission })
        assertEquals(Money.ofEuros(1098.38), semanas.sumOfMoney { it.net })
        assertEquals(Money.ofEuros(6.50), semanas.sumOfMoney { it.tips })
        assertEquals(Money.ofEuros(23.40), semanas.sumOfMoney { it.tolls })
    }

    @Test
    fun `deduz as horas a partir dos ganhos por hora`() {
        val semanas = importar().weeks
        val primeiro = semanas.first { it.driverName == "Motorista Um" }
        // 468,67 € a 19,65 €/h dao 23,9 horas ao servico.
        assertEquals(23.85, primeiro.hours!!, 0.05)

        // O motorista com 83,67 € a 1,46 €/h esteve 57 horas ligado.
        val improdutivo = semanas.first { it.grossPerHour == Money.ofEuros(1.46) }
        assertTrue(improdutivo.hours!! > 55.0)
    }

    @Test
    fun `separa a comissao das outras taxas`() {
        val semanas = importar().weeks
        // Um dos motoristas tem 70,64 € de taxas para 68,18 € de comissao.
        val comExtras = semanas.first { it.otherFees.cents > 0 }
        assertEquals(Money.ofEuros(70.64 - 68.18), comExtras.otherFees)
        assertNotNull(comExtras.commissionRate)
    }

    @Test
    fun `apanha o periodo no nome do ficheiro`() {
        val periodo = PeriodFromFileName.parse(ficheiro)
        assertEquals(LocalDate.of(2026, 8, 17) to LocalDate.of(2026, 8, 23), periodo)
    }

    @Test
    fun `nome sem datas nao inventa periodo`() {
        assertNull(PeriodFromFileName.parse("relatorio.csv"))
    }

    @Test
    fun `identificadores repetem-se entre importacoes da mesma semana`() {
        val uma = importar().weeks.map { it.id }
        val outra = importar().weeks.map { it.id }
        assertEquals(uma, outra)
        assertTrue(uma.all { it.contains("2026-08-17") })
    }
}
