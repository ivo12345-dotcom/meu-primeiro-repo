package pt.rodado.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import pt.rodado.core.model.CostSettings
import pt.rodado.core.model.FixedCost
import pt.rodado.core.money.Money
import pt.rodado.core.money.parseUserDecimal
import pt.rodado.core.money.parseUserMoney
import pt.rodado.data.TeslaConfig
import pt.rodado.data.TeslaRegion

@Composable
fun DefinicoesScreen(
    custos: CostSettings,
    tesla: TeslaConfig,
    aoGuardarCustos: (CostSettings) -> Unit,
    aoGuardarAppTesla: (String, String, String, TeslaRegion) -> Unit,
    aoRegistarDominio: () -> Unit,
    aoLigarTesla: () -> Unit,
    aoColarCodigo: (String) -> Unit,
    aoSincronizar: () -> Unit,
    aoDesligarTesla: () -> Unit
) {
    LazyColumn(Modifier.fillMaxWidth()) {
        item { BlocoCustos(custos, aoGuardarCustos) }
        item {
            BlocoTesla(
                tesla,
                aoGuardarAppTesla,
                aoRegistarDominio,
                aoLigarTesla,
                aoColarCodigo,
                aoSincronizar,
                aoDesligarTesla
            )
        }
        item { Column(Modifier.padding(24.dp)) {} }
    }
}

