# Protótipo 3a, parte C (segurança, decisão, desistência, avisos, cálculo, plugin): relatório

Clone: `scratchpad\proto-3a`, ramo `claude/piloto-automatico-cwnr0f`. Sem push. A config global do git não foi mexida e o repo real não foi tocado. `npm install` feito só no clone (`software/dev` e `software/dev/config`), mais o `ligar-admin-ui.js`.

## Commits (no clone)

| SHA | O quê |
|---|---|
| `fb3e132` | `lib/base.js` (polar + curva da Volvo), `lib/sol.js` (NOAA), `lib/cenarios.js`; `passagem.js`: o `consumo` recebe também `rumo` (a proa) |
| `3688ff2` | `lib/seguranca.js` e testes |
| `dae82a9` | `lib/decisao.js` e testes |
| `1f97f52` | `lib/desistencia.js`, `lib/avisos.js` e testes |
| `a139a8d` | `lib/calculo.js` e o teste de 29/09 |
| `0a6d419` | `index.js` (o plugin) e testes do REST |
| `5694873` | o mesmo cabo contornado aos bocados conta uma vez; "a melhor (…, agora)" no veredicto |
| `0c0a292` | `software/dev`: dependência + config do plugin, `@signalk/resources-provider`, `testar-rota.js` e o script `npm run testar-rota` |
| `ab88cfc` | o P90 do gasóleo nunca fica abaixo do P50 |

## Ficheiros

Em `software/signalk-arlequin-rota/`:
- **novos:** `index.js`, `lib/base.js`, `lib/sol.js`, `lib/cenarios.js`, `lib/seguranca.js`, `lib/decisao.js`, `lib/desistencia.js`, `lib/avisos.js`, `lib/calculo.js`;
- **testes novos:** `test/base.test.js`, `seguranca.test.js`, `decisao.test.js`, `desistencia.test.js`, `avisos.test.js`, `calculo.test.js`, `index.test.js`;
- **alterados:** `lib/passagem.js` (uma linha) e `test/passagem.test.js`.

Em `software/dev/`:
- **alterados:** `package.json` (script `testar-rota`) e `config/package.json` (`signalk-arlequin-rota` por `file:`, `@signalk/resources-provider` 1.5.2);
- **novos:** `config/plugin-config-data/signalk-arlequin-rota.json` (pasta `arlequin-dados`, polar `../arlequin-ecra/public/polar-arlequin.csv`), `config/plugin-config-data/resources-provider.json` e `testar-rota.js`.

## Assinaturas públicas (exatas)

**`lib/base.js`**
```
POLAR_PADRAO   // <repo>/software/arlequin-ecra/public/polar-arlequin.csv
lerPolar(texto) → { tws[], twa[], v[][] }     // igual ao polar.js do ecrã; lança 'polar ilegível'
carregarPolar(caminho = POLAR_PADRAO)
velocidadePolar(p, twaGraus, twsNos) → nós     // = velocidadeAlvo(p, rad, m/s)/NO do ecrã
CURVA, litrosHora(rpm, fator = 1)               // cópia de signalk-arlequin-j1939/lib/consumo.js
```

**`lib/sol.js`** (NOAA)
```
nascerPor(dia ms, lat, lon) → { nascer, por }   // ms UTC; null sem nascer/pôr
nasceresPores(lat, lon, desde, ate) → { nasceres[], pores[] }   // de desde−1 dia a ate+1 dia
```

