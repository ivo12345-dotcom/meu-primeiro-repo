package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.csv.ReportDetector
import pt.rodado.core.csv.ReportKind
import kotlin.test.assertEquals

class ReportDetectorTest {

    @Test
    fun `reconhece o relatorio de frota da Uber`() {
        val csv = requireNotNull(javaClass.getResourceAsStream("/uber_ganhos_por_motorista.csv"))
            .bufferedReader().use { it.readText() }
        assertEquals(ReportKind.FROTA, ReportDetector.detect(csv))
    }

    @Test
    fun `reconhece um relatorio de viagens`() {
        val csv = """
            ID da viagem;Data e hora;Distância (km);Valor da viagem
            abc;05/09/2026 21:45;7,4;14,80
        """.trimIndent()
        assertEquals(ReportKind.VIAGENS, ReportDetector.detect(csv))
    }

    @Test
    fun `um ficheiro que nao e nem uma coisa nem outra fica por identificar`() {
        assertEquals(ReportKind.DESCONHECIDO, ReportDetector.detect("a;b\n1;2\n"))
    }
}
