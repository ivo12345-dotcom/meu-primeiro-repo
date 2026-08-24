package pt.rodado.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import pt.rodado.core.model.DriverWeek
import pt.rodado.core.money.Money
import pt.rodado.core.money.sumOfMoney
import pt.rodado.ui.theme.corDoValor
import java.time.LocalDate

@Composable
fun FrotaScreen(semanas: List<DriverWeek>) {
    if (semanas.isEmpty()) {
        Column(Modifier.fillMaxWidth().padding(32.dp)) {
            Text("Sem relatórios de frota.", style = MaterialTheme.typography.titleMedium)
            Text(
                "Vai a «Importar» e escolhe o relatório «Ganhos por motorista» que descarregas " +
                    "do portal da Uber ou da Bolt. A app percebe sozinha que tipo de ficheiro é.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        return
    }

    val porSemana = semanas.groupBy { it.weekStart }.toSortedMap(compareByDescending { it })

    LazyColumn(Modifier.fillMaxWidth()) {
        porSemana.forEach { (inicio, doPeriodo) ->
            item { SemanaCard(inicio, doPeriodo) }
        }
        item { Column(Modifier.padding(24.dp)) {} }
    }
}

@Composable
private fun SemanaCard(inicio: LocalDate, motoristas: List<DriverWeek>) {
    val bruto = motoristas.sumOfMoney { it.gross }
    val liquido = motoristas.sumOfMoney { it.net }
    val comissao = motoristas.sumOfMoney { it.commission } + motoristas.sumOfMoney { it.otherFees }
    val horas = motoristas.sumOf { it.hours ?: 0.0 }
    val fim = motoristas.first().weekEnd

    Seccao("${inicio.dayOfMonth}/${inicio.monthValue} a ${fim.dayOfMonth}/${fim.monthValue}") {
        Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(Modifier.padding(16.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    CartaoDestaque(
                        titulo = "Líquido da frota",
                        valor = liquido.format(),
                        apoio = "${motoristas.size} motoristas · ${horas.horas()}",
                        cor = corDoValor(liquido.cents),
                        modifier = Modifier.weight(1f)
                    )
                    CartaoDestaque(
                        titulo = "Por hora",
                        valor = (if (horas > 0) Money((bruto.cents / horas).toLong()) else null).ou(),
                        apoio = "bruto, média da frota",
                        modifier = Modifier.weight(1f)
                    )
                }

                LinhaValor("Faturação", bruto.format())
                LinhaValor("Retido pela plataforma", (-comissao).format())

                Text(
                    "Motoristas, do que mais rende por hora para o que menos rende",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 16.dp, bottom = 4.dp)
                )

                motoristas
                    .sortedByDescending { it.grossPerHour?.cents ?: Long.MIN_VALUE }
                    .forEach { LinhaMotorista(it) }

                val fracos = motoristas.filter { (it.grossPerHour?.euros ?: 0.0) < 8.0 }
                if (fracos.isNotEmpty()) {
                    Aviso(
                        "${fracos.size} motoristas abaixo de 8 €/hora bruto: " +
                            fracos.joinToString(", ") { it.driverName } +
                            ". Um carro ocupado a este ritmo não paga a prestação."
                    )
                }
            }
        }
    }
}

@Composable
private fun LinhaMotorista(motorista: DriverWeek) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(motorista.driverName, style = MaterialTheme.typography.bodyLarge)
            Text(
                "${motorista.hours.horas()} · ${motorista.gross.format()} bruto",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                "${motorista.grossPerHour.ou()}/h",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = corDoValor(
                    when {
                        (motorista.grossPerHour?.euros ?: 0.0) >= 12.0 -> 1L
                        (motorista.grossPerHour?.euros ?: 0.0) >= 8.0 -> 0L
                        else -> -1L
                    }
                )
            )
            Text(
                motorista.net.format(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
