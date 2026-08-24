package pt.rodado.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import pt.rodado.core.calc.Totals
import pt.rodado.core.model.Shift
import pt.rodado.ui.theme.corDoValor

@Composable
fun TurnosScreen(
    turnos: List<Pair<Shift, Totals>>,
    aoApagar: (String) -> Unit
) {
    if (turnos.isEmpty()) {
        Column(Modifier.fillMaxWidth().padding(32.dp)) {
            Text("Ainda não há turnos.", style = MaterialTheme.typography.titleMedium)
            Text(
                "Carrega em «Começar turno» no painel quando saíres, e em «Fechar turno» " +
                    "quando acabares. Os km vêm da Tesla; as viagens vêm dos extratos.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        return
    }

    LazyColumn(Modifier.fillMaxWidth()) {
        items(turnos, key = { it.first.id }) { (turno, totals) ->
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text(
                                "${turno.localDate.dayOfWeek.nomePt()}, ${turno.start.dia()}",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                buildString {
                                    append(turno.start.horaCurta())
                                    append(" - ")
                                    append(turno.end?.horaCurta() ?: "em curso")
                                    turno.zone?.let { append(" · $it") }
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                            Text(
                                totals.net.format(),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = corDoValor(totals.net.cents)
                            )
                            Text(
                                "${totals.netPerHour.ou()}/h",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Row(
                        Modifier.fillMaxWidth().padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        MiniValor("Horas", totals.hours.horas())
                        MiniValor("Viagens", totals.tripCount.toString())
                        MiniValor("Km", totals.totalKm.km())
                        MiniValor("Km pagos", totals.paidKmRatio.percentagem())
                    }

                    if (!totals.isReliable) {
                        Text(
                            "Sem leitura do odómetro — os km deste turno não contam.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { aoApagar(turno.id) }) { Text("Apagar") }
                    }
                }
            }
        }
    }
}

@Composable
private fun MiniValor(etiqueta: String, valor: String) {
    Column {
        Text(
            etiqueta,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(valor, style = MaterialTheme.typography.bodyMedium)
    }
}
