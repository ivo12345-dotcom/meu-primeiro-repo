package pt.rodado.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pt.rodado.RodadoApp
import pt.rodado.core.calc.Calculator
import pt.rodado.core.calc.Ledger
import pt.rodado.core.calc.Totals
import pt.rodado.core.csv.DriverWeekImporter
import pt.rodado.core.csv.DriverWeekPreview
import pt.rodado.core.csv.ImportPreview
import pt.rodado.core.csv.ReportDetector
import pt.rodado.core.csv.ReportKind
import pt.rodado.core.csv.TripImporter
import pt.rodado.core.model.CostSettings
import pt.rodado.core.model.DriverWeek
import pt.rodado.core.model.ExpenseKind
import pt.rodado.core.model.HourBlock
import pt.rodado.core.model.LISBOA
import pt.rodado.core.model.Platform
import pt.rodado.core.model.Shift
import pt.rodado.core.money.Money
import pt.rodado.data.TeslaConfig
import pt.rodado.data.TeslaRegion
import pt.rodado.tesla.SyncOutcome
import pt.rodado.tesla.TeslaAuth
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth

/** Um periodo a analisar. */
enum class Periodo(val label: String) {
    HOJE("Hoje"),
    SEMANA("Esta semana"),
    MES("Este mês"),
    TUDO("Tudo")
}

data class PainelState(
    val periodo: Periodo = Periodo.SEMANA,
    val totals: Totals = Totals.EMPTY,
    val turnoAberto: Shift? = null,
    val odometroAtual: Double? = null,
    val mensagem: String? = null
)

