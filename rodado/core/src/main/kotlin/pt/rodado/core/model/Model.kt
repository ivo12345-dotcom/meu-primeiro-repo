package pt.rodado.core.model

import pt.rodado.core.money.Money
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

val LISBOA: ZoneId = ZoneId.of("Europe/Lisbon")

enum class Platform(val label: String) {
    UBER("Uber"),
    BOLT("Bolt"),
    FREENOW("FREENOW"),
    OUTRA("Outra")
}

/**
 * Uma viagem com cliente, tal como vem do extrato da plataforma.
 *
 * [gross] e o valor da viagem antes da comissao e [commission] o que a
 * plataforma reteve. [net] e o que a plataforma efectivamente te paga: quando o
 * extrato o traz, usa-se esse valor em vez de o recalcular, para o total da app
 * bater certo com o total do extrato ao centimo.
 */
data class Trip(
    val id: String,
    val platform: Platform,
    val start: Instant,
    val end: Instant? = null,
    val distanceKm: Double,
    val gross: Money,
    val commission: Money = Money.ZERO,
    val tips: Money = Money.ZERO,
    /** Portagens que a plataforma te reembolsou nesta viagem. */
    val tollsReimbursed: Money = Money.ZERO,
    val net: Money? = null,
    val shiftId: String? = null
) {
    /** O que esta viagem te poe no bolso, vindo da plataforma. */
    val payout: Money get() = net ?: (gross - commission + tips + tollsReimbursed)
}

/** Um turno de trabalho, delimitado pelo odometro do carro. */
data class Shift(
    val id: String,
    val start: Instant,
    val end: Instant? = null,
    val odometerStartKm: Double? = null,
    val odometerEndKm: Double? = null,
    val zone: String? = null,
    val note: String? = null
) {
    val totalKm: Double?
        get() {
            val from = odometerStartKm ?: return null
            val to = odometerEndKm ?: return null
            val delta = to - from
            return if (delta >= 0) delta else null
        }

    val hours: Double?
        get() {
            val finish = end ?: return null
            val seconds = Duration.between(start, finish).seconds
            return if (seconds > 0) seconds / 3600.0 else null
        }

    val localDate: LocalDate get() = start.atZone(LISBOA).toLocalDate()

    val block: HourBlock get() = HourBlock.of(start.atZone(LISBOA).toLocalTime())
}

/** Um carregamento do carro. */
data class ChargeSession(
    val id: String,
    val start: Instant,
    val end: Instant? = null,
    val energyKwh: Double,
    /** Custo reportado pela Tesla (Supercharger). Nulo em casa ou em postos de terceiros. */
    val reportedCost: Money? = null,
    val isSupercharger: Boolean = false,
    val location: String? = null
) {
    /** Custo a usar nas contas: o real quando existe, senao estimado ao preco de casa. */
    fun cost(homePricePerKwh: Double): Money =
        reportedCost ?: Money.ofEuros(homePricePerKwh * energyKwh)
}

enum class ExpenseKind(val label: String) {
    PORTAGEM("Portagem"),
    LAVAGEM("Lavagem"),
    ESTACIONAMENTO("Estacionamento"),
    MANUTENCAO("Manutenção"),
    OUTRO("Outro")
}

/** Uma despesa paga do teu bolso, que a plataforma nao reembolsou. */
data class Expense(
    val id: String,
    val at: Instant,
    val kind: ExpenseKind,
    val amount: Money,
    val note: String? = null,
    val shiftId: String? = null
)

/** Leitura do odometro do carro, vinda da API da Tesla ou metida a mao. */
data class OdometerReading(
    val at: Instant,
    val km: Double,
    val source: String = "tesla"
)

/** Blocos horarios, iguais aos da folha de calculo. */
enum class HourBlock(val label: String, val fromHour: Int, val toHour: Int) {
    MADRUGADA("Madrugada (00h-05h)", 0, 5),
    MANHA_CEDO("Manhã cedo (05h-08h)", 5, 8),
    MANHA("Manhã (08h-12h)", 8, 12),
    ALMOCO("Almoço (12h-15h)", 12, 15),
    TARDE("Tarde (15h-17h)", 15, 17),
    PICO_TARDE("Pico tarde (17h-21h)", 17, 21),
    NOITE("Noite (21h-00h)", 21, 24);

    companion object {
        fun of(time: LocalTime): HourBlock =
            entries.first { time.hour >= it.fromHour && time.hour < it.toHour }
    }
}

/** Zonas de Lisboa, iguais as da folha de calculo. */
object Zonas {
    val TODAS = listOf(
        "Aeroporto",
        "Parque das Nações",
        "Baixa / Chiado",
        "Cais do Sodré / Bairro Alto",
        "Avenidas Novas / Saldanha",
        "Marquês / Av. Liberdade",
        "Alcântara / LX Factory",
        "Belém / Restelo",
        "Campo de Ourique / Estrela",
        "Benfica / Luz",
        "Alvalade / Areeiro",
        "Lumiar / Telheiras",
        "Oeiras / Algés",
        "Sintra / Cascais",
        "Margem Sul",
        "Cidade / misto"
    )
}
