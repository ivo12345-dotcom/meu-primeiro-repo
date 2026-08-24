package pt.rodado.tesla

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import pt.rodado.RodadoApp
import pt.rodado.data.Repository
import pt.rodado.data.SettingsStore
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

sealed interface SyncOutcome {
    data class Ok(val odometerKm: Double?, val newCharges: Int) : SyncOutcome
    data object Asleep : SyncOutcome
    data object NotLinked : SyncOutcome
    data class Failed(val message: String) : SyncOutcome
}

/** Le a Tesla e guarda o que interessa: odometro e carregamentos. */
class TeslaSync(
    private val repository: Repository,
    private val settings: SettingsStore,
    private val api: TeslaApi = TeslaApi(),
    private val auth: TeslaAuth = TeslaAuth()
) {

    suspend fun sync(): SyncOutcome = withContext(Dispatchers.IO) {
        val config = settings.teslaConfig.first()
        if (!config.isLinked || config.vehicleId.isBlank()) return@withContext SyncOutcome.NotLinked

        val fresh = ensureFreshToken(config) ?: return@withContext SyncOutcome.Failed(
            "Não foi possível renovar a sessão da Tesla. Volta a ligar a conta."
        )

        try {
            val odometer = api.odometerKm(fresh)
            if (odometer != null) {
                repository.recordOdometer(odometer)
                updateOpenShift(odometer)
            }

            val vin = config.vehicleId.takeIf { it.length == 17 }
                ?: api.vehicles(fresh).firstOrNull { it.id == config.vehicleId }?.vin
            val charges = if (vin.isNullOrBlank()) {
                emptyList()
            } else {
                runCatching {
                    api.chargingHistory(
                        fresh,
                        vin,
                        Instant.now().minus(14, ChronoUnit.DAYS),
                        Instant.now()
                    )
                }.getOrDefault(emptyList())
            }
            repository.saveCharges(charges)

            SyncOutcome.Ok(odometer, charges.size)
        } catch (_: VehicleAsleep) {
            SyncOutcome.Asleep
        } catch (error: Exception) {
            SyncOutcome.Failed(error.message ?: "Falha a falar com a Tesla")
        }
    }

    /**
     * Vai empurrando o odometro final do turno aberto.
     *
     * Assim, se te esqueceres de fechar o turno na altura certa, os km ficam
     * registados na mesma ate a ultima leitura.
     */
    private suspend fun updateOpenShift(odometerKm: Double) {
        val open = repository.openShift.first() ?: return
        val shift = open.toDomain()
        repository.saveShift(
            shift.copy(
                odometerStartKm = shift.odometerStartKm ?: odometerKm,
                odometerEndKm = odometerKm
            )
        )
    }

    private suspend fun ensureFreshToken(config: pt.rodado.data.TeslaConfig): pt.rodado.data.TeslaConfig? {
        val stillValid = config.accessToken.isNotBlank() &&
            config.accessTokenExpiryEpoch > Instant.now().epochSecond
        if (stillValid) return config

        val tokens = auth.refresh(config).getOrNull() ?: return null
        settings.saveTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresAtEpoch)
        return config.copy(
            accessToken = tokens.accessToken,
            refreshToken = tokens.refreshToken.ifBlank { config.refreshToken },
            accessTokenExpiryEpoch = tokens.expiresAtEpoch
        )
    }

    companion object {
        private const val WORK_NAME = "tesla-sync"

        fun schedule(context: Context) {
            // De 15 em 15 minutos: chega para apanhar os km de um turno com
            // precisao e nao gasta pedidos da quota da Fleet API a toa.
            val request = PeriodicWorkRequestBuilder<TeslaSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}

class TeslaSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as RodadoApp
        return when (app.teslaSync.sync()) {
            is SyncOutcome.Ok, SyncOutcome.Asleep -> Result.success()
            SyncOutcome.NotLinked -> Result.success()
            is SyncOutcome.Failed -> Result.retry()
        }
    }
}