**`lib/cenarios.js`**
```
CENARIOS = { pessimista: {vento:'p90', ventoPolar:'p10', velocidade:'p10', gasoleo:'p90'},
             provavel:   {p50 em tudo},
             otimista:   {vento:'p10', ventoPolar:'p90', velocidade:'p90', gasoleo:'p10'} }
NOMES, RAZAO_SEM_MODELO = {p10:0.9, p50:1, p90:1.1}, GENOA_POR_RIZOS = [100, 70, 50]
criarCorrecaoVento({ tempoBruto, modelos, obtida, tendPressao3h }) → (lat, lon, t) → { w, razao, twd }
criarCenarios({ tempoBruto, modelos = {}, polar, obtida, tendPressao3h = null })
  → { pessimista|provavel|otimista: { tempo(lat,lon,t), velocidadeVela(ctx), consumo(ctx), quantis } }
  // tempo devolve o w em bruto + { tws, rajada (× razão), twd (corrigida), prevTws, prevRajada, prevTwd, twsPolar }
notaIa(modelos) → texto
```

**`lib/seguranca.js`**
```
PADRAO = { afastamentoMinimo: 5, toleranciaMn: 0.1, passoAmostraMn: 0.25, afastamentoVentoTerra: 3, gasoleoMinL: 40,
           bateriaMinPct: 50, ventoMedioMax: 22, rajadaMax: 30, ondasMax: 3, lemeMaxH: 8, calmaVento: 10, calmaOndas: 1.5 }
horasLemeEquivalentes(pontos, opcoes) → h
distanciaRotaCosta(costa, pontosRota, opcoes) → { mn, lat, lon } | null    // só os troços da linha (costaLivre falso)
minimoCosta(afastamento, opcoes) → MN
avaliar({ alternativa, pessimista, provavel, destino, tripulacao, sairAgora, gasoleoInicial, costa, costaMinMn, opcoes })
  → { excluida, naoRecomendada, motivos[], avisosVermelhos[], horasLemeEq, costaMinMn, chegadaNoite }
```

**`lib/decisao.js`**
```
PESOS, CONTRA = { angulo: 50, ventoMin: 7 }
horasContraVento(pontos) → h
custo({ resumo, esperaH, tripulacao, lemeEq, contraVentoH }) → { total, partes: {horas, espera, noite, leme, rajada, ondas, contraVento} }
partidas(agora, { sairAgora, horas = 48, passoH = 3, fim }) → [ms]
quando(t, agora, fuso) → 'às HH:MM' | 'amanhã às HH:MM' | 'dia D às HH:MM';  hora(t, fuso)
melhores(candidatos, { tripulacao, sairAgora, n = 3 }); recomendada(c, tripulacao)
decidir({ candidatos, agora, tripulacao, sairAgora, emMar, abrigo, fuso, excluidasAgora })
  → { top[], veredicto: { tipo: 'segue'|'espera'|'nao-recomendado'|'volta', texto, porque[1–2] } }
```

**`lib/desistencia.js`**
```
PADRAO = { passoMn: 5, anguloCabo: 30, janelaCaboMn: 2, amostraCaboMn: 0.5, juntarCaboMn: 10, candidatos: 2, fuso }
CABOS (10 cabos com posição aproximada, só para o nome)
ventoNaPerna(twd, rumo) → { twa, texto: 'contra' | 'de través' | 'a favor' }    // <60 / 60–120 / >120
cabos(linhaPreparada, s1, s2, opcoes) → [{ s, lat, lon, rodaGraus, nome }]
cabosDaRota(pontosRota, opcoes); marcos(pontosRota, passoMn); rotaAte(costa, p, destino) → { pontos, milhas } | null
pontosDesistencia({ costa, rota, linhaTempo, partida, destino, eta(pontos, t) → ms, twd(lat, lon, t), opcoes })
  → { pontos: [{ t, hora, tipo: 'marco'|'cabo', nome, lat, lon, milhas, abrigo, voltar }], resumo }
  // abrigo/voltar = { id, nome, milhas, chegada ISO, rumo, twa, vento }
```

