package pt.rodado.core.money

import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Valor monetario guardado em centimos inteiros.
 *
 * Somar centenas de viagens em virgula flutuante acumula erro suficiente para o
 * total do mes nao bater certo com a soma das linhas. Em centimos inteiros isso
 * nao acontece.
 */
@JvmInline
value class Money(val cents: Long) : Comparable<Money> {

    val euros: Double get() = cents / 100.0

    operator fun plus(other: Money) = Money(cents + other.cents)
    operator fun minus(other: Money) = Money(cents - other.cents)
    operator fun times(factor: Double) = Money((cents * factor).roundToLong())
    operator fun unaryMinus() = Money(-cents)

    override fun compareTo(other: Money): Int = cents.compareTo(other.cents)

    /** Divisao com arredondamento a metade para cima, em valor absoluto. */
    fun divide(divisor: Int): Money {
        require(divisor != 0) { "divisao por zero" }
        return Money((cents.toDouble() / divisor).roundToLong())
    }

    /** Rateio exacto por [parts] parcelas: a soma das parcelas e sempre igual ao total. */
    fun split(parts: Int): List<Money> {
        require(parts > 0) { "numero de parcelas tem de ser positivo" }
        val base = cents / parts
        val remainder = (abs(cents) % parts).toInt()
        val sign = if (cents < 0) -1L else 1L
        return List(parts) { index -> Money(base + if (index < remainder) sign else 0L) }
    }

    /** Formato portugues: 1.234,56 € */
    fun format(withSymbol: Boolean = true): String {
        val negative = cents < 0
        val absolute = abs(cents)
        val whole = absolute / 100
        val fraction = absolute % 100
        val groupedWhole = whole.toString()
            .reversed()
            .chunked(3)
            .joinToString(".")
            .reversed()
        val body = "$groupedWhole,${fraction.toString().padStart(2, '0')}"
        val signed = if (negative) "-$body" else body
        return if (withSymbol) "$signed €" else signed
    }

    override fun toString(): String = format()

    companion object {
        val ZERO = Money(0)

        fun ofEuros(value: Double) = Money((value * 100).roundToLong())
        fun ofCents(value: Long) = Money(value)
    }
}

fun Iterable<Money>.sum(): Money = Money(sumOf { it.cents })

fun <T> Iterable<T>.sumOfMoney(selector: (T) -> Money): Money =
    Money(sumOf { selector(it).cents })

/** Divisao segura entre dois valores, devolvendo null quando o divisor e zero. */
fun Money.per(divisor: Double): Money? =
    if (divisor == 0.0 || divisor.isNaN()) null else Money((cents / divisor).roundToLong())
