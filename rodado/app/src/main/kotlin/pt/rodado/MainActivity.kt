package pt.rodado

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.ViewList
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pt.rodado.core.model.Platform
import pt.rodado.ui.AnaliseScreen
import pt.rodado.ui.DefinicoesScreen
import pt.rodado.ui.ImportarScreen
import pt.rodado.ui.MainViewModel
import pt.rodado.ui.PainelScreen
import pt.rodado.ui.TurnosScreen
import pt.rodado.ui.theme.RodadoTheme

private enum class Aba(val titulo: String, val icone: ImageVector) {
    PAINEL("Painel", Icons.Filled.Speed),
    TURNOS("Turnos", Icons.Filled.ViewList),
    IMPORTAR("Importar", Icons.Filled.FileDownload),
    ANALISE("Análise", Icons.Filled.BarChart),
    DEFINICOES("Definições", Icons.Filled.Settings)
}

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            RodadoTheme {
                Ecra()
            }
        }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    private fun Ecra() {
        val viewModel: MainViewModel = viewModel()
        var aba by remember { mutableStateOf(Aba.PAINEL) }
        val snackbar = remember { SnackbarHostState() }
        val scope = rememberCoroutineScope()

        val painel by viewModel.painel.collectAsState()
        val turnos by viewModel.turnos.collectAsState()
        val analise by viewModel.analise.collectAsState()
        val custos by viewModel.settings.collectAsState()
        val tesla by viewModel.teslaConfig.collectAsState()
        val preview by viewModel.preview.collectAsState()

        var plataformaEscolhida by remember { mutableStateOf(Platform.UBER) }
        val escolherFicheiro = rememberLauncherForActivityResult(
            ActivityResultContracts.OpenDocument()
        ) { uri: Uri? ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                val texto = withContext(Dispatchers.IO) {
                    runCatching {
                        contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                    }.getOrNull()
                }
                if (texto.isNullOrBlank()) {
                    snackbar.showSnackbar("Não consegui ler o ficheiro.")
                } else {
                    viewModel.prepararImportacao(texto, plataformaEscolhida)
                }
            }
        }

        LaunchedEffect(painel.mensagem) {
            painel.mensagem?.let {
                snackbar.showSnackbar(it)
                viewModel.limparMensagem()
            }
        }

        Scaffold(
            topBar = { TopAppBar(title = { Text(aba.titulo) }) },
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar {
                    Aba.entries.forEach { opcao ->
                        NavigationBarItem(
                            selected = aba == opcao,
                            onClick = { aba = opcao },
                            icon = { Icon(opcao.icone, contentDescription = opcao.titulo) },
                            label = { Text(opcao.titulo) }
                        )
                    }
                }
            }
        ) { padding ->
            val conteudo = Modifier.padding(padding)
            when (aba) {
                Aba.PAINEL -> androidx.compose.foundation.layout.Box(conteudo) {
                    PainelScreen(
                        estado = painel,
                        aoEscolherPeriodo = viewModel::escolherPeriodo,
                        aoComecarTurno = { viewModel.comecarTurno(null) },
                        aoFecharTurno = { id -> viewModel.fecharTurno(id, null) },
                        aoSincronizar = viewModel::sincronizarTesla
                    )
                }

                Aba.TURNOS -> androidx.compose.foundation.layout.Box(conteudo) {
                    TurnosScreen(turnos = turnos, aoApagar = viewModel::apagarTurno)
                }

                Aba.IMPORTAR -> androidx.compose.foundation.layout.Box(conteudo) {
                    ImportarScreen(
                        preview = preview,
                        aoEscolherFicheiro = { plataforma ->
                            plataformaEscolhida = plataforma
                            escolherFicheiro.launch(
                                arrayOf("text/csv", "text/comma-separated-values", "text/plain", "*/*")
                            )
                        },
                        aoAjustarColuna = viewModel::ajustarColuna,
                        aoConfirmar = viewModel::confirmarImportacao,
                        aoCancelar = viewModel::cancelarImportacao
                    )
                }

                Aba.ANALISE -> androidx.compose.foundation.layout.Box(conteudo) {
                    AnaliseScreen(analise)
                }

                Aba.DEFINICOES -> androidx.compose.foundation.layout.Box(conteudo) {
                    DefinicoesScreen(
                        custos = custos,
                        tesla = tesla,
                        aoGuardarCustos = viewModel::guardarCustos,
                        aoGuardarAppTesla = viewModel::guardarAppTesla,
                        aoRegistarDominio = viewModel::registarDominioTesla,
                        aoLigarTesla = {
                            scope.launch {
                                val url = viewModel.urlDeLoginTesla()
                                if (url != null) {
                                    CustomTabsIntent.Builder().build()
                                        .launchUrl(this@MainActivity, Uri.parse(url))
                                }
                            }
                        },
                        aoColarCodigo = viewModel::trocarCodigoTesla,
                        aoSincronizar = viewModel::sincronizarTesla,
                        aoDesligarTesla = viewModel::desligarTesla
                    )
                }
            }
        }
    }
}