**`lib/avisos.js`**
```
PADRAO = { fuso, antecedenciaMin: 30, visibilidadeRadar: 5000, chuvaRadar: 0.5, rotacaoVento: 45, ventoMinRotacao: 6,
           viragemGraus: 40, juntarManobrasH: 2, reservaGasoleoL: 40, reservaBateriaPct: 50, comerCadaH: 3, rajadaBarra: 20, popaTwa: 120 }
avisosDaPassagem({ passagem, destino, tripulacao, opcoes }) → [{ t, hora, tipo, texto, antecedenciaMin }]
  // tipos: rizar, largar-rizo, por-do-sol, chuva, frente, rotacao, virar, cambar, chegada-noite, gasoleo, bateria, comer
precaucoes({ passagem, tripulacao, sairAgora, desistenciaResumo, opcoes }) → [{ id, texto, sempre, porque? }]
  // ids: vhf, telemovel, plano, barra | arnes, retenida, radar, rizo-saida, retranca-motor | desistencia, plano-hora (sair agora)
```

**`lib/calculo.js`**
```
PADRAO = { afastamentoMinimo: 5, afastamentos: [3,5,8], rpmCruzeiro: 2100, horasPartidas: 48, passoPartidasH: 3,
           energia: {}, socDesconhecido: 0.8, gasoleoDesconhecidoL: 100, passagem: {}, fuso: 'Europe/Lisbon' }
async calcular(entrada, deps) → resultado | { erro }         // nunca lança
  entrada = { instrumentos: { posicao:{lat,lon}, socPct?, gasoleoL?, tendPressao3h? },
              destino: 'id' | { lat, lon, nome? } | { rotaAtiva: [...] }, tripulacao: 'so'|'acompanhado', sairAgora, agora }
  deps = { costa, polar, modelos, versoes, obterPrevisao: async ({pontos, desde, ate, agora}) → {previsao, obtida, idadeH, aviso, texto} | {erro},
           opcoes, progresso(f 0–1, texto), aoCandidatos(lista) }
resolverDestino(costa, destino) → { destino, aviso } | { erro }
```

**`resultado`** (a forma do desenho, com alguns campos a mais):
```
{ calculadoEm, destino{id,nome,conhecido,abrigo,confirmado}, partida{…, emMar}, tripulacao, sairAgora,
  veredicto{tipo,texto,porque[]},
  alternativas[≤3]{ id, nome, afastamento, partida, esperaH, propulsao:'vela'|'motor', chegada{p10,p50,p90}, milhas, milhasSimuladas,
    horas{total,vela,motor,noite,leme,lemePessimista}, maximos{vento,rajada,ondas}, maximosPessimista{…}, gasoleoL{p50,p90},
    bateriaMin, chegadaNoite, excluida, naoRecomendada, motivos[], avisosVermelhos[], costaMinMn, custo{total,partes},
    rota[[lat,lon]…], pontosRota[{lat,lon,nome,perna}], eventos[{t,hora,tipo,texto}], avisos[], precaucoes[], avisosRota? },
  desistencia[], desistenciaResumo, previsao{obtida,idadeH,aviso,fim}, ia{versoes,nota}, avisos[], estatisticas{…} }
```

**`index.js`**: `module.exports = function (app, deps = { fetch, relogio, esperar, costa })`.
- Opções: `pasta` ('~/arlequin-dados'), `afastamentoMinimo` 5, `rpmCruzeiro` 2100, `polar` (POLAR_PADRAO), `previsoes` true, `bateria` 'servico', `deposito` '0', `socDesconhecido` 0,8, `gasoleoDesconhecidoL` 100, `energia` {capacidadeAh, consumoDiaA, consumoNoiteA, paineis, areaPainelM2, rendimento, alternadorA}, `porta` 3000.
- REST, exatamente como no desenho:
  - `POST /calcular` → 202 {id}; 409 {erro, id} se houver um a correr; 400 com o pedido inválido; 503 antes do start.
  - `GET /resultado/:id` → {estado, progresso, texto, resultado?, erro?}; 404.
  - `GET /destinos` → {destinos} (lista + os do Ivo, estes com `meu: true`).
  - `POST /destinos` {nome, lat, lon | posicaoAtual: true, conhecido, abrigo} → 201 (grava atómico em `<dataDir>/destinos.json`; valida o nome, as coordenadas e "em terra").
  - `POST /ativar` {id, alternativa: índice ou id} → {ok, rota, href, via}; 404/409/502.
  - Destino extra: `'rota-ativa'` (o fim da rota ativa, pelo `app.getCourse` e pela API de recursos).
