package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.money.DecimalStyle
import pt.rodado.core.money.Money
import pt.rodado.core.money.parseDecimal
import pt.rodado.core.money.parseMoney
import kotlin.test.assertEquals
import kotlin.test.assertNull

class NumberParsingTest {

    @Test
    fun `deduz virgula decimal num extrato portugues`() {
        val style = DecimalStyle.detect(listOf("12,50", "8,00", "1.234,56", "0,75"))
        assertEquals(DecimalStyle.COMMA, style)
        assertEquals(Money.ofEuros(1234.56), parseMoney("1.234,56 €", style))
        assertEquals(Money.ofEuros(12.5), parseMoney("12,50", style))
    }

    @Test
    fun `deduz ponto decimal num extrato ingles`() {
        val style = DecimalStyle.detect(listOf("12.50", "8.00", "1,234.56"))
        assertEquals(DecimalStyle.DOT, style)
        assertEquals(Money.ofEuros(1234.56), parseMoney("1,234.56", style))
    }

    @Test
    fun `o estilo do ficheiro decide os casos ambiguos`() {
        // "1,234" sozinho e ambiguo; e o resto do ficheiro que desempata.
        val portuguese = DecimalStyle.detect(listOf("1,234", "9,99"))
        assertEquals(DecimalStyle.COMMA, portuguese)
        assertEquals(Money.ofEuros(1.23), parseMoney("1,234", portuguese))

        val english = DecimalStyle.detect(listOf("1,234", "9.99"))
        assertEquals(DecimalStyle.DOT, english)
        assertEquals(Money.ofEuros(1234.0), parseMoney("1,234", english))
    }

    @Test
    fun `le valores negativos e entre parentesis`() {
        val style = DecimalStyle.COMMA
        assertEquals(Money.ofEuros(-4.2), parseMoney("-4,20", style))
        assertEquals(Money.ofEuros(-4.2), parseMoney("(4,20)", style))
        assertEquals(Money.ofEuros(-4.2), parseMoney("−4,20 €", style))
    }

    @Test
    fun `celula vazia nao vale zero`() {
        assertNull(parseDecimal("", DecimalStyle.COMMA))
        assertNull(parseDecimal("   ", DecimalStyle.COMMA))
        assertNull(parseDecimal("n d", DecimalStyle.COMMA))
        assertNull(parseDecimal(null, DecimalStyle.COMMA))
    }
}

class UserInputTest {

    @Test
    fun `aceita virgula ou ponto do teclado`() {
        assertEquals(0.03, pt.rodado.core.money.parseUserDecimal("0,03"))
        assertEquals(0.03, pt.rodado.core.money.parseUserDecimal("0.03"))
        assertEquals(0.035, pt.rodado.core.money.parseUserDecimal("0,035"))
        assertEquals(390.0, pt.rodado.core.money.parseUserDecimal("390"))
        assertEquals(Money.ofEuros(390.0), pt.rodado.core.money.parseUserMoney("390,00 €"))
    }

    @Test
    fun `campo vazio nao vira zero`() {
        assertNull(pt.rodado.core.money.parseUserDecimal(""))
        assertNull(pt.rodado.core.money.parseUserDecimal("abc"))
    }
}
