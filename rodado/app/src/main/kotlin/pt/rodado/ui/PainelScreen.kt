package pt.rodado.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.item
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import pt.rodado.core.calc.Totals
import pt.rodado.core.money.Money
import pt.rodado.ui.theme.corDoValor

@Composable
fun PainelScreen(
    estado: PainelState,
    aoEscolherPeriodo: (Periodo) -> Unit,
    aoComecarTurno: () -> Unit,
    aoFecharTurno: (String) -> Unit,
    aoSincronizar: () -> Unit
) {
    val totals = estado.totals

    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Periodo.entries.forEach { opcao ->
                    FilterChip(
                        selected = estado.periodo == opcao,
                        onClick = { aoEscolherPeriodo(opcao) },
                        label = { Text(opcao.label) }
                    )
                }
            }
        }

        item { TurnoCard(estado, aoComecarTurno, aoFecharTurno, aoSincronizar) }

        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                CartaoDestaque(
                    titulo = "Líquido",
                    valor = totals.net.format(),
                    apoio = "${totals.tripCount} viagens · ${totals.hours.horas()}",
                    cor = corDoValor(totals.net.cents),
                    modifier = Modifier.weight(1f)
                )
                CartaoDestaque(
                    titulo = "Por hora",
                    valor = totals.netPerHour.ou(),
                    apoio = totals.netPerKm?.let { "${it.format()} por km" },
                    cor = corDoValor(totals.netPerHour?.cents ?: 0),
                    modifier = Modifier.weight(1f)
                )
            }
        }

        item { KmCard(totals) }

        item {
            Seccao("De onde vem o dinheiro") {
                Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        LinhaValor("Faturação", totals.grossFares.format())
                        LinhaValor("Comissão das plataformas", (-totals.commission).format())
                        LinhaValor("Gorjetas", totals.tips.format())
                        LinhaValor(
                            "Pago pelas plataformas",
                            totals.platformPayout.format(),
                            destaque = true
                        )
                    }
                }
            }
        }

        item {
            Seccao("Para onde vai") {
                Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        LinhaValor(
                            "Carregamentos",
                            (-totals.energyCost).format(),
                            cor = corDoValor(-totals.energyCost.cents)
                        )
                        LinhaValor("Manutenção e pneus", (-totals.maintenanceCost).format())
                        LinhaValor("Portagens", (-totals.tolls).format())
                        LinhaValor("Outros", (-totals.otherCosts).format())
                        if (totals.fixedCosts > Money.ZERO) {
                            LinhaValor("Custos fixos do mês", (-totals.fixedCosts).format())
                        }
                        LinhaValor(
                            if (totals.fixedCosts > Money.ZERO) "Resultado" else "Líquido",
                            totals.result.format(),
                            cor = corDoValor(totals.result.cents),
                            destaque = true
                        )
                    }
                }
            }
        }

        if (!totals.isReliable) {
            item {
                Aviso(
                    "${totals.shiftsMissingOdometer} turnos sem leitura do odómetro. " +
                        "Os km e a manutenção desses turnos ficam de fora, por isso o líquido " +
                        "está melhor do que a realidade."
                )
            }
        }

        item { Column(Modifier.padding(24.dp)) {} }
    }
}

@Composable
private fun TurnoCard(
    estado: PainelState,
    aoComecarTurno: () -> Unit,
    aoFecharTurno: (String) -> Unit,
    aoSincronizar: () -> Unit
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(16.dp)) {
            val turno = estado.turnoAberto
            if (turno == null) {
                Text("Sem turno a decorrer", style = MaterialTheme.typography.titleMedium)
                Text(
                    estado.odometroAtual?.let { "Odómetro: ${it.km()}" }
                        ?: "Liga a Tesla nas definições para os km entrarem sozinhos.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(onClick = aoComecarTurno, modifier = Modifier.weight(1f)) {
                        Text("Começar turno")
                    }
                    OutlinedButton(onClick = aoSincronizar) { Text("Ler carro") }
                }
            } else {
                Text(
                    "Turno a decorrer desde as ${turno.start.horaCurta()}",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    listOfNotNull(
                        turno.odometerStartKm?.let { "Início: ${it.km()}" },
                        turno.odometerEndKm?.let { "Agora: ${it.km()}" },
                        turno.totalKm?.let { "Feitos: ${it.km()}" }
                    ).joinToString(" · ").ifEmpty { "Sem leitura do odómetro ainda" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = { aoFecharTurno(turno.id) },
                        modifier = Modifier.weight(1f)
                    ) { Text("Fechar turno") }
                    OutlinedButton(onClick = aoSincronizar) { Text("Ler carro") }
                }
            }
        }
    }
}

@Composable
private fun KmCard(totals: Totals) {
    Seccao("Quilómetros") {
        Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(Modifier.padding(16.dp)) {
                LinhaValor("Total", totals.totalKm.km())
                LinhaValor("Com cliente", totals.paidKm.km())
                LinhaValor("Vazios", totals.deadKm.km())
                LinhaValor(
                    "Km pagos",
                    totals.paidKmRatio.percentagem(),
                    destaque = true,
                    cor = corDoValor(
                        when {
                            totals.paidKmRatio == null -> 0
                            totals.paidKmRatio!! >= 0.6 -> 1
                            else -> -1
                        }.toLong()
                    )
                )
                Text(
                    "Um motorista eficiente anda nos 60-70% de km pagos. " +
                        "Abaixo disso, andas a gastar pneus e energia à procura de corrida.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp)
                )
                if (totals.energyPer100Km != null) {
                    LinhaValor("Energia por 100 km", totals.energyPer100Km.ou())
                }
            }
        }
    }
}