- **Ativar:** `app.resourcesApi.setResource('routes', uuid, {name, description, distance, feature: LineString [lon,lat] + coordinatesMeta[{name}]})`. Depois espera até o `getResource` a ler, porque o `setResource` do servidor 2.33 não espera pela escrita do fornecedor. Por fim `app.activateRoute({ href: '/resources/routes/<uuid>', pointIndex: 1 })`.
  - O `pointIndex: 1` é porque o barco está no ponto 0 (o cais), e assim não é precisa a posição.
  - Sem API interna: `PUT http://localhost:<porta>/signalk/v2/api/resources/routes/<uuid>` e `PUT …/navigation/course/activeRoute`.

## Testes

- `npm test` em `signalk-arlequin-rota`, 3 vezes seguidas no último commit: **81 testes, 80 pass, 0 fail, 1 todo**, de cada vez, em ~1,75 s.
  - Passa também com `TZ=UTC` e com `TZ=America/New_York`.
  - Os 80 são os 44 da ronda B, o assert novo em `passagem`, e os novos: base 5, segurança 6, decisão 7, desistência 3, avisos 3, cálculo 6 (+1 todo) e index 6.
- `cd software/dev && npm test`: **tudo passa** (código de saída 0):
  - energia 33, simulador 16, ais 4, ecrã 60, j1939 31, gasóleo 31, água 9, porto 23, caixa negra 52, sincronizar 18, ia 34;
  - **rota 80 (+1 todo)**;
  - pytest 54.
- O `todo` é o ponto do desenho "a melhor alternativa chega de dia", que com os dados reais não se cumpre (ver abaixo). Ficou `todo` para não esconder a falha nem mexer nos limites.

## A fixture de 29/09: Algés → Peniche, 15:32 locais

Condições do cálculo:
- previsão da fixture (obtida simulada 14:00Z) e maré de Cascais;
- sem modelos da AI (polar, vento ±10%, curva da Volvo);
- SoC 90% e 124 L de gasóleo;
- ~700 ms por cálculo: 17 partidas, 90 simuladas, 25 fora da previsão, 6 excluídas pela rota (a de 3 MN sem vento de terra).

### Só eu: "Não recomendado sozinho"

Porquê (o texto do veredicto):
1. "Nenhuma partida nas próximas 48 h passa nos limites; a melhor (a 5 MN a motor, amanhã às 06:30): 14,5 h equivalentes ao leme (limite 8 h sozinho)."
2. "Agora: rajadas até 34 nós no pior caso (limite 30 sozinho) e 16,5 h equivalentes ao leme (limite 8 h sozinho)."

| # | Alternativa | Chegada P10/P50/P90 | Horas (total / motor / noite / leme eq.) | Máx. provável (vento / rajada / ondas) | Máx. pessimista | Gasóleo | Custo |
|---|---|---|---|---|---|---|---|
| 1 | 30/09 06:30, 5 MN, só motor | 21:22 / 21:22 / 21:22, **noite** | 14,87 / 14,87 / 3,05 / 14,47 | 5,8 / 11,6 / 2,8 | 6,3 / 12,7 / 2,8 | 21,6 L | **39,15** |
| 2 | 30/09 03:30, 5 MN, só motor | 18:53, **dia** | 15,38 / 15,38 / 4,05 / 15,38 | 6,5 / 19,1 / 2,7 | 7,1 / 21 / 2,7 | 22,3 L | 41,17 |
| 3 | 30/09 09:30, 3 MN, só motor | 01/10 00:17, noite | 14,78 / 14,78 / 4,92 / 14,40 | 7,2 / 15,1 / 2,8 | 7,9 / 16,6 / 2,8 | 21,4 L | 42,92 |

