package pt.rodado.tesla

import android.util.Base64
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import pt.rodado.data.TeslaConfig
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant

/** Resultado de um pedido de token. */
data class TeslaTokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpoch: Long
)

/**
 * Login na conta Tesla pelo fluxo OAuth com PKCE.
 *
 * A Tesla so aceita enderecos de retorno em https, por isso a app nao pode
 * apanhar o retorno com um esquema proprio. O fluxo termina com o utilizador a
 * colar o codigo que aparece na pagina de retorno do seu dominio — chato uma vez,
 * mas nao obriga a configurar App Links antes de a app funcionar.
 */
class TeslaAuth(private val client: OkHttpClient = OkHttpClient()) {

    companion object {
        private const val AUTHORIZE_URL = "https://auth.tesla.com/oauth2/v3/authorize"
        private const val TOKEN_URL = "https://auth.tesla.com/oauth2/v3/token"

        /** Leitura de dados do carro e do historico de carregamentos, mais nada. */
        const val SCOPES = "openid offline_access vehicle_device_data vehicle_charging_cmds"
    }

    private val json = Json { ignoreUnknownKeys = true }

    /** Par de verificador e desafio PKCE para um login. */
    data class Pkce(val verifier: String, val challenge: String)

    fun newPkce(): Pkce {
        val bytes = ByteArray(64)
        SecureRandom().nextBytes(bytes)
        val verifier = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray())
        val challenge = Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        return Pkce(verifier, challenge)
    }

    fun authorizeUrl(config: TeslaConfig, pkce: Pkce, state: String): String =
        AUTHORIZE_URL.toHttpUrl().newBuilder()
            .addQueryParameter("response_type", "code")
            .addQueryParameter("client_id", config.clientId)
            .addQueryParameter("redirect_uri", config.redirectUri)
            .addQueryParameter("scope", SCOPES)
            .addQueryParameter("state", state)
            .addQueryParameter("code_challenge", pkce.challenge)
            .addQueryParameter("code_challenge_method", "S256")
            .build()
            .toString()

    fun exchangeCode(config: TeslaConfig, code: String, verifier: String): Result<TeslaTokens> =
        postToken(
            FormBody.Builder()
                .add("grant_type", "authorization_code")
                .add("client_id", config.clientId)
                .apply { if (config.clientSecret.isNotBlank()) add("client_secret", config.clientSecret) }
                .add("code", code.trim())
                .add("audience", config.region.baseUrl)
                .add("redirect_uri", config.redirectUri)
                .add("code_verifier", verifier)
                .build()
        )

    fun refresh(config: TeslaConfig): Result<TeslaTokens> =
        postToken(
            FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("client_id", config.clientId)
                .add("refresh_token", config.refreshToken)
                .build()
        )

    private fun postToken(body: FormBody): Result<TeslaTokens> = runCatching {
        val request = Request.Builder().url(TOKEN_URL).post(body).build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                error("A Tesla respondeu ${response.code}: ${text.take(300)}")
            }
            val payload = json.parseToJsonElement(text).jsonObject
            val access = payload["access_token"]?.jsonPrimitive?.content
                ?: error("Resposta da Tesla sem access_token")
            val refresh = payload["refresh_token"]?.jsonPrimitive?.content.orEmpty()
            val expiresIn = payload["expires_in"]?.jsonPrimitive?.content?.toLongOrNull() ?: 28800
            TeslaTokens(access, refresh, Instant.now().epochSecond + expiresIn - 60)
        }
    }
}
