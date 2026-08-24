package pt.rodado.core.calc

import pt.rodado.core.model.ChargeSession
import pt.rodado.core.model.CostSettings
import pt.rodado.core.model.Expense
import pt.rodado.core.model.ExpenseKind
import pt.rodado.core.model.HourBlock
import pt.rodado.core.model.LISBOA
import pt.rodado.core.model.Shift
import pt.rodado.core.model.Trip
import pt.rodado.core.money.Money
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/** Tudo o que aconteceu num periodo, ja associado (ou nao) a turnos. */
data class Ledger(
    val shifts: List<Shift> = emptyList(),
    val trips: List<Trip> = emptyList(),
    val charges: List<ChargeSession> = emptyList(),
    val expenses: List<Expense> = emptyList()
)

object Calculator {

    /**
     * Liga cada viagem, carregamento e despesa ao turno em que caiu.
     *
     * Sem isto os cortes por bloco horario e por zona ficam vazios: as viagens
     * chegam do CSV da plataforma sem saber nada dos teus turnos.
     */
    fun attribute(ledger: Ledger): Ledger {
        val shifts = ledger.shifts.sortedBy { it.start }

        fun shiftAt(moment: java.time.Instant): String? = shifts.firstOrNull { shift ->
            val end = shift.end
            !moment.isBefore(shift.start) && (end == null || !moment.isAfter(end))
        }?.id

        return ledger.copy(
            trips = ledger.trips.map { trip ->
                if (trip.shiftId != null) trip else trip.copy(shiftId = shiftAt(trip.start))
            },
            expenses = ledger.expenses.map { expense ->
                if (expense.shiftId != null) expense else expense.copy(shiftId = shiftAt(expense.at))
            }
        )
    }

    /**
     * Totais de um periodo inteiro.
     *
     * [fixedCosts] so deve vir preenchido em resumos mensais — abater a
     * prestacao e o seguro a um turno isolado nao quer dizer nada.
     */
    fun totals(
        ledger: Ledger,
        settings: CostSettings,
        fixedCosts: Money = Money.ZERO
    ): Totals {
        val kmByShift = ledger.shifts.mapNotNull { it.totalKm }
        val totalKm = kmByShift.sum()
        val missingOdometer = ledger.shifts.count { it.totalKm == null }

        val tolls = ledger.expenses
            .filter { it.kind == ExpenseKind.PORTAGEM }
            .fold(Money.ZERO) { acc, expense -> acc + expense.amount }
        val others = ledger.expenses
            .filter { it.kind != ExpenseKind.PORTAGEM }
            .fold(Money.ZERO) { acc, expense -> acc + expense.amount }

        return Totals(
            shiftCount = ledger.shifts.size,
            tripCount = ledger.trips.size,
            hours = ledger.shifts.sumOf { it.hours ?: 0.0 },
            totalKm = totalKm,
            paidKm = ledger.trips.sumOf { it.distanceKm },
            grossFares = ledger.trips.fold(Money.ZERO) { acc, trip -> acc + trip.gross },
            commission = ledger.trips.fold(Money.ZERO) { acc, trip -> acc + trip.commission },
            tips = ledger.trips.fold(Money.ZERO) { acc, trip -> acc + trip.tips },
            platformPayout = ledger.trips.fold(Money.ZERO) { acc, trip -> acc + trip.payout },
            energyCost = ledger.charges.fold(Money.ZERO) { acc, charge ->
                acc + charge.cost(settings.homePricePerKwh)
            },
            energyKwh = ledger.charges.sumOf { it.energyKwh },
            maintenanceCost = Money.ofEuros(settings.maintenancePerKm * totalKm),
            tolls = tolls,
            otherCosts = others,
            fixedCosts = fixedCosts,
            shiftsMissingOdometer = missingOdometer
        )
    }

    /** Os numeros de cada turno, para as listagens e para os cortes por bloco e zona. */
    fun perShift(ledger: Ledger, settings: CostSettings): List<Pair<Shift, Totals>> {
        val attributed = attribute(ledger)
        val tripsByShift = attributed.trips.groupBy { it.shiftId }
        val expensesByShift = attributed.expenses.groupBy { it.shiftId }
        val chargesByShift = attributed.charges.groupBy { charge ->
            attributed.shifts.firstOrNull { shift ->
                val end = shift.end
                !charge.start.isBefore(shift.start) && (end == null || !charge.start.isAfter(end))
            }?.id
        }

        return attributed.shifts.map { shift ->
            val slice = Ledger(
                shifts = listOf(shift),
                trips = tripsByShift[shift.id].orEmpty(),
                charges = chargesByShift[shift.id].orEmpty(),
                expenses = expensesByShift[shift.id].orEmpty()
            )
            shift to totals(slice, settings)
        }
    }

    fun byBlock(ledger: Ledger, settings: CostSettings): Map<HourBlock, Totals> =
        perShift(ledger, settings)
            .groupBy({ it.first.block }, { it.second })
            .mapValues { (_, list) -> list.sum() }

    fun byWeekday(ledger: Ledger, settings: CostSettings): Map<DayOfWeek, Totals> =
        perShift(ledger, settings)
            .groupBy({ it.first.localDate.dayOfWeek }, { it.second })
            .mapValues { (_, list) -> list.sum() }

    fun byZone(ledger: Ledger, settings: CostSettings): Map<String, Totals> =
        perShift(ledger, settings)
            .filter { it.first.zone != null }
            .groupBy({ it.first.zone!! }, { it.second })
            .mapValues { (_, list) -> list.sum() }

    fun byDay(ledger: Ledger, settings: CostSettings): Map<LocalDate, Totals> =
        perShift(ledger, settings)
            .groupBy({ it.first.localDate }, { it.second })
            .mapValues { (_, list) -> list.sum() }

    /** Resumo mensal, ja com os custos fixos abatidos em cada mes trabalhado. */
    fun byMonth(ledger: Ledger, settings: CostSettings): Map<YearMonth, Totals> {
        val attributed = attribute(ledger)
        val months = buildSet {
            attributed.shifts.forEach { add(YearMonth.from(it.start.atZone(LISBOA))) }
            attributed.trips.forEach { add(YearMonth.from(it.start.atZone(LISBOA))) }
            attributed.charges.forEach { add(YearMonth.from(it.start.atZone(LISBOA))) }
            attributed.expenses.forEach { add(YearMonth.from(it.at.atZone(LISBOA))) }
        }
        return months.sorted().associateWith { month ->
            val slice = Ledger(
                shifts = attributed.shifts.filter { YearMonth.from(it.start.atZone(LISBOA)) == month },
                trips = attributed.trips.filter { YearMonth.from(it.start.atZone(LISBOA)) == month },
                charges = attributed.charges.filter { YearMonth.from(it.start.atZone(LISBOA)) == month },
                expenses = attributed.expenses.filter { YearMonth.from(it.at.atZone(LISBOA)) == month }
            )
            // Os custos fixos so pesam nos meses em que houve trabalho.
            val fixed = if (slice.shifts.isEmpty()) Money.ZERO else settings.monthlyFixedTotal
            totals(slice, settings, fixed)
        }
    }
}