- Partes do custo da n.º 1: horas 14,87, espera 3,74, noite 4,57, leme 14,47, ondas 1,50.
- As três são "não recomendada" só pelas horas ao leme.
- Partir agora (29/09 15:32, vela, 5 MN):
  - chega às 07:15 de 30/09 (noite), com custo 56,7;
  - no pior caso: rajadas de 34 nós e 16,5 h ao leme.
- Desistência: "até às 20:24 ainda voltas a Algés (CNA) com vento a favor".

### Acompanhado: "Espera até amanhã às 06:30" (melhor do que só eu, como pede o desenho)

| # | Alternativa | Chegada | Custo |
|---|---|---|---|
| 1 | 30/09 06:30, 5 MN, só motor | 21:22, noite | 24,69 |
| 2 | 30/09 03:30, 5 MN, só motor | 18:53, dia | 25,79 |
| 3 | 30/09 06:30, 8 MN, vela e motor | 22:39, noite | 27,95 |

Porquê:
1. "Partir agora também dá, mas custa mais: chegas amanhã às 07:15 (de noite)…"
2. "Partindo amanhã às 06:30, pela rota a 5 MN a motor: chegas amanhã às 21:22 (de noite)…"

### O que difere do desenho (números honestos; limites e pesos não foram mexidos)

- **A melhor NÃO chega de dia.** Chega às 21:22, 3 h depois do pôr do sol (19:22).
  - A 2.ª (partida às 03:30) chega de dia às 18:53, mas custa mais 2,0: parte com 4 h de noite e demora mais 0,5 h.
  - A fórmula do desenho não distingue a noite à partida da noite à chegada. Peniche é `conhecido: true`, por isso a chegada de noite também não pesa como regra.
- **Porque é que tudo é "não recomendado" com só eu:**
  - a fixture tem ondas de 2,5–3,0 m (ondulação) todo o período, por isso **nunca há "motor em calma"** (é preciso < 1,5 m);
  - a motor a 4,3 nós × fator de mar ≈ 4,0 nós, Algés → Peniche (62,7 MN) leva ~15 h;
  - à vela leva 11–16 h;
  - qualquer passagem passa as 8 h ao leme.
  - O exemplo do desenho geral ("amanhã às 08:00 a motor, 12,2 h em calma = 6,1 h") supunha mar < 1,5 m, e o mar real não o dá.
  - O desenho aceita "não recomendado sozinho" ou "espera", por isso este ponto cumpre-se.

## O teste ao vivo (SignalK 2.33 local, previsão real de hoje, 30/09)

Como correu:
- Arrancado com `npm start` em `software/dev` do clone.
- PIDs meus, registados por `Get-CimInstance Win32_Process` (`*signalk-server*`, caminho do scratchpad): 9896, depois 2164, depois 5872. Cada um foi parado por `Stop-Process -Id` depois de usado.
  - Parei o primeiro para acrescentar o resources-provider e o segundo para carregar duas correções.
  - Não havia outro SignalK nem nada na porta 3000.
- Para pôr o barco em Algés, o `arlequin-simulador` foi **desligado temporariamente** no clone (ele navega Peniche → Nazaré e reescreve a posição a cada segundo). Voltou ao original, sem commit.
- A posição, SoC 90% e 124 L entraram por um delta no WebSocket (`testar-rota.js --em alges`).
- Resultados gravados em `scratchpad\proto-3c\live-resultado.json` (só eu) e `live-resultado-acompanhado.json`. Registos em `live-so.txt` e `live-acompanhado.txt`.

### Só eu (partida 10:23 locais): "Não recomendado sozinho", em 3,1 s

- Números do cálculo:
  - 16 partidas, 96 simuladas, 36 fora da previsão (acaba a 02/10 08:00Z), 60 candidatos, 0 recomendados;
  - 9 ficheiros arquivados em `arlequin-dados/previsoes`.
