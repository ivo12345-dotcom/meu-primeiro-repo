package pt.rodado.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.item
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
import pt.rodado.core.csv.ImportPreview
import pt.rodado.core.model.Platform

@Composable
fun ImportarScreen(
    preview: ImportPreview?,
    aoEscolherFicheiro: (Platform) -> Unit,
    aoAjustarColuna: (String, Int?) -> Unit,
    aoConfirmar: () -> Unit,
    aoCancelar: () -> Unit
) {
    LazyColumn(Modifier.fillMaxWidth()) {
        if (preview == null) {
            item { Explicacao(aoEscolherFicheiro) }
        } else {
            item { Mapeamento(preview, aoAjustarColuna, aoConfirmar, aoCancelar) }
        }
    }
}

@Composable
private fun Explicacao(aoEscolherFicheiro: (Platform) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text("Importar viagens", style = MaterialTheme.typography.headlineSmall)
        Text(
            "O Uber e a Bolt não deixam nenhuma app externa consultar os teus ganhos. " +
                "O que dá é descarregar o extrato semanal em CSV e trazê-lo para aqui — " +
                "traz viagem a viagem o que ganhaste, a comissão e a distância.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 12.dp)
        )
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Onde ir buscar", fontWeight = FontWeight.SemiBold)
                Text(
                    "Uber: drivers.uber.com → Ganhos → Extratos → descarregar CSV\n" +
                        "Bolt: partners.bolt.eu → Relatórios → exportar CSV",
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
            ) { Text("Extrato Uber") }
            Button(
                onClick = { aoEscolherFicheiro(Platform.BOLT) },
                modifier = Modifier.weight(1f)
            ) { Text("Extrato Bolt") }
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
    preview: ImportPreview,
    aoAjustarColuna: (String, Int?) -> Unit,
    aoConfirmar: () -> Unit,
    aoCancelar: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text(
            "Confere as colunas",
            style = MaterialTheme.typography.headlineSmall
        )
        Text(
            "${preview.table.rows.size} linhas no ficheiro do ${preview.platform.label}. " +
                "Os cabeçalhos mudam com o idioma da conta, por isso vale a pena confirmar " +
                "antes de importar.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 8.dp)
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AssistChip(onClick = {}, label = { Text("Distância em ${preview.distanceUnit.label}") })
            AssistChip(onClick = {}, label = { Text("Decimais: ${preview.decimalStyle.name.lowercase()}") })
        }

        preview.specs.forEach { spec ->
            EscolhaDeColuna(
                etiqueta = spec.label,
                obrigatoria = spec.required,
                cabecalhos = preview.table.headers,
                seleccionada = preview.mapping.indexOf(spec.key),
                aoSeleccionar = { indice -> aoAjustarColuna(spec.key, indice) }
            )
        }

        if (preview.missingRequired.isNotEmpty()) {
            Aviso(
                "Falta escolher: " + preview.missingRequired.joinToString(", ") { it.label }
            )
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
                enabled = preview.isUsable,
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
