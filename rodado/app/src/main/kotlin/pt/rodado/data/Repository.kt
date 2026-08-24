package pt.rodado.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import pt.rodado.core.calc.Ledger
import pt.rodado.core.model.ChargeSession
import pt.rodado.core.model.Expense
import pt.rodado.core.model.ExpenseKind
import pt.rodado.core.model.Shift
import pt.rodado.core.model.Trip
import pt.rodado.core.money.Money
import java.time.Instant
import java.util.UUID

class Repository(
    private val dao: RodadoDao,
    val settings: SettingsStore
) {

    val ledger: Flow<Ledger> = combine(
        dao.shifts(),
        dao.trips(),
        dao.charges(),
        dao.expenses()
    ) { shifts, trips, charges, expenses ->
        Ledger(
            shifts = shifts.map { it.toDomain() },
            trips = trips.map { it.toDomain() },
            charges = charges.map { it.toDomain() },
            expenses = expenses.map { it.toDomain() }
        )
    }

    val openShift: Flow<ShiftEntity?> = dao.openShift()

    suspend fun startShift(odometerKm: Double?, zone: String?): String {
        val id = UUID.randomUUID().toString()
        dao.upsertShift(
            ShiftEntity(
                id = id,
                startEpoch = Instant.now().epochSecond,
                endEpoch = null,
                odometerStartKm = odometerKm ?: dao.latestOdometer()?.km,
                odometerEndKm = null,
                zone = zone,
                note = null
            )
        )
        return id
    }

    suspend fun endShift(id: String, odometerKm: Double?, note: String?) {
        val current = dao.shift(id) ?: return
        val end = Instant.now()
        dao.upsertShift(
            current.copy(
                endEpoch = end.epochSecond,
                odometerEndKm = odometerKm ?: dao.latestOdometer()?.km ?: current.odometerEndKm,
                note = note ?: current.note
            )
        )
        linkTripsTo(current.copy(endEpoch = end.epochSecond))
    }

    suspend fun saveShift(shift: Shift) {
        dao.upsertShift(ShiftEntity.from(shift))
        dao.shift(shift.id)?.let { linkTripsTo(it) }
    }

    suspend fun deleteShift(id: String) = dao.deleteShift(id)

    /**
     * Guarda as viagens importadas e devolve quantas eram novas.
     *
     * A base ignora as que ja existiam, para que reimportar o extrato da mesma
     * semana — coisa que acontece — nao duplique os ganhos.
     */
    suspend fun importTrips(trips: List<Trip>): Int {
        if (trips.isEmpty()) return 0
        val inserted = dao.insertTrips(trips.map { TripEntity.from(it) })
        val novas = inserted.count { it != -1L }
        relinkAllTrips()
        return novas
    }

    suspend fun addExpense(kind: ExpenseKind, amount: Money, at: Instant, note: String?, shiftId: String?) {
        dao.upsertExpense(
            ExpenseEntity.from(
                Expense(
                    id = UUID.randomUUID().toString(),
                    at = at,
                    kind = kind,
                    amount = amount,
                    note = note,
                    shiftId = shiftId
                )
            )
        )
    }

    suspend fun deleteExpense(id: String) = dao.deleteExpense(id)

    suspend fun saveCharges(charges: List<ChargeSession>) {
        if (charges.isNotEmpty()) dao.upsertCharges(charges.map { ChargeEntity.from(it) })
    }

    suspend fun deleteCharge(id: String) = dao.deleteCharge(id)

    suspend fun recordOdometer(km: Double, at: Instant = Instant.now(), source: String = "tesla") {
        dao.insertOdometer(OdometerEntity(at.epochSecond, km, source))
    }

    suspend fun latestOdometer(): Double? = dao.latestOdometer()?.km

    /** Liga a um turno as viagens que caem dentro dele. */
    private suspend fun linkTripsTo(shift: ShiftEntity) {
        val end = shift.endEpoch ?: Instant.now().epochSecond
        dao.tripsBetween(shift.startEpoch, end)
            .filter { it.shiftId != shift.id }
            .forEach { dao.assignTrip(it.id, shift.id) }
    }

    private suspend fun relinkAllTrips() {
        dao.allShifts().forEach { linkTripsTo(it) }
    }
}