- Porquê: "a melhor (a 3 MN a motor, agora): 14,6 h equivalentes ao leme (limite 8 h sozinho)". Hoje há vento de terra, por isso a rota de 3 MN existe.

| # | Alternativa | Chegada (locais) | MN | Custo |
|---|---|---|---|---|
| 1 | Agora, 3 MN, só motor | 01:26 de 01/10, noite | 59,04 | 43,17 |
| 2 | Agora, 5 MN, só motor | 02:27, noite | 62,66 | 47,61 |
| 3 | Agora, 3 MN, vela e motor | 03:41, noite | 59,04 | 52,54 |

- **Desistência:** "até às 00:28 ainda voltas a Algés (CNA) com vento a favor".
  - 12 marcos de 5 em 5 MN mais o Cabo Raso.
  - O abrigo é Cascais até às 17:19 e Peniche daí em diante.
- **Ativação:**
  - `POST /ativar {id, alternativa: 0}` → `{"ok":true,"rota":"767ad17a-dfac-47e1-a2db-755d944deb25","via":"api interna"}`;
  - `GET /signalk/v2/api/vessels/self/navigation/course` → `activeRoute: {"href":"/resources/routes/767ad17a-…","name":"Arlequin → Peniche (Agora, 3 MN, só motor)","pointIndex":1,"pointTotal":53}`, nextPoint 38,668 / −9,315, previousPoint "Algés (CNA) (partida)". **Rota ativa confirmada.**

### Acompanhado: "Segue"

"Parte agora pela rota a 3 MN a motor: chegas amanhã às 01:26 (de noite), vento até 9 nós, ondas até 2,8 m".

## Desvios e incertezas (para o plano e para o Ivo)

**Regras e cálculo**

1. **Mínimo à costa e 3 MN:** a regra mede a geometria da rota, só nos troços da linha (`costaLivre` falso), com 0,1 MN de tolerância.
   - Com o mínimo de 5 MN, a alternativa de 3 MN ficava sempre excluída, o que contradiz "3 MN só com vento de terra".
   - Resolvi assim: para a rota de 3 MN, que o `rotas.js` só gera com vento de terra, o mínimo é 3.
   - **O Ivo tem de confirmar.**
2. **Chegada de noite a porto desconhecido:** conta se o pessimista **ou** o provável chegam de noite. Os outros limites são só no pessimista, como o desenho diz.
3. **Horas ao leme:** as horas no porto e na aproximação a motor também contam. Sem ondas previstas nunca é "calma" (conservador).
4. **Horas contra o vento** (o desenho não as define): minutos com vento de 7 nós ou mais a ≤ 50° da proa.
5. **Partidas:** as de +3 h em diante são arredondadas à meia hora (por exemplo "Espera até amanhã às 06:30"). "Vela e motor" que nunca põe as velas em nenhum cenário é a mesma passagem que "só motor" e não se repete no top 3.
6. **Top 3 e veredictos:**
   - Com "so", as recomendadas vêm sempre à frente das "não recomendadas"; em "Sair agora" ordena-se só pelo custo.
   - Com tudo excluído, o veredicto é "Não recomendado", sem "sozinho" quando é acompanhado.
   - "Volta ou abriga-te em X" avalia só o abrigo mais perto (a 5 ou 8 MN, partida agora, vela). Com os dados reais não aparece; está testado com entradas sintéticas.

**Cenários e valores do resultado**

7. **Cenários:** como pedido.
   - Com o modelo `ventoForca`, o vento que decide é a razão P90/P50/P10 do modelo e a polar lê-se no vento do quantil contrário.
   - Sem `ventoForca`: 0,9 / 1 / 1,1. A direção vem do `ventoDirecao` (P50) ou fica a prevista.
   - `genoaPct` por rizos (100/70/50) e `ondasAnguloRel` calculado. Por isso o `passagem.js` passa `rumo` ao `consumo`; os resultados de 29/09 continuam iguais byte a byte.
