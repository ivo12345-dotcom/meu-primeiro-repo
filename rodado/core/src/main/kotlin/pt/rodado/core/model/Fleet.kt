package pt.rodado.core.model

import pt.rodado.core.money.Money
import java.time.LocalDate

/** Um motorista da frota. */
data class Driver(
    val id: String,
    val name: String,
    val platform: Platform
)

/**
 * O que um motorista rendeu numa semana, tal como vem do relatorio de frota da
 * plataforma.
 *
 * Este relatorio e por motorista e por semana, nao viagem a viagem: nao traz
 * distancias nem horas de cada corrida. Da para saber quanto se ganhou e a que
 * ritmo, mas nao da para separar os km com cliente dos km vazios — isso so vem do
 * relatorio de viagens ou do odometro do carro.
 */
data class DriverWeek(
    val id: String,
    val platform: Platform,
    val driverId: String,
    val driverName: String,
    val weekStart: LocalDate,
    val weekEnd: LocalDate,
    val gross: Money,
    val commission: Money,
    val otherFees: Money = Money.ZERO,
    val tips: Money = Money.ZERO,
    val tolls: Money = Money.ZERO,
    val net: Money,
    val grossPerHour: Money? = null,
    val netPerHour: Money? = null,
    val carId: String? = null
) {
    /**
     * Horas ao servico, deduzidas.
     *
     * O relatorio nao traz as horas, mas traz os ganhos e os ganhos por hora — e
     * uma coisa sai da outra. E o unico sitio de onde se sabe quanto tempo o
     * motorista esteve ligado, e por isso o unico sitio de onde se percebe se
     * esteve a trabalhar ou so a ocupar o carro.
     */
    val hours: Double?
        get() {
            val rate = grossPerHour ?: return null
            if (rate.cents <= 0) return null
            return gross.cents.toDouble() / rate.cents
        }

    /** Fracao dos ganhos brutos que a plataforma reteve. */
    val commissionRate: Double?
        get() = if (gross.cents > 0) (commission.cents + otherFees.cents).toDouble() / gross.cents else null
}
