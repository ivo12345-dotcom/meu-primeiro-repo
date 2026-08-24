package pt.rodado.tesla

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Request
import pt.rodado.core.model.ChargeSession
import pt.rodado.core.money.Money
import pt.rodado.data.TeslaConfig
import java.time.Instant
import java.time.format.DateTimeFormatter

data class TeslaVehicle(val id: String, val vin: String, val name: String)

/** O carro estava a dormir: nao ha leitura, e nao vale a pena acorda-lo. */
class VehicleAsleep : Exception("O carro está a dormir")

private const val MILES_TO_KM = 1.609344

/**
 * Cliente da Fleet API da Tesla, so de leitura.
 *
 * As respostas sao lidas campo a campo em vez de desserializadas para classes
 * fixas: a Tesla acrescenta e muda campos sem aviso, e um campo novo nao pode
 * fazer a app deixar de ler o odometro.
 */
class TeslaApi(
    private val client: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true }
) {

    private fun get(config: TeslaConfig, path: String, query: Map<String, String> = emptyMap()): JsonObject {
        val url = (config.region.baseUrl + path).toHttpUrl().newBuilder()
            .apply { query.forEach { (key, value) -> addQueryParameter(key, value) } }
            .build()
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer ${config.accessToken}")
            .header("Accept", "application/json")
            .build()
        client.newCall(request).execute().use { response ->
            // 408 quer dizer que o carro nao respondeu a tempo por estar a dormir.
            if (response.code == 408) throw VehicleAsleep()
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                error("A Tesla respondeu ${response.code}: ${text.take(300)}")
            }
            return json.parseToJsonElement(text).jsonObject
        }
    }

    /**
     * Regista o dominio da aplicacao na Fleet API da regiao.
     *
     * E um passo unico, feito uma vez por dominio e por regiao, e a Tesla so o
     * aceita depois de conseguir ir buscar a chave publica ao dominio. Sem ele,
     * o login do utilizador chega a correr mas os pedidos de dados sao recusados
     * — e a mensagem de erro nao diz que foi isto que faltou.
     */
    fun registerPartner(config: TeslaConfig, partnerToken: String, domain: String): String {
        val body = """{"domain":"$domain"}""".toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(config.region.baseUrl + "/api/1/partner_accounts")
            .header("Authorization", "Bearer $partnerToken")
            .header("Accept", "application/json")
            .post(body)
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                error("A Tesla respondeu ${response.code}: ${text.take(300)}")
            }
            return text
        }
    }

    fun vehicles(config: TeslaConfig): List<TeslaVehicle> {
        val payload = get(config, "/api/1/vehicles")
        val list = payload["response"]?.jsonArray ?: return emptyList()
        return list.mapNotNull { element ->
            val item = element.jsonObject
            val id = item["id_s"]?.jsonPrimitive?.contentOrNull
                ?: item["id"]?.jsonPrimitive?.contentOrNull
                ?: return@mapNotNull null
            TeslaVehicle(
                id = id,
                vin = item["vin"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                name = item["display_name"]?.jsonPrimitive?.contentOrNull ?: "Tesla"
            )
        }
    }

    /** Odometro em quilometros. A Tesla devolve-o sempre em milhas. */
    fun odometerKm(config: TeslaConfig): Double? {
        val payload = get(
            config,
            "/api/1/vehicles/${config.vehicleId}/vehicle_data",
            mapOf("endpoints" to "vehicle_state")
        )
        val miles = payload["response"]?.jsonObject
            ?.get("vehicle_state")?.jsonObject
            ?.get("odometer")?.jsonPrimitive?.doubleOrNull
            ?: return null
        return miles * MILES_TO_KM
    }

    /**
     * Historico de carregamentos.
     *
     * Os Superchargers vem com o custo real cobrado; os carregamentos em casa e em
     * postos de terceiros nao, e esses ficam a ser estimados pelo preco por kWh
     * definido nas definicoes.
     */
    fun chargingHistory(config: TeslaConfig, vin: String, from: Instant, to: Instant): List<ChargeSession> {
        val payload = get(
            config,
            "/api/1/dx/charging/history",
            mapOf(
                "vin" to vin,
                "startTime" to DateTimeFormatter.ISO_INSTANT.format(from),
                "endTime" to DateTimeFormatter.ISO_INSTANT.format(to)
            )
        )
        val sessions = payload["response"]?.jsonObject?.get("data")?.jsonArray ?: return emptyList()
        return sessions.mapNotNull { element ->
            val item = element.jsonObject
            val start = item["chargeStartDateTime"]?.jsonPrimitive?.contentOrNull
                ?.let { runCatching { Instant.parse(it) }.getOrNull() }
                ?: return@mapNotNull null
            val energy = item["energyUsed"]?.jsonPrimitive?.doubleOrNull
                ?: item["chargingEnergyAdded"]?.jsonPrimitive?.doubleOrNull
                ?: return@mapNotNull null
            val fees = item["fees"]?.jsonArray
            val totalDue = fees?.sumOf { fee ->
                fee.jsonObject["totalDue"]?.jsonPrimitive?.doubleOrNull ?: 0.0
            } ?: 0.0
            val siteName = item["siteLocationName"]?.jsonPrimitive?.contentOrNull

            ChargeSession(
                id = "tesla:${start.epochSecond}",
                start = start,
                end = item["chargeStopDateTime"]?.jsonPrimitive?.contentOrNull
                    ?.let { runCatching { Instant.parse(it) }.getOrNull() },
                energyKwh = energy,
                reportedCost = if (totalDue > 0.0) Money.ofEuros(totalDue) else null,
                isSupercharger = totalDue > 0.0,
                location = siteName
            )
        }
    }
}