8. `maximos` são os do provável e `maximosPessimista` vão à parte. `bateriaMin` é o SoC mínimo do pessimista. `gasoleoL.p90` é o maior dos 3 cenários: o pessimista pode ir mais à vela e gastar menos.

**Desistência e avisos**

9. **Desistência:**
   - os cabos detetam-se na geometria da rota fora dos portos (ligações e linha), e não só na linha de costa: de Cascais para norte, a ligação já dobra o Raso;
   - os nomes vêm de uma lista curta com posições aproximadas;
   - o vento da perna mede-se no rumo direto ao porto do abrigo.
   - **Limitação dos dados:** Algés, Oeiras e Cascais têm o mesmo `largo` (38,65 / −9,45). Dentro do rio, "voltar" dá a volta pelo Largo de Cascais e a ETA fica por excesso.
10. **Avisos:**
    - a chuva/radar usa < 5 km, como o desenho geral (o `passagem.js` só dá o evento abaixo de 3 km);
    - as manobras são detetadas por mudança da proa > 40° à vela, por isso uma mudança de perna grande à vela também conta como viragem ou cambadela;
    - inclui "come e bebe" de 3 em 3 h com "so" (do desenho geral).

**Dados, plugin e ambiente de desenvolvimento**

11. **Sem rede:** usa o arquivo (`lerArquivo`). O arquivo não tem `nivel`, por isso a maré da barra do Tejo fica a 0, com o aviso "Sem dados do mar: a corrente de maré na barra do Tejo fica a 0". Está testado no `index` (arquivo real escrito pelo plugin, 1 h depois).
12. **Instrumentos:**
    - SoC de `electrical.batteries.<bateria>.capacity.stateOfCharge`;
    - gasóleo de `tanks.fuel.<deposito>.currentVolume` (ou nível × capacidade);
    - `tendPressao3h` fica null: não há histórico do barómetro no plugin.
    - Sem SoC ou sem gasóleo assume 80% ou 100 L e avisa.
13. **O dev não tinha fornecedor de recursos:** a API de rotas dava 404. No npm local o `@signalk/resources-provider` fica içado para fora do `signalk-server`, como a página de administração, e o servidor não o encontra. Passou a dependência da `config` (1.5.2).
    - No Pi, com o OpenPlotter, já vem com o servidor, mas **convém confirmar lá** que está ligado.
14. `pointIndex: 1` na ativação (a partir do 1.º ponto de rota depois do cais).
15. O `index.js` não tem ainda `notifications.rota.*` nem o acompanhamento de 30 em 30 min: isso é da 3b.

**Desempenho**

- ~0,7 s para 17 partidas com a previsão de 29/09.
- 2–3 s ao vivo, com o pedido à Open-Meteo.
- O event loop cede entre partidas.

## Ronda C2: nova regra da calma (decisão do Ivo)

Commit **`818adc8`** (no clone, sem push).

### A regra

**Calma** = vento < 10 nós **e** (ondas < 2 m **ou** (ondas ≤ 3 m **e** período ≥ 9 s)).

- Fica numa só função nova, `seguranca.emCalma(p, opcoes)`, que o `horasLemeEquivalentes` usa.
- O `PADRAO` passa a ter `calmaVento: 10`, `calmaOndas: 2`, `calmaOndasLongas: 3` e `calmaPeriodo: 9`.
- Não há outra definição de calma no código. O comentário do `decisao.js` passa a remeter para `emCalma`.
- **Casos de fronteira** (a decisão não os diz; é a leitura mais conservadora):
  - acima de 2 m sem período conhecido não é calma;
  - sem ondas nunca é calma.

### O período das ondas

- **`lib/passagem.js`:** cada ponto da linha do tempo leva agora `periodo` (o `w.periodo` da previsão). Antes não o tinha.
- **O teste de reprodução do `simular.mjs`:** o resumo e os eventos continuam iguais byte a byte. Os 868 pontos comparam-se sem o campo novo `periodo`, porque a referência foi gravada com o código antigo. O teste verifica também que todos os pontos têm `periodo`.

