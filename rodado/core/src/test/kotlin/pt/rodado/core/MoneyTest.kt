package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.money.Money
import pt.rodado.core.money.sum
import kotlin.test.assertEquals

class MoneyTest {

    @Test
    fun `formata a portuguesa`() {
        assertEquals("1.234,56 €", Money.ofEuros(1234.56).format())
        assertEquals("0,00 €", Money.ZERO.format())
        assertEquals("-12,05 €", Money.ofEuros(-12.05).format())
        assertEquals("970,00 €", Money.ofEuros(970.0).format())
        assertEquals("1.234.567,89 €", Money.ofEuros(1234567.89).format())
        assertEquals("80,83", Money.ofEuros(970.0).divide(12).format(withSymbol = false))
    }

    @Test
    fun `somar muitas parcelas pequenas nao acumula erro`() {
        val parcels = List(1000) { Money.ofEuros(0.07) }
        assertEquals(Money.ofEuros(70.0), parcels.sum())
    }

    @Test
    fun `rateio devolve sempre o total exacto`() {
        val split = Money.ofEuros(100.0).split(3)
        assertEquals(3, split.size)
        assertEquals(Money.ofEuros(100.0), split.sum())
        assertEquals(listOf(3334L, 3333L, 3333L), split.map { it.cents })
    }

    @Test
    fun `rateio de valor negativo mantem o sinal`() {
        val split = Money.ofEuros(-10.0).split(3)
        assertEquals(Money.ofEuros(-10.0), split.sum())
    }
}
