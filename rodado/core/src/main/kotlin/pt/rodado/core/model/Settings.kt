package pt.rodado.core.model

import pt.rodado.core.money.Money

/** Um custo fixo, mensal ou anual. */
data class FixedCost(
    val label: String,
    val amount: Money,
    val period: Period
) {
    enum class Period { MENSAL, ANUAL }

    /** Quanto este custo pesa por mes. */
    val monthly: Money
        get() = when (period) {
            Period.MENSAL -> amount
            Period.ANUAL -> amount.divide(12)
        }
}

/**
 * Os pressupostos de custo. Os valores por omissao sao os que ficaram acertados
 * na folha de calculo para o Tesla.
 */
data class CostSettings(
    /** So usada quando o extrato nao traz a comissao discriminada. */
    val fallbackCommissionRate: Double = 0.25,
    /**
     * Manutencao e pneus por km, em euros.
     *
     * Em euros e nao em centimos inteiros de proposito: a diferenca entre 0,03 e
     * 0,035 €/km sao 50 € por cada 10.000 km, e arredondar a taxa ao centimo
     * perdia isso.
     */
    val maintenancePerKm: Double = 0.03,
    /** Preco da electricidade em casa (€/kWh), para carregamentos sem custo reportado. */
    val homePricePerKwh: Double = 0.15,
    val fixedCosts: List<FixedCost> = listOf(
        FixedCost("Prestação do carro", Money.ofEuros(390.0), FixedCost.Period.MENSAL),
        FixedCost("Seguro", Money.ofEuros(970.0), FixedCost.Period.ANUAL)
    )
) {
    val monthlyFixedTotal: Money get() = Money(fixedCosts.sumOf { it.monthly.cents })
}
