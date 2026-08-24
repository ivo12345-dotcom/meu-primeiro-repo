package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.calc.Calculator
import pt.rodado.core.calc.Ledger
import pt.rodado.core.model.ChargeSession
import pt.rodado.core.model.CostSettings
import pt.rodado.core.model.Expense
import pt.rodado.core.model.ExpenseKind
import pt.rodado.core.model.FixedCost
import pt.rodado.core.model.HourBlock
import pt.rodado.core.model.LISBOA
import pt.rodado.core.model.Platform
import pt.rodado.core.model.Shift
import pt.rodado.core.model.Trip
import pt.rodado.core.money.Money
import java.time.LocalDateTime
import java.time.YearMonth
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CalculatorTest {

    private fun at(text: String) = LocalDateTime.parse(text).atZone(LISBOA).toInstant()

    private val settings = CostSettings(
        maintenancePerKm = 0.03,
        homePricePerKwh = 0.15,
        fixedCosts = listOf(
            FixedCost("Prestação do carro", Money.ofEuros(390.0), FixedCost.Period.MENSAL),
            FixedCost("Seguro", Money.ofEuros(970.0), FixedCost.Period.ANUAL)
        )
    )

    /**
     * O turno de exemplo da folha de calculo: sabado 21h30-04h, 168,40 € de
     * facturacao, 25% de comissao, 6,50 € de gorjetas, 122 km, 11,80 € de
     * carregamento, 3,20 € de portagens e 2,00 € de extras.
     *
     * A folha da 112,14 € de liquido e 17,25 €/hora. Se a app divergir disto, uma
     * das duas esta errada — e sao os dois numeros que decidem se vale a pena
     * trabalhar naquele bloco.
     */
    private fun turnoDaFolha(): Ledger {
        val start = at("2026-09-05T21:30:00")
        val end = at("2026-09-06T04:00:00")
        return Ledger(
            shifts = listOf(
                Shift(
                    id = "t1",
                    start = start,
                    end = end,
                    odometerStartKm = 40_000.0,
                    odometerEndKm = 40_122.0,
                    zone = "Cais do Sodré / Bairro Alto"
                )
            ),
            trips = List(14) { index ->
                Trip(
                    id = "v$index",
                    platform = Platform.UBER,
                    start = start.plusSeconds(600L * index),
                    distanceKm = 6.0,
                    gross = Money.ofEuros(168.40).split(14)[index],
                    commission = Money.ofEuros(42.10).split(14)[index],
                    tips = Money.ofEuros(6.50).split(14)[index]
                )
            },
            charges = listOf(
                ChargeSession(
                    id = "c1",
                    start = start.plusSeconds(3600),
                    energyKwh = 32.0,
                    reportedCost = Money.ofEuros(11.80),
                    isSupercharger = true
                )
            ),
            expenses = listOf(
                Expense("d1", start, ExpenseKind.PORTAGEM, Money.ofEuros(3.20)),
                Expense("d2", start, ExpenseKind.OUTRO, Money.ofEuros(2.00))
            )
        )
    }

    @Test
    fun `bate certo com a folha de calculo`() {
        val totals = Calculator.totals(turnoDaFolha(), settings)

        assertEquals(6.5, totals.hours, 0.0001)
        assertEquals(122.0, totals.totalKm, 0.0001)
        assertEquals(Money.ofEuros(168.40), totals.grossFares)
        assertEquals(Money.ofEuros(42.10), totals.commission)
        assertEquals(Money.ofEuros(132.80), totals.platformPayout)
        assertEquals(Money.ofEuros(11.80), totals.energyCost)
        assertEquals(Money.ofEuros(3.66), totals.maintenanceCost)
        assertEquals(Money.ofEuros(20.66), totals.variableCosts)
        assertEquals(Money.ofEuros(112.14), totals.net)
        assertEquals(Money.ofEuros(17.25), totals.netPerHour)
        assertEquals(14, totals.tripCount)
        assertEquals(2.1538, totals.tripsPerHour!!, 0.0001)
    }

    @Test
    fun `separa os km com cliente dos km vazios`() {
        val totals = Calculator.totals(turnoDaFolha(), settings)
        assertEquals(84.0, totals.paidKm, 0.0001)   // 14 viagens x 6 km
        assertEquals(38.0, totals.deadKm, 0.0001)
        assertEquals(0.6885, totals.paidKmRatio!!, 0.0001)
    }

    @Test
    fun `energia por cem km sai dos carregamentos reais`() {
        val totals = Calculator.totals(turnoDaFolha(), settings)
        assertEquals(Money.ofEuros(9.67), totals.energyPer100Km)
        assertEquals(Money.ofEuros(0.37), totals.energyPerKwh)
    }

    @Test
    fun `carregamento em casa e estimado ao preco definido`() {
        val casa = ChargeSession(id = "c2", start = at("2026-09-06T09:00:00"), energyKwh = 40.0)
        assertEquals(Money.ofEuros(6.0), casa.cost(settings.homePricePerKwh))
    }

    @Test
    fun `turno sem odometro e assinalado em vez de contar zero km`() {
        val ledger = turnoDaFolha().let { base ->
            base.copy(shifts = base.shifts.map { it.copy(odometerEndKm = null) })
        }
        val totals = Calculator.totals(ledger, settings)
        assertEquals(0.0, totals.totalKm)
        assertEquals(1, totals.shiftsMissingOdometer)
        assertTrue(!totals.isReliable)
        assertNull(totals.paidKmRatio)
    }

    @Test
    fun `as viagens sao ligadas ao turno em que caem`() {
        val ledger = Calculator.attribute(turnoDaFolha())
        assertTrue(ledger.trips.all { it.shiftId == "t1" })
    }

    @Test
    fun `viagem fora de qualquer turno continua a contar no total do periodo`() {
        val base = turnoDaFolha()
        val solta = Trip(
            id = "solta",
            platform = Platform.BOLT,
            start = at("2026-09-08T14:00:00"),
            distanceKm = 5.0,
            gross = Money.ofEuros(10.0),
            commission = Money.ofEuros(2.5)
        )
        val totals = Calculator.totals(base.copy(trips = base.trips + solta), settings)
        assertEquals(15, totals.tripCount)
        assertEquals(Money.ofEuros(178.40), totals.grossFares)
    }

    @Test
    fun `agrupa por bloco horario e por zona`() {
        val ledger = turnoDaFolha()
        val porBloco = Calculator.byBlock(ledger, settings)
        assertEquals(setOf(HourBlock.NOITE), porBloco.keys)
        assertEquals(Money.ofEuros(112.14), porBloco.getValue(HourBlock.NOITE).net)

        val porZona = Calculator.byZone(ledger, settings)
        assertEquals(Money.ofEuros(112.14), porZona.getValue("Cais do Sodré / Bairro Alto").net)
    }

    @Test
    fun `custos fixos so pesam nos meses trabalhados`() {
        val porMes = Calculator.byMonth(turnoDaFolha(), settings)
        val setembro = porMes.getValue(YearMonth.of(2026, 9))

        assertEquals(Money.ofEuros(470.83), setembro.fixedCosts)
        assertEquals(Money.ofEuros(112.14), setembro.net)
        assertEquals(Money.ofEuros(112.14 - 470.83), setembro.result)
        assertNotNull(setembro.resultPerHour)
    }

    @Test
    fun `um mes sem turnos nao debita a prestacao`() {
        val soDespesa = Ledger(
            expenses = listOf(
                Expense("x", at("2026-10-10T10:00:00"), ExpenseKind.LAVAGEM, Money.ofEuros(15.0))
            )
        )
        val outubro = Calculator.byMonth(soDespesa, settings).getValue(YearMonth.of(2026, 10))
        assertEquals(Money.ZERO, outubro.fixedCosts)
        assertEquals(Money.ofEuros(-15.0), outubro.result)
    }

    @Test
    fun `custos fixos mensais somam prestacao mais seguro dividido por doze`() {
        assertEquals(Money.ofEuros(470.83), settings.monthlyFixedTotal)
    }

    @Test
    fun `os racios do total nao sao a media dos racios dos turnos`() {
        val curto = Shift("a", at("2026-09-10T18:00:00"), at("2026-09-10T20:00:00"), 0.0, 40.0)
        val longo = Shift("b", at("2026-09-11T18:00:00"), at("2026-09-12T04:00:00"), 100.0, 300.0)
        val ledger = Ledger(
            shifts = listOf(curto, longo),
            trips = listOf(
                Trip("t1", Platform.UBER, at("2026-09-10T18:30:00"), distanceKm = 20.0, gross = Money.ofEuros(40.0)),
                Trip("t2", Platform.UBER, at("2026-09-11T19:00:00"), distanceKm = 120.0, gross = Money.ofEuros(200.0))
            )
        )
        val totals = Calculator.totals(ledger, settings)
        assertEquals(12.0, totals.hours, 0.0001)
        // 240 € menos 7,20 € de manutencao sobre 240 km, a dividir por 12 horas.
        assertEquals(Money.ofEuros(19.40), totals.netPerHour)
    }
}
