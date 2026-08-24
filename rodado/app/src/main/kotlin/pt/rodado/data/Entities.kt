package pt.rodado.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import pt.rodado.core.model.ChargeSession
import pt.rodado.core.model.Expense
import pt.rodado.core.model.ExpenseKind
import pt.rodado.core.model.Platform
import pt.rodado.core.model.Shift
import pt.rodado.core.model.Trip
import pt.rodado.core.money.Money
import java.time.Instant

/*
 * As entidades guardam tipos primitivos — centimos em Long, instantes em
 * segundos desde a epoca — e a conversao para o modelo de dominio e feita aqui.
 * Assim a base de dados nao depende das classes do modulo :core e a matematica
 * continua a poder ser testada sem Android.
 */

private fun Long.toInstant(): Instant = Instant.ofEpochSecond(this)
private fun Instant.toEpoch(): Long = epochSecond

@Entity(tableName = "shifts")
data class ShiftEntity(
    @PrimaryKey val id: String,
    val startEpoch: Long,
    val endEpoch: Long?,
    val odometerStartKm: Double?,
    val odometerEndKm: Double?,
    val zone: String?,
    val note: String?
) {
    fun toDomain() = Shift(
        id = id,
        start = startEpoch.toInstant(),
        end = endEpoch?.toInstant(),
        odometerStartKm = odometerStartKm,
        odometerEndKm = odometerEndKm,
        zone = zone,
        note = note
    )

    companion object {
        fun from(shift: Shift) = ShiftEntity(
            id = shift.id,
            startEpoch = shift.start.toEpoch(),
            endEpoch = shift.end?.toEpoch(),
            odometerStartKm = shift.odometerStartKm,
            odometerEndKm = shift.odometerEndKm,
            zone = shift.zone,
            note = shift.note
        )
    }
}

@Entity(tableName = "trips", indices = [Index("startEpoch"), Index("shiftId")])
data class TripEntity(
    @PrimaryKey val id: String,
    val platform: String,
    val startEpoch: Long,
    val endEpoch: Long?,
    val distanceKm: Double,
    val grossCents: Long,
    val commissionCents: Long,
    val tipsCents: Long,
    val tollsCents: Long,
    val netCents: Long?,
    val shiftId: String?
) {
    fun toDomain() = Trip(
        id = id,
        platform = runCatching { Platform.valueOf(platform) }.getOrDefault(Platform.OUTRA),
        start = startEpoch.toInstant(),
        end = endEpoch?.toInstant(),
        distanceKm = distanceKm,
        gross = Money(grossCents),
        commission = Money(commissionCents),
        tips = Money(tipsCents),
        tollsReimbursed = Money(tollsCents),
        net = netCents?.let { Money(it) },
        shiftId = shiftId
    )

    companion object {
        fun from(trip: Trip) = TripEntity(
            id = trip.id,
            platform = trip.platform.name,
            startEpoch = trip.start.toEpoch(),
            endEpoch = trip.end?.toEpoch(),
            distanceKm = trip.distanceKm,
            grossCents = trip.gross.cents,
            commissionCents = trip.commission.cents,
            tipsCents = trip.tips.cents,
            tollsCents = trip.tollsReimbursed.cents,
            netCents = trip.net?.cents,
            shiftId = trip.shiftId
        )
    }
}

@Entity(tableName = "charges", indices = [Index("startEpoch")])
data class ChargeEntity(
    @PrimaryKey val id: String,
    val startEpoch: Long,
    val endEpoch: Long?,
    val energyKwh: Double,
    val reportedCostCents: Long?,
    val isSupercharger: Boolean,
    val location: String?
) {
    fun toDomain() = ChargeSession(
        id = id,
        start = startEpoch.toInstant(),
        end = endEpoch?.toInstant(),
        energyKwh = energyKwh,
        reportedCost = reportedCostCents?.let { Money(it) },
        isSupercharger = isSupercharger,
        location = location
    )

    companion object {
        fun from(charge: ChargeSession) = ChargeEntity(
            id = charge.id,
            startEpoch = charge.start.toEpoch(),
            endEpoch = charge.end?.toEpoch(),
            energyKwh = charge.energyKwh,
            reportedCostCents = charge.reportedCost?.cents,
            isSupercharger = charge.isSupercharger,
            location = charge.location
        )
    }
}

@Entity(tableName = "expenses", indices = [Index("atEpoch")])
data class ExpenseEntity(
    @PrimaryKey val id: String,
    val atEpoch: Long,
    val kind: String,
    val amountCents: Long,
    val note: String?,
    val shiftId: String?
) {
    fun toDomain() = Expense(
        id = id,
        at = atEpoch.toInstant(),
        kind = runCatching { ExpenseKind.valueOf(kind) }.getOrDefault(ExpenseKind.OUTRO),
        amount = Money(amountCents),
        note = note,
        shiftId = shiftId
    )

    companion object {
        fun from(expense: Expense) = ExpenseEntity(
            id = expense.id,
            atEpoch = expense.at.toEpoch(),
            kind = expense.kind.name,
            amountCents = expense.amount.cents,
            note = expense.note,
            shiftId = expense.shiftId
        )
    }
}

/** Leituras do odometro vindas da Tesla, para reconstruir os km de cada turno. */
@Entity(tableName = "odometer", indices = [Index("atEpoch")])
data class OdometerEntity(
    @PrimaryKey val atEpoch: Long,
    val km: Double,
    val source: String
)
