package pt.rodado.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import pt.rodado.core.calc.Totals
import pt.rodado.ui.theme.corDoValor

@Composable
fun AnaliseScreen(estado: AnaliseState) {
    val vazio = estado.porBloco.isEmpty() && estado.porZona.isEmpty()
    if (vazio) {
        Column(Modifier.fillMaxWidth().padding(32.dp)) {
            Text("Ainda não há dados que cheguem.", style = MaterialTheme.typography.titleMedium)
            Text(
                "Ao fim de duas ou três semanas de turnos registados, é aqui que vais ver " +
                    "que blocos horários e que zonas compensam mesmo.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        return
    }

    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Tabela(
                titulo = "Por bloco horário",
                nota = "Ordenado pelo que rende por hora. Trabalha os de cima.",
                linhas = estado.porBloco.map { it.first.label to it.second }
            )
        }
        item {
            Tabela(
                titulo = "Por dia da semana",
                nota = "Descansar num dia mau vale mais do que trabalhá-lo.",
                linhas = estado.porDia.map { it.first.nomePt() to it.second }
            )
        }
        if (estado.porZona.isNotEmpty()) {
            item {
                Tabela(
                    titulo = "Por zona",
                    nota = "Zona onde passaste a maior parte do turno.",
                    linhas = estado.porZona.map { it.first to it.second }
                )
            }
        }
        item {
            Tabela(
                titulo = "Por mês",
                nota = "Já com a prestação e o seguro abatidos nos meses trabalhados.",
                linhas = estado.porMes.map { it.first.nomePt() to it.second },
                mostrarResultado = true
            )
        }
        item { Column(Modifier.padding(24.dp)) {} }
    }
}

@Composable
private fun Tabela(
    titulo: String,
    nota: String,
    linhas: List<Pair<String, Totals>>,
    mostrarResultado: Boolean = false
) {
    if (linhas.isEmpty()) return
    Seccao(titulo) {
        Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(Modifier.padding(16.dp)) {
                linhas.forEach { (etiqueta, totals) ->
                    val valor = if (mostrarResultado) totals.result else totals.net
                    val porHora = if (mostrarResultado) totals.resultPerHour else totals.netPerHour
                    LinhaValor(
                        etiqueta = "$etiqueta · ${totals.hours.horas()}",
                        valor = "${porHora.ou()}/h   ${valor.format()}",
                        cor = corDoValor(porHora?.cents ?: 0)
                    )
                }
                Text(
                    nota,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}
