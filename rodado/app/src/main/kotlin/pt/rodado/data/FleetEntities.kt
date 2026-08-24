package pt.rodado.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import pt.rodado.core.model.DriverWeek
import pt.rodado.core.model.Platform
import pt.rodado.core.money.Money
import java.time.LocalDate

@Entity(tableName = "driver_weeks", indices = [Index("weekStartEpochDay"), Index("driverId")])
data class DriverWeekEntity(
    @PrimaryKey val id: String,
    val platform: String,
    val driverId: String,
    val driverName: String,
    val weekStartEpochDay: Long,
    val weekEndEpochDay: Long,
    val grossCents: Long,
    val commissionCents: Long,
    val otherFeesCents: Long,
    val tipsCents: Long,
    val tollsCents: Long,
    val netCents: Long,
    val grossPerHourCents: Long?,
    val netPerHourCents: Long?,
    val carId: String?
) {
    fun toDomain() = DriverWeek(
        id = id,
        platform = runCatching { Platform.valueOf(platform) }.getOrDefault(Platform.OUTRA),
        driverId = driverId,
        driverName = driverName,
        weekStart = LocalDate.ofEpochDay(weekStartEpochDay),
        weekEnd = LocalDate.ofEpochDay(weekEndEpochDay),
        gross = Money(grossCents),
        commission = Money(commissionCents),
        otherFees = Money(otherFeesCents),
        tips = Money(tipsCents),
        tolls = Money(tollsCents),
        net = Money(netCents),
        grossPerHour = grossPerHourCents?.let { Money(it) },
        netPerHour = netPerHourCents?.let { Money(it) },
        carId = carId
    )

    companion object {
        fun from(week: DriverWeek) = DriverWeekEntity(
            id = week.id,
            platform = week.platform.name,
            driverId = week.driverId,
            driverName = week.driverName,
            weekStartEpochDay = week.weekStart.toEpochDay(),
            weekEndEpochDay = week.weekEnd.toEpochDay(),
            grossCents = week.gross.cents,
            commissionCents = week.commission.cents,
            otherFeesCents = week.otherFees.cents,
            tipsCents = week.tips.cents,
            tollsCents = week.tolls.cents,
            netCents = week.net.cents,
            grossPerHourCents = week.grossPerHour?.cents,
            netPerHourCents = week.netPerHour?.cents,
            carId = week.carId
        )
    }
}

@Dao
interface FleetDao {

    @Query("SELECT * FROM driver_weeks ORDER BY weekStartEpochDay DESC, netCents DESC")
    fun driverWeeks(): Flow<List<DriverWeekEntity>>

    /**
     * REPLACE e nao IGNORE: a Uber corrige relatorios ja emitidos, e reimportar a
     * mesma semana tem de deixar os valores corrigidos, nao os antigos.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDriverWeeks(weeks: List<DriverWeekEntity>)

    @Query("DELETE FROM driver_weeks WHERE id = :id")
    suspend fun deleteDriverWeek(id: String)

    @Query("UPDATE driver_weeks SET carId = :carId WHERE driverId = :driverId AND weekStartEpochDay = :weekStartEpochDay")
    suspend fun assignCar(driverId: String, weekStartEpochDay: Long, carId: String?)
}
