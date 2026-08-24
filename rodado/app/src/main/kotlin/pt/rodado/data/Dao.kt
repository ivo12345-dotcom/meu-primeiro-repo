package pt.rodado.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface RodadoDao {

    @Query("SELECT * FROM shifts ORDER BY startEpoch DESC")
    fun shifts(): Flow<List<ShiftEntity>>

    @Query("SELECT * FROM shifts WHERE endEpoch IS NULL ORDER BY startEpoch DESC LIMIT 1")
    fun openShift(): Flow<ShiftEntity?>

    @Query("SELECT * FROM shifts WHERE id = :id")
    suspend fun shift(id: String): ShiftEntity?

    @Query("SELECT * FROM shifts ORDER BY startEpoch")
    suspend fun allShifts(): List<ShiftEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertShift(shift: ShiftEntity)

    @Query("DELETE FROM shifts WHERE id = :id")
    suspend fun deleteShift(id: String)

    @Query("SELECT * FROM trips ORDER BY startEpoch DESC")
    fun trips(): Flow<List<TripEntity>>

    @Query("SELECT * FROM trips WHERE startEpoch BETWEEN :from AND :to")
    suspend fun tripsBetween(from: Long, to: Long): List<TripEntity>

    /**
     * IGNORE e nao REPLACE: reimportar o extrato da mesma semana nao pode
     * sobrepor-se a uma viagem ja associada a um turno, senao perdia-se essa
     * ligacao e os cortes por bloco e por zona esvaziavam-se.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertTrips(trips: List<TripEntity>): List<Long>

    @Query("UPDATE trips SET shiftId = :shiftId WHERE id = :tripId")
    suspend fun assignTrip(tripId: String, shiftId: String?)

    @Query("DELETE FROM trips WHERE id = :id")
    suspend fun deleteTrip(id: String)

    @Query("SELECT * FROM charges ORDER BY startEpoch DESC")
    fun charges(): Flow<List<ChargeEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCharges(charges: List<ChargeEntity>)

    @Query("DELETE FROM charges WHERE id = :id")
    suspend fun deleteCharge(id: String)

    @Query("SELECT * FROM expenses ORDER BY atEpoch DESC")
    fun expenses(): Flow<List<ExpenseEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertExpense(expense: ExpenseEntity)

    @Query("DELETE FROM expenses WHERE id = :id")
    suspend fun deleteExpense(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOdometer(reading: OdometerEntity)

    @Query("SELECT * FROM odometer ORDER BY atEpoch DESC LIMIT 1")
    suspend fun latestOdometer(): OdometerEntity?

    @Query("SELECT * FROM odometer WHERE atEpoch BETWEEN :from AND :to ORDER BY atEpoch")
    suspend fun odometerBetween(from: Long, to: Long): List<OdometerEntity>
}
