package pt.rodado.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import pt.rodado.core.model.CostSettings
import pt.rodado.core.model.FixedCost
import pt.rodado.core.money.Money

private val Context.dataStore by preferencesDataStore("rodado")

@Serializable
private data class StoredFixedCost(val label: String, val cents: Long, val annual: Boolean)

/** As credenciais da aplicacao que o utilizador regista no portal da Tesla. */
data class TeslaConfig(
    val clientId: String = "",
    val clientSecret: String = "",
    val redirectUri: String = "",
    val region: TeslaRegion = TeslaRegion.EUROPA,
    val vehicleId: String = "",
    val refreshToken: String = "",
    val accessToken: String = "",
    val accessTokenExpiryEpoch: Long = 0
) {
    val isRegistered: Boolean get() = clientId.isNotBlank() && redirectUri.isNotBlank()
    val isLinked: Boolean get() = refreshToken.isNotBlank()
}

enum class TeslaRegion(val label: String, val baseUrl: String) {
    EUROPA("Europa e Médio Oriente", "https://fleet-api.prd.eu.vn.cloud.tesla.com"),
    AMERICA("América do Norte e Ásia-Pacífico", "https://fleet-api.prd.na.vn.cloud.tesla.com"),
    CHINA("China", "https://fleet-api.prd.cn.vn.cloud.tesla.cn")
}

class SettingsStore(private val context: Context) {

    private object Keys {
        val commissionRate = doublePreferencesKey("commission_rate")
        val maintenancePerKm = doublePreferencesKey("maintenance_per_km_euros")
        val homePricePerKwh = doublePreferencesKey("home_price_per_kwh_euros")
        val fixedCosts = stringPreferencesKey("fixed_costs")

        val teslaClientId = stringPreferencesKey("tesla_client_id")
        val teslaClientSecret = stringPreferencesKey("tesla_client_secret")
        val teslaRedirect = stringPreferencesKey("tesla_redirect")
        val teslaRegion = stringPreferencesKey("tesla_region")
        val teslaVehicle = stringPreferencesKey("tesla_vehicle")
        val teslaRefresh = stringPreferencesKey("tesla_refresh")
        val teslaAccess = stringPreferencesKey("tesla_access")
        val teslaAccessExpiry = longPreferencesKey("tesla_access_expiry")
        val autoShifts = booleanPreferencesKey("auto_shifts")
    }

    private val json = Json { ignoreUnknownKeys = true }

    // Serializador explicito em vez da versao com tipo inferido: a inferida
    // resolve para a assinatura errada quando o tipo e uma lista generica.
    private val custosFixos = ListSerializer(StoredFixedCost.serializer())

    val costSettings: Flow<CostSettings> = context.dataStore.data.map { it.toCostSettings() }
    val teslaConfig: Flow<TeslaConfig> = context.dataStore.data.map { it.toTeslaConfig() }

    private fun Preferences.toCostSettings(): CostSettings {
        val defaults = CostSettings()
        val stored = this[Keys.fixedCosts]?.let { raw ->
            runCatching { json.decodeFromString(custosFixos, raw) }.getOrNull()
        }
        return CostSettings(
            fallbackCommissionRate = this[Keys.commissionRate] ?: defaults.fallbackCommissionRate,
            maintenancePerKm = this[Keys.maintenancePerKm] ?: defaults.maintenancePerKm,
            homePricePerKwh = this[Keys.homePricePerKwh] ?: defaults.homePricePerKwh,
            fixedCosts = stored?.map {
                FixedCost(
                    it.label,
                    Money(it.cents),
                    if (it.annual) FixedCost.Period.ANUAL else FixedCost.Period.MENSAL
                )
            } ?: defaults.fixedCosts
        )
    }

    private fun Preferences.toTeslaConfig() = TeslaConfig(
        clientId = this[Keys.teslaClientId].orEmpty(),
        clientSecret = this[Keys.teslaClientSecret].orEmpty(),
        redirectUri = this[Keys.teslaRedirect].orEmpty(),
        region = this[Keys.teslaRegion]?.let { name ->
            runCatching { TeslaRegion.valueOf(name) }.getOrDefault(TeslaRegion.EUROPA)
        } ?: TeslaRegion.EUROPA,
        vehicleId = this[Keys.teslaVehicle].orEmpty(),
        refreshToken = this[Keys.teslaRefresh].orEmpty(),
        accessToken = this[Keys.teslaAccess].orEmpty(),
        accessTokenExpiryEpoch = this[Keys.teslaAccessExpiry] ?: 0
    )

    suspend fun saveCostSettings(settings: CostSettings) {
        context.dataStore.edit { prefs ->
            prefs[Keys.commissionRate] = settings.fallbackCommissionRate
            prefs[Keys.maintenancePerKm] = settings.maintenancePerKm
            prefs[Keys.homePricePerKwh] = settings.homePricePerKwh
            val guardados: List<StoredFixedCost> = settings.fixedCosts.map {
                StoredFixedCost(it.label, it.amount.cents, it.period == FixedCost.Period.ANUAL)
            }
            prefs[Keys.fixedCosts] = json.encodeToString(custosFixos, guardados)
        }
    }

    suspend fun saveTeslaApp(
        clientId: String,
        clientSecret: String,
        redirectUri: String,
        region: TeslaRegion
    ) {
        context.dataStore.edit { prefs ->
            prefs[Keys.teslaClientId] = clientId.trim()
            prefs[Keys.teslaClientSecret] = clientSecret.trim()
            prefs[Keys.teslaRedirect] = redirectUri.trim()
            prefs[Keys.teslaRegion] = region.name
        }
    }

    suspend fun saveTokens(accessToken: String, refreshToken: String, expiryEpoch: Long) {
        context.dataStore.edit { prefs ->
            prefs[Keys.teslaAccess] = accessToken
            if (refreshToken.isNotBlank()) prefs[Keys.teslaRefresh] = refreshToken
            prefs[Keys.teslaAccessExpiry] = expiryEpoch
        }
    }

    suspend fun saveVehicle(vehicleId: String) {
        context.dataStore.edit { it[Keys.teslaVehicle] = vehicleId }
    }

    suspend fun clearTeslaLink() {
        context.dataStore.edit { prefs ->
            prefs.remove(Keys.teslaAccess)
            prefs.remove(Keys.teslaRefresh)
            prefs.remove(Keys.teslaAccessExpiry)
            prefs.remove(Keys.teslaVehicle)
        }
    }

    suspend fun setAutoShifts(enabled: Boolean) {
        context.dataStore.edit { it[Keys.autoShifts] = enabled }
    }

    val autoShifts: Flow<Boolean> = context.dataStore.data.map { it[Keys.autoShifts] ?: true }
}