@Composable
private fun BlocoCustos(custos: CostSettings, aoGuardar: (CostSettings) -> Unit) {
    var manutencao by remember(custos) { mutableStateOf(taxa(custos.maintenancePerKm)) }
    var precoKwh by remember(custos) { mutableStateOf(taxa(custos.homePricePerKwh)) }
    var comissao by remember(custos) {
        mutableStateOf((custos.fallbackCommissionRate * 100).toInt().toString())
    }
    val fixos = remember(custos) { mutableStateListOf(*custos.fixedCosts.toTypedArray()) }

    Seccao("Custos") {
        Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(Modifier.padding(16.dp)) {
                CampoNumero("Manutenção e pneus (€/km)", manutencao) { manutencao = it }
                Text(
                    "Só manutenção e pneus. A eletricidade não é estimada: entra pelo valor " +
                        "real de cada carregamento, lido da Tesla.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                CampoNumero("Eletricidade em casa (€/kWh)", precoKwh) { precoKwh = it }
                Text(
                    "Usado só nos carregamentos sem custo reportado — em casa ou em postos " +
                        "de terceiros. Os Superchargers trazem o valor real.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                CampoNumero("Comissão de reserva (%)", comissao) { comissao = it }
                Text(
                    "Só usada se o extrato não trouxer a comissão discriminada.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    Seccao("Custos fixos") {
        Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(Modifier.padding(16.dp)) {
                fixos.forEachIndexed { indice, custo ->
                    LinhaCustoFixo(
                        custo = custo,
                        aoMudar = { fixos[indice] = it },
                        aoApagar = { fixos.removeAt(indice) }
                    )
                }
                TextButton(onClick = {
                    fixos.add(FixedCost("Novo custo", Money.ZERO, FixedCost.Period.MENSAL))
                }) { Text("Acrescentar custo fixo") }

                val total = Money(fixos.sumOf { it.monthly.cents })
                LinhaValor("Total por mês", total.format(), destaque = true)
            }
        }
    }

    Button(
        onClick = {
            aoGuardar(
                custos.copy(
                    maintenancePerKm = parseUserDecimal(manutencao) ?: custos.maintenancePerKm,
                    homePricePerKwh = parseUserDecimal(precoKwh) ?: custos.homePricePerKwh,
                    fallbackCommissionRate = (parseUserDecimal(comissao) ?: 25.0) / 100.0,
                    fixedCosts = fixos.toList()
                )
            )
        },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
    ) { Text("Guardar custos") }
}

@Composable
private fun LinhaCustoFixo(
    custo: FixedCost,
    aoMudar: (FixedCost) -> Unit,
    aoApagar: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        OutlinedTextField(
            value = custo.label,
            onValueChange = { aoMudar(custo.copy(label = it)) },
            label = { Text("Descrição") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Row(
            Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = custo.amount.format(withSymbol = false),
                onValueChange = { texto ->
                    parseUserMoney(texto)?.let { aoMudar(custo.copy(amount = it)) }
                },
                label = { Text("Valor") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f)
            )
            Column {
                FixedCost.Period.entries.forEach { periodo ->
                    FilterChip(
                        selected = custo.period == periodo,
                        onClick = { aoMudar(custo.copy(period = periodo)) },
                        label = { Text(if (periodo == FixedCost.Period.MENSAL) "Mensal" else "Anual") }
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                "${custo.monthly.format()} por mês",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            TextButton(onClick = aoApagar) { Text("Apagar") }
        }
    }
}

@Composable
private fun BlocoTesla(
    tesla: TeslaConfig,
    aoGuardarApp: (String, String, String, TeslaRegion) -> Unit,
    aoRegistarDominio: () -> Unit,
    aoLigar: () -> Unit,
    aoColarCodigo: (String) -> Unit,
    aoSincronizar: () -> Unit,
    aoDesligar: () -> Unit
) {
    var clientId by remember(tesla) { mutableStateOf(tesla.clientId) }
    var secret by remember(tesla) { mutableStateOf(tesla.clientSecret) }
    var redirect by remember(tesla) { mutableStateOf(tesla.redirectUri) }
    var regiao by remember(tesla) { mutableStateOf(tesla.region) }
    var codigo by remember { mutableStateOf("") }

    Seccao("Tesla") {
        Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text(
                    if (tesla.isLinked) "Conta ligada" else "Conta por ligar",
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    "A Tesla obriga cada pessoa a registar a sua própria aplicação em " +
                        "developer.tesla.com. Cola aqui o que te derem.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp)
                )

                OutlinedTextField(
                    value = clientId,
                    onValueChange = { clientId = it },
                    label = { Text("Client ID") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = secret,
                    onValueChange = { secret = it },
                    label = { Text("Client Secret (se tiveres)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )
                OutlinedTextField(
                    value = redirect,
                    onValueChange = { redirect = it },
                    label = { Text("Endereço de retorno (https)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )

                Row(
                    Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TeslaRegion.entries.forEach { opcao ->
                        FilterChip(
                            selected = regiao == opcao,
                            onClick = { regiao = opcao },
                            label = { Text(opcao.name.lowercase().replaceFirstChar { it.uppercase() }) }
                        )
                    }
                }

                Button(
                    onClick = { aoGuardarApp(clientId, secret, redirect, regiao) },
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                ) { Text("Guardar dados da aplicação") }

                if (tesla.isRegistered) {
                    OutlinedButton(
                        onClick = aoRegistarDominio,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) { Text("1. Registar o domínio na Tesla") }
                    Text(
                        "Passo único, a fazer uma vez depois de registares a aplicação no " +
                            "portal da Tesla. Sem ele o login corre, mas os pedidos de dados " +
                            "são recusados sem dizer porquê.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    OutlinedButton(
                        onClick = aoLigar,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) { Text(if (tesla.isLinked) "Ligar outra vez" else "2. Iniciar sessão na Tesla") }

                    OutlinedTextField(
                        value = codigo,
                        onValueChange = { codigo = it },
                        label = { Text("Código devolvido pela Tesla") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    )
                    Text(
                        "Depois do login, a Tesla envia-te para o teu endereço de retorno " +
                            "com um parâmetro «code» no fim do endereço. Cola-o aqui.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Button(
                        onClick = {
                            aoColarCodigo(codigo)
                            codigo = ""
                        },
                        enabled = codigo.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) { Text("3. Concluir ligação") }
                }

                if (tesla.isLinked) {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(onClick = aoSincronizar, modifier = Modifier.weight(1f)) {
                            Text("Ler o carro agora")
                        }
                        OutlinedButton(onClick = aoDesligar) { Text("Desligar") }
                    }
                    Text(
                        "A app lê o carro de 15 em 15 minutos. Se ele estiver a dormir, " +
                            "não o acorda — acordá-lo gasta bateria à toa.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun CampoNumero(etiqueta: String, valor: String, aoMudar: (String) -> Unit) {
    OutlinedTextField(
        value = valor,
        onValueChange = aoMudar,
        label = { Text(etiqueta) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
    )
}

/** Mostra uma taxa por km ou por kWh com tres casas, a portuguesa. */
private fun taxa(valor: Double): String =
    String.format(java.util.Locale("pt", "PT"), "%.3f", valor).trimEnd('0').trimEnd(',')
