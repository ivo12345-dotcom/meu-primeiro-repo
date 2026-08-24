package pt.rodado.core.calc

import pt.rodado.core.money.Money
import pt.rodado.core.money.per
import kotlin.math.roundToLong

/**
 * Os numeros de um periodo — um turno, um dia, uma semana, um mes, ou um corte
 * por bloco horario ou por zona.
 *
 * So os acumuladores sao guardados. Tudo o que e racio (euros por hora, euros
 * por km, percentagem de km pagos) e calculado a partir deles, porque somar
 * medias de turnos diferentes da um numero errado: um turno de 10 horas e um de
 * 2 nao pesam o mesmo na media.
 */
data class Totals(
    val shiftCount: Int = 0,
    val tripCount: Int = 0,
    val hours: Double = 0.0,
    val totalKm: Double = 0.0,
    val paidKm: Double = 0.0,
    val grossFares: Money = Money.ZERO,
    val commission: Money = Money.ZERO,
    val tips: Money = Money.ZERO,
    /** O que as plataformas te pagam, ja liquido de comissao. */
    val platformPayout: Money = Money.ZERO,
    val energyCost: Money = Money.ZERO,
    val energyKwh: Double = 0.0,
    val maintenanceCost: Money = Money.ZERO,
    val tolls: Money = Money.ZERO,
    val otherCosts: Money = Money.ZERO,
    val fixedCosts: Money = Money.ZERO,
    /** Turnos sem leitura de odometro: os km e a manutencao desses ficam de fora. */
    val shiftsMissingOdometer: Int = 0
) {
    val variableCosts: Money get() = energyCost + maintenanceCost + tolls + otherCosts

    /** Liquido antes de custos fixos. */
    val net: Money get() = platformPayout - variableCosts

    /** Resultado depois de abater os custos fixos do periodo. */
    val result: Money get() = net - fixedCosts

    val deadKm: Double get() = (totalKm - paidKm).coerceAtLeast(0.0)

    /** Fracao dos km que foram feitos com cliente a bordo. */
    val paidKmRatio: Double? get() = if (totalKm > 0.0) (paidKm / totalKm).coerceIn(0.0, 1.0) else null

    val netPerHour: Money? get() = net.per(hours)
    val resultPerHour: Money? get() = result.per(hours)
    val netPerKm: Money? get() = net.per(totalKm)
    val tripsPerHour: Double? get() = if (hours > 0.0) tripCount / hours else null

    val energyPer100Km: Money?
        get() = if (totalKm > 0.0) Money((energyCost.cents / totalKm * 100).roundToLong()) else null

    val energyPerKwh: Money?
        get() = if (energyKwh > 0.0) Money((energyCost.cents / energyKwh).roundToLong()) else null

    /** Os dados estao completos ao ponto de o liquido ser de confianca? */
    val isReliable: Boolean get() = shiftsMissingOdometer == 0

    operator fun plus(other: Totals) = Totals(
        shiftCount = shiftCount + other.shiftCount,
        tripCount = tripCount + other.tripCount,
        hours = hours + other.hours,
        totalKm = totalKm + other.totalKm,
        paidKm = paidKm + other.paidKm,
        grossFares = grossFares + other.grossFares,
        commission = commission + other.commission,
        tips = tips + other.tips,
        platformPayout = platformPayout + other.platformPayout,
        energyCost = energyCost + other.energyCost,
        energyKwh = energyKwh + other.energyKwh,
        maintenanceCost = maintenanceCost + other.maintenanceCost,
        tolls = tolls + other.tolls,
        otherCosts = otherCosts + other.otherCosts,
        fixedCosts = fixedCosts + other.fixedCosts,
        shiftsMissingOdometer = shiftsMissingOdometer + other.shiftsMissingOdometer
    )

    companion object {
        val EMPTY = Totals()
    }
}

fun Iterable<Totals>.sum(): Totals = fold(Totals.EMPTY) { acc, item -> acc + item }