### Testes (TDD: primeiro falharam, depois passaram)

Teste novo `calma (decisão do Ivo, C2)`:

| Caso | Resultado |
|---|---|
| 1,9 m com 4 s e sem período | calma |
| 2,8 m com 10 s | calma |
| 3 m com 9 s (os limites) | calma |
| 2,8 m com 6 s | não |
| 2,8 m sem período | não |
| 3,2 m com 12 s | não |
| 2 m com 8,9 s | não |

O teste das horas ao leme foi ajustado: com ondas de 1 m, sem ondas, e com vento de 10 nós.

### 29/09, Algés → Peniche, 15:32 locais

| Tripulação | Antes (C) | Agora (C2) |
|---|---|---|
| só eu | Não recomendado sozinho | **Espera até amanhã às 06:30** |
| acompanhado | Espera até amanhã às 06:30 | **Espera até amanhã às 06:30** (igual) |

**Só eu:** o veredicto passa a "espera" porque a melhor fica abaixo das 8 h equivalentes ao leme.

Porquê:
1. "Agora: rajadas até 34 nós no pior caso (limite 30 sozinho) e 14,2 h equivalentes ao leme (limite 8 h sozinho)."
2. "Partindo amanhã às 06:30, pela rota a 5 MN a motor: chegas amanhã às 21:22 (de noite), vento até 6 nós, ondas até 2,8 m."

| # | Partida | MN | Propulsão | Chegada P50 | Horas de noite | Leme eq. (provável) | Custo |
|---|---|---|---|---|---|---|---|
| 1 | 30/09 06:30 | 5 | só motor | 30/09 21:22 (noite) | 3,05 | 7,43 | **32,12** |
| 2 | 30/09 09:30 | 3 | só motor | 01/10 00:17 (noite) | 4,92 | 7,39 | 35,91 |
| 3 | 30/09 09:30 | 5 | só motor | 01/10 00:46 (noite) | 5,40 | 7,63 | 38,69 |

- As três são recomendadas.
- A partida de 30/09 às 03:30, a que chega de dia às 18:53, tem 8,4 h no pessimista, por isso é "não recomendada" e fica fora das três.

**Acompanhado:** o veredicto é igual ao de "só eu". O custo não conta o leme.

| # | Partida | MN | Propulsão | Chegada P50 | Horas de noite | Leme eq. | Custo |
|---|---|---|---|---|---|---|---|
| 1 | 30/09 06:30 | 5 | só motor | 30/09 21:22 (noite) | 3,05 | 7,43 | **24,69** |
| 2 | 30/09 03:30 | 5 | só motor | 30/09 18:53 (dia) | 4,05 | 8,40 | 25,79 |
| 3 | 30/09 06:30 | 8 | vela e motor (não chega a pôr as velas no provável) | 30/09 22:39 (noite) | 4,33 | 8,07 | 27,95 |

### As expectativas

- **Cumprem-se:** o veredicto de "só eu" é "Espera…", a melhor parte a 30/09 (esperar ganha), e o veredicto de "acompanhado" é igual.
- **"A melhor chega de dia" continua a não se cumprir** (a melhor chega às 21:22).
  - O teste `todo` foi **substituído** pela expectativa nova: `29/09 (só eu): esperar ganha — a melhor alternativa parte a 30/09 ou depois`, com a partida em hora de Lisboa ≥ 30/09 e `esperaH > 0`.
  - Isto fica explicado num comentário no teste.

### Corridas

- `npm test` da rota, 3 vezes: **82 testes, 82 pass, 0 fail, 0 todo**, de cada vez (~1,8 s).
- `software/dev npm test`: **tudo passa** (código de saída 0): rota 82 e pytest 54; os outros pacotes como antes.
