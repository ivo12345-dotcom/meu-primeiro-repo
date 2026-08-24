package pt.rodado.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import pt.rodado.core.csv.DriverWeekPreview
import pt.rodado.core.csv.ImportPreview
import pt.rodado.core.model.Platform

@Composable
fun ImportarScreen(
    preview: ImportPreview?,
    frota: DriverWeekPreview?,
    aoEscolherFicheiro: (Platform) -> Unit,
    aoAjustarColuna: (String, Int?) -> Unit,
    aoConfirmar: () -> Unit,
    aoCancelar: () -> Unit
) {
    LazyColumn(Modifier.fillMaxWidth()) {
        when {
            preview != null -> item {
                Mapeamento(
                    titulo = "Relatório de viagens",
                    subtitulo = "${preview.table.rows.size} viagens do ${preview.platform.label}.",
                    etiquetas = listOf(
                        "Distância em ${preview.distanceUnit.label}",
                        "Decimais: ${preview.decimalStyle.name.lowercase()}"
                    ),
                    cabecalhos = preview.table.headers,
                    specs = preview.specs,
                    indiceDe = { preview.mapping.indexOf(it) },
                    emFalta = preview.missingRequired.map { it.label },
                    podeImportar = preview.isUsable,
                    aoAjustarColuna = aoAjustarColuna,
                    aoConfirmar = aoConfirmar,
                    aoCancelar = aoCancelar
                )
            }

            frota != null -> item {
                Mapeamento(
                    titulo = "Relatório de frota",
                    subtitulo = "${frota.table.rows.size} motoristas, de " +
                        "${frota.weekStart} a ${frota.weekEnd}.",
                    etiquetas = listOf("Decimais: ${frota.decimalStyle.name.lowercase()}"),
                    cabecalhos = frota.table.headers,
                    specs = frota.specs,
                    indiceDe = { frota.mapping.indexOf(it) },
                    emFalta = frota.missingRequired.map { it.label },
                    podeImportar = frota.isUsable,
                    aoAjustarColuna = aoAjustarColuna,
                    aoConfirmar = aoConfirmar,
                    aoCancelar = aoCancelar
                )
            }

            else -> item { Explicacao(aoEscolherFicheiro) }
        }
    }
}

@Composable
private fun Explicacao(aoEscolherFicheiro: (Platform) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text("Importar viagens", style = MaterialTheme.typography.headlineSmall)
        Text(
            "O Uber e a Bolt não deixam nenhuma app externa consultar os ganhos. " +
                "O que dá é descarregar o relatório em CSV e trazê-lo para aqui. " +
                "A app percebe sozinha se lhe deste o relatório de viagens (uma linha por " +
                "corrida, com distância) ou o de frota (uma linha por motorista e por semana).",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 12.dp)
        )
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Onde ir buscar", fontWeight = FontWeight.SemiBold)
                Text(
                    "Uber: drivers.uber.com ou o portal de frota → Ganhos → descarregar CSV\n" +
                        "Bolt: partners.bolt.eu → Relatórios → exportar CSV\n\n" +
                        "Só o relatório de viagens traz distâncias — é ele que permite " +
                        "separar os km com cliente dos km vazios.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = { aoEscolherFicheiro(Platform.UBER) },
                modifier = Modifier.weight(1f)
            ) { Text("Ficheiro Uber") }
            Button(
                onClick = { aoEscolherFicheiro(Platform.BOLT) },
                modifier = Modifier.weight(1f)
            ) { Text("Ficheiro Bolt") }
        }
        Text(
            "Importar o mesmo ficheiro duas vezes não duplica nada.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp)
        )
    }
}

@Composable
private fun Mapeamento(
    titulo: String,
    subtitulo: String,
    etiquetas: List<String>,
    cabecalhos: List<String>,
    specs: List<pt.rodado.core.csv.ColumnSpec>,
    indiceDe: (String) -> Int?,
    emFalta: List<String>,
    podeImportar: Boolean,
    aoAjustarColuna: (String, Int?) -> Unit,
    aoConfirmar: () -> Unit,
    aoCancelar: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text(titulo, style = MaterialTheme.typography.headlineSmall)
        Text(
            "$subtitulo Os cabeçalhos mudam com o idioma da conta, por isso vale a pena " +
                "confirmar antes de importar.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 8.dp)
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            etiquetas.forEach { etiqueta ->
                AssistChip(onClick = {}, label = { Text(etiqueta) })
            }
        }

        specs.forEach { spec ->
            EscolhaDeColuna(
                etiqueta = spec.label,
                obrigatoria = spec.required,
                cabecalhos = cabecalhos,
                seleccionada = indiceDe(spec.key),
                aoSeleccionar = { indice -> aoAjustarColuna(spec.key, indice) }
            )
        }

        if (emFalta.isNotEmpty()) {
            Aviso("Falta escolher: " + emFalta.joinToString(", "))
        }

        Row(
            Modifier.fillMaxWidth().padding(top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(onClick = aoCancelar, modifier = Modifier.weight(1f)) {
                Text("Cancelar")
            }
            Button(
                onClick = aoConfirmar,
                enabled = podeImportar,
                modifier = Modifier.weight(1f)
            ) { Text("Importar") }
        }
    }
}

@Composable
private fun EscolhaDeColuna(
    etiqueta: String,
    obrigatoria: Boolean,
    cabecalhos: List<String>,
    seleccionada: Int?,
    aoSeleccionar: (Int?) -> Unit
) {
    var aberto by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(
            if (obrigatoria) "$etiqueta *" else etiqueta,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        OutlinedButton(onClick = { aberto = true }, modifier = Modifier.fillMaxWidth()) {
            Text(seleccionada?.let { cabecalhos.getOrNull(it) } ?: "— sem coluna —")
        }
        DropdownMenu(expanded = aberto, onDismissRequest = { aberto = false }) {
            DropdownMenuItem(
                text = { Text("— sem coluna —") },
                onClick = {
                    aoSeleccionar(null)
                    aberto = false
                }
            )
            cabecalhos.forEachIndexed { indice, cabecalho ->
                DropdownMenuItem(
                    text = { Text(cabecalho.ifBlank { "coluna ${indice + 1}" }) },
                    onClick = {
                        aoSeleccionar(indice)
                        aberto = false
                    }
                )
            }
        }
    }
}