data class AnaliseState(
    val porBloco: List<Pair<HourBlock, Totals>> = emptyList(),
    val porZona: List<Pair<String, Totals>> = emptyList(),
    val porDia: List<Pair<DayOfWeek, Totals>> = emptyList(),
    val porMes: List<Pair<YearMonth, Totals>> = emptyList()
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val app get() = getApplication<RodadoApp>()
    private val repository get() = app.repository
    private val settingsStore get() = app.settings

    private val auth = TeslaAuth()
    private var pkce: TeslaAuth.Pkce? = null

    private val periodo = MutableStateFlow(Periodo.SEMANA)
    private val mensagem = MutableStateFlow<String?>(null)
    private val odometro = MutableStateFlow<Double?>(null)

    val settings: StateFlow<CostSettings> = settingsStore.costSettings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CostSettings())

    val teslaConfig: StateFlow<TeslaConfig> = settingsStore.teslaConfig
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TeslaConfig())

    private val ledger: StateFlow<Ledger> = repository.ledger
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Ledger())

    val painel: StateFlow<PainelState> =
        combine(ledger, settings, periodo, mensagem, odometro) { dados, custos, escolha, aviso, km ->
            val recorte = recortar(dados, escolha)
            val fixos = if (escolha == Periodo.MES) custos.monthlyFixedTotal else Money.ZERO
            PainelState(
                periodo = escolha,
                totals = Calculator.totals(recorte, custos, fixos),
                turnoAberto = dados.shifts.firstOrNull { it.end == null },
                odometroAtual = km,
                mensagem = aviso
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PainelState())

    val turnos: StateFlow<List<Pair<Shift, Totals>>> =
        combine(ledger, settings) { dados, custos ->
            Calculator.perShift(dados, custos).sortedByDescending { it.first.start }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val analise: StateFlow<AnaliseState> =
        combine(ledger, settings) { dados, custos ->
            AnaliseState(
                porBloco = Calculator.byBlock(dados, custos).toList()
                    .sortedByDescending { it.second.netPerHour?.cents ?: Long.MIN_VALUE },
                porZona = Calculator.byZone(dados, custos).toList()
                    .sortedByDescending { it.second.netPerHour?.cents ?: Long.MIN_VALUE },
                porDia = Calculator.byWeekday(dados, custos).toList()
                    .sortedByDescending { it.second.netPerHour?.cents ?: Long.MIN_VALUE },
                porMes = Calculator.byMonth(dados, custos).toList().sortedByDescending { it.first }
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AnaliseState())

    /** Recorta o registo pelo periodo escolhido. */
    private fun recortar(dados: Ledger, escolha: Periodo): Ledger {
        if (escolha == Periodo.TUDO) return dados
        val hoje = LocalDate.now(LISBOA)
        val inicio = when (escolha) {
            Periodo.HOJE -> hoje
            Periodo.SEMANA -> hoje.with(DayOfWeek.MONDAY)
            Periodo.MES -> hoje.withDayOfMonth(1)
            Periodo.TUDO -> return dados
        }.atStartOfDay(LISBOA).toInstant()

        fun dentro(momento: Instant) = !momento.isBefore(inicio)
        return Ledger(
            shifts = dados.shifts.filter { dentro(it.start) },
            trips = dados.trips.filter { dentro(it.start) },
            charges = dados.charges.filter { dentro(it.start) },
            expenses = dados.expenses.filter { dentro(it.at) }
        )
    }

    fun escolherPeriodo(novo: Periodo) {
        periodo.value = novo
    }

    fun limparMensagem() {
        mensagem.value = null
    }

    // ---------------------------------------------------------------- turnos

    fun comecarTurno(zona: String?) = viewModelScope.launch {
        val km = repository.latestOdometer()
        repository.startShift(km, zona)
        mensagem.value = if (km == null) {
            "Turno começado. Sem leitura da Tesla — mete os km à mão quando fechares."
        } else {
            "Turno começado aos ${"%.0f".format(km)} km."
        }
    }

    fun fecharTurno(id: String, kmFinal: Double?) = viewModelScope.launch {
        repository.endShift(id, kmFinal, null)
        mensagem.value = "Turno fechado."
    }

    fun guardarTurno(turno: Shift) = viewModelScope.launch {
        repository.saveShift(turno)
    }

    fun apagarTurno(id: String) = viewModelScope.launch {
        repository.deleteShift(id)
    }

    fun adicionarDespesa(tipo: ExpenseKind, valor: Money, nota: String?) = viewModelScope.launch {
        val turnoAberto = repository.openShift.first()?.id
        repository.addExpense(tipo, valor, Instant.now(), nota, turnoAberto)
        mensagem.value = "Despesa registada."
    }

    // ------------------------------------------------------------- definicoes

    fun guardarCustos(novos: CostSettings) = viewModelScope.launch {
        settingsStore.saveCostSettings(novos)
        mensagem.value = "Definições guardadas."
    }

    // ------------------------------------------------------------ importacao

    private val _preview = MutableStateFlow<ImportPreview?>(null)
    val preview: StateFlow<ImportPreview?> = _preview

    private val _fleetPreview = MutableStateFlow<DriverWeekPreview?>(null)
    val fleetPreview: StateFlow<DriverWeekPreview?> = _fleetPreview

    /** Semanas de cada motorista, das mais recentes para as mais antigas. */
    val frota: StateFlow<List<DriverWeek>> = repository.driverWeeks
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * Le o ficheiro escolhido e decide sozinha o que ele e.
     *
     * As plataformas exportam relatorios diferentes com nomes parecidos, e quem
     * exporta nao tem como saber qual e qual — os cabecalhos sabem.
     */
    fun prepararImportacao(texto: String, plataforma: Platform, nomeFicheiro: String?) {
        _preview.value = null
        _fleetPreview.value = null
        when (runCatching { ReportDetector.detect(texto) }.getOrNull()) {
            ReportKind.FROTA -> _fleetPreview.value =
                runCatching { DriverWeekImporter.preview(texto, plataforma, nomeFicheiro) }
                    .onFailure { mensagem.value = "Não consegui ler o relatório: ${it.message}" }
                    .getOrNull()

            ReportKind.VIAGENS -> _preview.value =
                runCatching { TripImporter.preview(texto, plataforma) }
                    .onFailure { mensagem.value = "Não consegui ler o ficheiro: ${it.message}" }
                    .getOrNull()

            else -> mensagem.value =
                "Não reconheci este ficheiro. Precisa de ter uma coluna de motorista " +
                    "(relatório de frota) ou de data e valor (relatório de viagens)."
        }
    }

    fun ajustarColuna(chave: String, indice: Int?) {
        _preview.value = _preview.value?.withMapping(chave, indice)
        _fleetPreview.value = _fleetPreview.value?.withMapping(chave, indice)
    }

    fun cancelarImportacao() {
        _preview.value = null
        _fleetPreview.value = null
    }

    fun confirmarImportacao() = viewModelScope.launch {
        _preview.value?.let { atual ->
            val resultado = TripImporter.apply(atual)
            val novas = repository.importTrips(resultado.trips)
            val repetidas = resultado.trips.size - novas
            mensagem.value = buildString {
                append("$novas viagens importadas")
                if (repetidas > 0) append(", $repetidas já existiam")
                if (resultado.skippedRows > 0) append(", ${resultado.skippedRows} linhas ignoradas")
                append(".")
                resultado.warnings.forEach { append(" $it") }
            }
            _preview.value = null
            return@launch
        }

        _fleetPreview.value?.let { atual ->
            val resultado = DriverWeekImporter.apply(atual)
            repository.importDriverWeeks(resultado.weeks)
            mensagem.value = buildString {
                append("${resultado.weeks.size} motoristas importados")
                append(" (${atual.weekStart} a ${atual.weekEnd})")
                if (resultado.skippedRows > 0) append(", ${resultado.skippedRows} linhas ignoradas")
                append(".")
                resultado.warnings.forEach { append(" $it") }
            }
            _fleetPreview.value = null
        }
    }

    // ----------------------------------------------------------------- tesla

    fun guardarAppTesla(clientId: String, secret: String, redirect: String, regiao: TeslaRegion) =
        viewModelScope.launch {
            settingsStore.saveTeslaApp(clientId, secret, redirect, regiao)
            mensagem.value = "Dados da aplicação Tesla guardados."
        }

    /** Prepara o login e devolve o endereco a abrir no browser. */
    suspend fun urlDeLoginTesla(): String? {
        val config = settingsStore.teslaConfig.first()
        if (!config.isRegistered) {
            mensagem.value = "Preenche primeiro o Client ID e o endereço de retorno."
            return null
        }
        val novo = auth.newPkce()
        pkce = novo
        return auth.authorizeUrl(config, novo, state = "rodado")
    }

    fun trocarCodigoTesla(codigo: String) = viewModelScope.launch {
        val verificador = pkce?.verifier
        if (verificador == null) {
            mensagem.value = "Começa o login outra vez: o pedido anterior expirou."
            return@launch
        }
        val config = settingsStore.teslaConfig.first()
        auth.exchangeCode(config, codigo, verificador)
            .onSuccess { tokens ->
                settingsStore.saveTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresAtEpoch)
                escolherCarro()
            }
            .onFailure { mensagem.value = "A Tesla recusou o código: ${it.message}" }
    }

    private suspend fun escolherCarro() {
        val config = settingsStore.teslaConfig.first()
        val carros = runCatching { pt.rodado.tesla.TeslaApi().vehicles(config) }.getOrNull()
        val carro = carros?.firstOrNull()
        if (carro == null) {
            mensagem.value = "Conta ligada, mas não encontrei nenhum carro."
            return
        }
        settingsStore.saveVehicle(carro.vin.ifBlank { carro.id })
        mensagem.value = "Ligado ao ${carro.name}."
    }

    fun sincronizarTesla() = viewModelScope.launch {
        mensagem.value = "A falar com o carro..."
        when (val resultado = app.teslaSync.sync()) {
            is SyncOutcome.Ok -> {
                odometro.value = resultado.odometerKm
                mensagem.value = buildString {
                    append("Sincronizado")
                    resultado.odometerKm?.let { append(" — ${"%.0f".format(it)} km no odómetro") }
                    if (resultado.newCharges > 0) append(", ${resultado.newCharges} carregamentos")
                    append(".")
                }
            }

            SyncOutcome.Asleep -> mensagem.value =
                "O carro está a dormir. Não o acordo de propósito: da próxima vez que o ligares, os km entram."

            SyncOutcome.NotLinked -> mensagem.value = "A conta Tesla ainda não está ligada."
            is SyncOutcome.Failed -> mensagem.value = resultado.message
        }
    }

    fun desligarTesla() = viewModelScope.launch {
        settingsStore.clearTeslaLink()
        mensagem.value = "Conta Tesla desligada."
    }
}
