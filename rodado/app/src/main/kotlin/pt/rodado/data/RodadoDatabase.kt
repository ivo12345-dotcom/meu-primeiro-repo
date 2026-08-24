package pt.rodado.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        ShiftEntity::class,
        TripEntity::class,
        ChargeEntity::class,
        ExpenseEntity::class,
        OdometerEntity::class,
        DriverWeekEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class RodadoDatabase : RoomDatabase() {

    abstract fun dao(): RodadoDao

    abstract fun fleetDao(): FleetDao

    companion object {
        @Volatile
        private var instance: RodadoDatabase? = null

        fun get(context: Context): RodadoDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                RodadoDatabase::class.java,
                "rodado.db"
            ).build().also { instance = it }
        }
    }
}
