# Protótipo 3a, parte B (Node: costa, rotas, previsão, maré, energia, passagem): relatório

Clone: `scratchpad\proto-3a`, ramo `claude/piloto-automatico-cwnr0f`. Sem push; a config global do git não foi mexida; o repo real não foi tocado.

## Commits (no clone)

| SHA | O quê |
|---|---|
| `51a4767` | `simular.mjs`: `--meteo`, `--guardar-meteo` e `--dia`; meteorologia de 29/09 gravada e resultado de referência gravado com o **código antigo** |
| `d2a4b6c` | Plugin novo (`package.json` com `file:../signalk-arlequin-ia`, `npm install` feito), `lib/costa.js` e testes |
| `0f9d8cd` | `lib/rotas.js` e testes |
| `a26ec99` | `lib/previsao.js` e testes |
| `2bbc90b` | `lib/mare.js` e testes |
| `d473d38` | `lib/energia.js` e testes |
| `f2f30af` | `lib/passagem.js` e testes; o `simular.mjs` passa a usar o motor |
| `92a9a0d` | `software/dev/package.json`: a rota entra no `npm test` e no `instalar` |

## Ficheiros

`software/signalk-arlequin-rota/`:
- `package.json`, `package-lock.json` (só o link `file:`);
- `lib/costa.js`, `lib/rotas.js`, `lib/previsao.js`, `lib/mare.js`, `lib/energia.js`, `lib/passagem.js`;
- `test/costa.test.js`, `test/rotas.test.js`, `test/previsao.test.js`, `test/mare.test.js`, `test/energia.test.js`, `test/passagem.test.js`;
- fixtures novas em `test/fixtures/`:
  - `meteo-simular-2026-09-29.json.gz` (3,9 kB): a meteorologia no formato do `simular.mjs`;
  - `simular-2026-09-29-resumo.json` (3,2 kB) e `simular-2026-09-29-passagem.json.gz` (114 kB): o resultado de referência.

Também mudaram:
- `software/ferramentas/passagem/simular.mjs`: exporta `simular(partida, met)` e só corre como programa se for chamado diretamente. O `relatorio.mjs` não mudou e continua a funcionar.
- `software/dev/package.json`.

## Assinaturas públicas (exatas)

Todas as posições são `{ lat, lon }`. `P()` também aceita `[lat, lon]`. As distâncias estão em MN e os tempos em ms UTC.

**`lib/costa.js`**
```
PASTA_DADOS
escalas(lat) → { kx, ky }                          // MN por grau (WGS84)
norm(a); dif(a, b); P(x)
vetor(a, b) → { mn, rumo }; distanciaMn(a, b); deslocar(p, rumo, mn) → { lat, lon }
distanciaSegmento(p, a, b) → { mn, t }; segmentosTocam(x1, y1, x2, y2, x3, y3, x4, y4); dentroAnel(p, anel)
prepararLinha(pontos) → { pts, s: Float64Array, total }
posicao(linha, s) → { lat, lon, s, i, rumo }
projetar(linha, p, { de = 0, ate = linha.total } = {}) → { lat, lon, s, i, rumo, dist }
juntar(linha, p, sentido, { de, ate, anguloMax = 60, passo = 0.1 } = {}) → { lat, lon, s, i, rumo, dist }
seguirLinha(linha, s1, s2, { passoMax = 2, tolerancia = 0.02 } = {}) → [{ lat, lon, s }]
criarCosta({ terra, linhas = {}, zonas = [], destinos = [] }, { celula = 0.05 } = {}) → costa
carregarCosta(pasta = PASTA_DADOS, opcoes) → costa
costa = { grelha, zonas, destinos, linhas, linha(d), emTerra(p), distanciaTerra(p, maxMn = 30),
          cruzaTerra(a, b), zonaCruzada(a, b) → zona | null,
          verificarTroco(a, b, { terra = true, zonas = true } = {}) → null | { motivo: 'terra' } | { motivo: 'zona', zona },
          verificarAproximacao(destino) → [{ troco, motivo, zona? }] }   // a terra só até à `entrada`
```

**`lib/rotas.js`**
```
RAIO_PORTO_MN = 0.5; AVISO_ROTA_ATIVA = 'último troço por confirmar na carta'
portoDePartida(costa, posicao, raioMn = 0.5) → destino | null          // cais a ≤ 0,5 MN
destinoDaRotaAtiva(costa, pontos, raioMn = 0.5) → { destino, aviso } | null
rumoParaTerra(costa, linha, s) → graus; ventoDeTerra(costa, linha, s, twd, tolerancia = 60) → bool
gerarRota(costa, { partida, destino, afastamento, twd, opcoes = {} })
  → { afastamento, pontos: [{ lat, lon, nome?, perna, costaLivre? }], milhas, excluida, motivo?, avisos[], sentido, linha: { de, ate } }
gerarRotas(costa, { posicao, destino, afastamentos = [3, 5, 8], twd, opcoes }) → [alternativa]
```
- `destino` pode ser `{ rotaAtiva: [...] }`.
- `twd` é um número ou uma função `(lat, lon)`.
- `perna` é o troço que chega ao ponto: `'porto'`, `'aproximacao'`, `'ligacao'` ou `'linha'`.

**`lib/previsao.js`**
```
MAX_PONTOS = 60; CASCAIS = { lat: 38.69, lon: -9.42 }; FORECAST; MARINE
pontosPrevisao(linha, { partida, destino, passoMn = 10, cascais = true }) → [{ lat, lon }]
urls(pontos, { horas = 48 } = {}) → [{ pontos, forecast, marine }]
interpretar(pontos, forecast, marine, obtida) → { obtida, inicio, fim, pontos: [{ lat, lon, t[], tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir, nivel }] }
async obterPrevisao({ pontos, agora = Date.now(), fetch = fetch, horas = 48 }) → previsao
criarTempo(previsao) → tempo(lat, lon, t) → { tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir }
nivelDoMar(previsao, ponto = CASCAIS) → { t, nivel, distanciaMn } | null
nomeArquivo(obtida, lat, lon); registoParte2(obtida, p)
guardarArquivo(pasta, previsao) → [caminhos]
lerArquivo(pasta, { pontos, desde, ate, agora = Date.now(), raioMn = 15, maxIdadeH = 48 })
  → { previsao, obtida, idadeH, aviso: null | 'aviso' | 'grande', texto } | { erro }
```
- `obterPrevisao` divide em grupos de 60 pontos. Se o pedido marine falhar, ondas e corrente ficam a `null`.
- `guardarArquivo` escreve `AAAA-MM-DDTHH-MM-<lat>_<lon>.json.gz` com 3 casas decimais, de forma atómica (`.tmp`, fsync, rename).

**`lib/mare.js`**
```
PADRAO = { lonLimite: -9.42, vMax: 1.8, dirVazante: 250, dirEnchente: 70, estofoMin: 45, periodoH: 12.42 }
preiaMares(t, nivel, { separacaoH = 6 } = {}) → [{ t, altura }]
criarMareTejo(preias, opcoes = {}) → correnteMare(lat, lon, t) → { v, dir }
```

**`lib/energia.js`**
```
PADRAO = { capacidadeAh: 200, socInicial: 1, consumoDiaA: 4.5, consumoNoiteA: 6, paineis: 2, areaPainelM2: 1.65, rendimento: 0.2, tensaoV: 12.7, alternadorA: 45 }
solarA(config, radiacao)
criarEnergia(opcoes = {}) → { config, inicio(t, soc = config.socInicial), passo(estado, { dtMs, motor, noite, w | radiacao }) → { estado, soc, corrente, solar } }
```

**`lib/passagem.js`**
```
PADRAO = { rpmCruzeiro: 2100, stwMotor: 4.3, stwMotorRio: 4.8, fatorLeme: 0.85, fatorMarVela: true, fatoresRizos: [1, 0.95, 0.9],
           corredor: 0.7, bolinaMin: 45, popaMax: 155, anguloPopa: 25, limiarVentoMotor: 7, stwMinVela: 3,
           rizo1: { rajada: 20, tws: 16 }, rizo2: { rajada: 27, tws: 22 }, motorNasAproximacoes: true,
           chegadaWpMn: 0.15, chegadaPassagem: true, gasoleoInicial: 124, maxHoras: 30, fuso: 'Europe/Lisbon',
           textoPartida: null, nomeChegada: null }
simularPassagem({ rota, partida, tempo, correnteExtra, velocidadeVela, consumo, noite, energia, distanciaCosta, opcoes = {} })
  → { pontos: [{ t, costa, lat, lon, proa, cog, sog, stw, tws, rajada, twd, ondas, chuva, vis, motor, soc, gasoleo, rizos, noite, wp, mare }],
      eventos: [{ t, texto, tipo }],
      resumo: { partida, chegada, chegou, duracaoH, milhas, horasVela, horasMotor, horasNoite, gasoleoGasto, socFinal, socMin,
                ventoMax, rajadaMax, ondasMax, viragens, cambadelas, horasLemeSeguidas, costaMinMn } }
  velocidadeVela({ twa, twaAbs, tws, twd, rizos, w, t, lat, lon, rumo }) → STW (nós, antes dos fatores do leme, do mar e dos rizos)
  consumo({ rpm, w, t }) → L/h;  noite(t) → bool;  correnteExtra(lat, lon, t) → { v, dir }
  energia: { inicio(t) → estado, passo(estado, { t, dtMs, motor, noite, sog, w }) → { estado, soc, eventos? } }
noitePeloSol(nasceres[], pores[]) → noite(t)
vetor(a, b); xte(a, b, p)
```

## Testes

- `npm test` em `signalk-arlequin-rota`, 3 vezes seguidas: **44/44 de cada vez**, em cerca de 220 ms. Também passa com `TZ=UTC` e com `TZ=America/New_York`.

| Ficheiro | Testes |
|---|---|
| `costa` | 10 (6 com geometria inventada, 4 com os dados reais) |
| `rotas` | 8 |
| `previsao` | 8 |
| `mare` | 4 |
| `energia` | 4 |
| `passagem` | 10 (a reprodução do simular, 8 do motor em ambiente inventado, os cenários) |

- `cd software/dev && npm test`: **tudo passa**:
  - energia 33;
  - simulador 16;
  - ais 4;
  - ecrã 60;
  - j1939 31;
  - gasóleo 31;
  - água 9;
  - porto 23;
  - caixa negra 52;
  - sincronizar 18;
  - ia 34;
  - **rota 44**;
  - pytest 54.

**Verificações com os dados reais:**
- Lisboa é terra.
- 38,7 N; 9,6 W é mar, a 5,34 MN da terra.
- A Berlenga é terra.
- Algés → Barra Norte passa com a exceção da `entrada`. Sem ela, o troço Barra Norte → CNA toca na terra do OSM.
- Os 15 portos passam na verificação.
- As linhas medidas com as distâncias do `costa.js` dão:
  - 3 MN: 2,948–3,046;
  - 5 MN: 4,946–5,050;
  - 8 MN: 7,949–8,048.
  - Coincidem com a ronda A.

## A reprodução do `simular.mjs` (resultado de referência)

**Meteorologia:**
- É a Open-Meteo, com o mesmo URL do `simular.mjs` mas com `start_date=2026-09-29&end_date=2026-09-30` em vez de `forecast_days=2`, gravada com `--dia 2026-09-29 --guardar-meteo`.
- A previsão ao vivo de 29/09 já não existe. Esta vem das corridas arquivadas, que foram coladas umas às outras.
- A partida é a 29/09 às 15:32 locais.
- O resultado de referência foi gravado com o **código antigo**. Correr outra vez a partir do ficheiro dava resultados iguais, byte a byte.

| | Antigo (referência) | Novo (motor extraído) |
|---|---|---|
| chegada | 2026-09-30T05:00Z (06:00 locais) | igual |
| duração | 14,4667 h | igual |
| milhas | 61,3506 MN | igual |
| vela / motor / noite | 8,97 / 5,50 / 10,62 h | igual |
| gasóleo | 7,15 L; SoC final 98,9% (mínimo 90,2%) | igual |
| vento máx. / rajada / ondas | 18,6 nós / 26,4 / 2,68 m | igual |
| cambadelas / mínimo à costa | 4 / 1,077 MN | igual |

- **Diferença de 0,000%.** O `resumo.json` e o `passagem.json` novos são **byte a byte iguais** aos antigos (verificado com `cmp`).
- O teste verifica os ±2% pedidos e também a igualdade exata do resumo (com os eventos) e dos 868 pontos.
- O teste fixa `process.env.TZ = 'Europe/Lisbon'`, porque o `simular.mjs` usa horas locais.
- A energia do `simular.mjs` continua a ser a do simulador (440 Ah e os alarmes do plugin da energia), através de um adaptador `{ inicio, passo }`. Não usa o `lib/energia.js`, para o resultado não mudar.

## Preia-mares encontradas (Cascais, fixture de 29/09, Open-Meteo `sea_level_height_msl`)

| UTC | Altura (m) |
|---|---|
| 2026-09-29 03:06 | 1,13 |
| **2026-09-29 15:23** | 1,12 |
| 2026-09-30 03:45 | 1,02 |
| 2026-09-30 16:05 | 0,86 |
| 2026-10-01 04:27 | 0,79 |
| 2026-10-01 16:55 | 0,59 |

- A da tarde de 29/09 sai **14 min antes** da tabela usada no `simular.mjs` (16:37 locais, ou seja 15:37 UTC).
- Com a sinusoide sintética, as horas saem com erro abaixo de 0,3 min.

## Rotas e os três cenários (29/09, Algés → Peniche)

**Comprimento das rotas geradas:**
- 3 MN: 59,04 MN (com vento de terra, 45°; com vento 090° fica excluída, porque à saída a costa de Cascais corre E–W);
- **5 MN: 62,66 MN**;
- 8 MN: 67,44 MN.

**Condições dos cenários:**
- Partida às 15:32 locais.
- Previsão da fixture de 29/09.
- Maré pelas preia-mares acima.
- `modelos.preverVelocidade(null, …)`, ou seja, a polar.
- `preverConsumo(null, …)`, ou seja, a curva da Volvo a 2100 rpm.
- `lib/energia.js` com SoC 0,9.
- `distanciaCosta` real.

**Totais:**

| Cenário | Chegada (UTC) | Horas | MN simuladas | Vela / motor / noite | Gasóleo | Vento / rajada máx. |
|---|---|---|---|---|---|---|
| pessimista | 07:04 (08:04 locais) | 16,53 | 63,75 | 7,6 / 8,9 / 12,2 h | 12,9 L | 18,4 / 33,8 |
| provável | 06:15 | 15,72 | 63,89 | 7,9 / 7,8 / 11,9 h | 11,3 L | 17,1 / 30,7 |
| otimista | 05:24 | 14,87 | 63,95 | 7,8 / 7,1 / 11,0 h | 10,3 L | 16,7 / 27,6 |

- Ficam **por ordem** na duração, no gasóleo e no vento máximo, e o teste verifica-o.
- O nascer do sol é às 06:32 UTC. O provável e o otimista chegam de noite; o pessimista chega de dia.

**Definição usada para os cenários (fica no teste; é uma proposta):**
- O vento que decide (rizos, motor abaixo de 7 nós, máximos) é o do cenário: pessimista × 1,1, provável × 1, otimista × 0,9.
- A velocidade à vela é `preverVelocidade(…)[p10 | p50 | p90]` sobre a polar no vento × 0,9, × 1 e × 1,1 respetivamente.
- Porquê: sem modelo, P10 = P50 = P90 = polar no vento corrigido. Com a polar no vento P90, o pessimista **andava mais depressa**, porque mais vento dá mais velocidade na polar.
- O gasóleo é P90, P50 e P10.

## Desempenho

| Operação | Tempo |
|---|---|
| `carregarCosta` | 6 ms |
| `distanciaTerra` | ~0,008 ms por chamada |
| `cruzaTerra` de troços longos | ~0,003 ms |
| `gerarRotas` (3 alternativas, Algés → Peniche) | 8 ms |
| Algés → Lagos | < 300 ms (testado); na prática ~40 ms por alternativa |
| `simularPassagem` (~940 passos de 1 min) sem `distanciaCosta` | **1,4 ms** |
| `simularPassagem` com `distanciaCosta` a cada minuto | **11,3 ms** |
| `simular.mjs` completo | 11,8 ms por passagem |

- Com a distância à costa a cada minuto, o tempo vai quase todo para ela.
- Nota para o plano: 3 afastamentos × ~17 partidas × 2 propulsões × 3 cenários ≈ 300 passagens. Dá cerca de 3,5 s com a costa a cada minuto, ou 0,4 s sem ela.

## Desvios ao desenho e incertezas (para o plano e para o Ivo)

1. **Juntar-se à linha "à frente":**
   - É o ponto mais perto cujo troço faz ≤ 60° com a linha no sentido da viagem (`anguloMax`; com 90° é o pé da perpendicular). A saída para o largo do destino é simétrica.
   - **A correção do desenho** (tentar os pontos seguintes até 5 MN) só resolve um obstáculo junto à linha, como um ilhéu. **Um cabo não se resolve assim**: avançar torna o troço mais íngreme e corta ainda mais o cabo.
   - Por isso, depois disso, tenta ligar **mais de lado**, do ponto à frente até à perpendicular. Os dois casos estão testados: "cabo" corrigido pelo lado e "ilhéu" corrigido pelo avanço.
2. **Motor nas aproximações** (`motorNasAproximacoes: true`, como diz o desenho):
   - Em Algés significa ~10 MN a motor até ao largo de Cascais. O `simular.mjs` só ia a motor no rio.
   - Os troços da `entrada` para dentro (perna `'porto'`) vão a 4,8 nós (`stwMotorRio`).
   - **O Ivo tem de decidir** se a aproximação toda vai a motor.
3. **`chegadaPassagem` (novo):** um ponto de rota conta quando é passado, não só a 0,15 MN. É preciso com os pontos de 2 em 2 MN da linha e com os bordos. O `simular.mjs` passa `false`.
4. **O `costaMinMn` da simulação inclui os bordos e as cambadelas do corredor de ±0,7 MN.**
   - Na rota de 5 MN dá **4,5 MN**: há bordos ao largo da Ericeira, embora o contador de viragens diga 0 (é a lógica do `simular.mjs`).
   - A regra "mais perto do que o afastamento mínimo" do `seguranca.js` deve medir a geometria da rota, e não o rasto simulado. Em alternativa, o corredor pode ficar só do lado do mar.
5. **Eventos novos:**
   - "Nascer do sol (HH:MM): ecrã em modo dia";
   - "Partida de noite (…)";
   - "Motor ligado (aproximação)" e "Motor ligado (dentro do porto)";
   - alarmes vindos de `energia.passo(...).eventos`.
   - Os textos do `simular.mjs` mantêm-se todos. As horas vão em Europe/Lisbon, através de `Intl`.
6. **A polar e a curva da Volvo não estão no plugin:**
   - Os testes vão buscá-las por caminho relativo: `arlequin-ecra/public/lib/polar.js` (ESM) e o CSV, e `signalk-arlequin-j1939/lib/consumo.js`.
   - O plano tem de decidir: copiar para `rota/dados`, depender por `file:` ou ler por caminho configurável.
7. **Nascer e pôr do sol:** o `previsao.js` não os pede. A fixture traz o `sol` à parte, e o `noitePeloSol` precisa deles. É preciso acrescentar `daily=sunrise,sunset` ao pedido forecast, ou calculá-los.
8. **Previsão:**
   - Uso `forecast_hours=48`, que começa na hora atual, em vez de `forecast_days`.
   - O `tempo()` fica nas pontas fora do intervalo; `inicio` e `fim` vão no objeto.
   - O arquivo da Parte 2 não tem chuva, visibilidade, radiação, corrente nem nível do mar. Por isso, **sem rede não há maré do Tejo**, a menos que se arquive também o `nivel` (um campo a mais no formato).
   - No arquivo, `lerArquivo` escolhe para cada ponto a obtenção mais recente dentro de 15 MN e, dentro dela, o ponto mais perto. A idade é a da mais velha escolhida.
   - Também lê os ficheiros do plugin da AI.
9. **Distâncias:** um plano local com as escalas do elipsoide WGS84. A esfera errava 0,3% de leste para oeste, 0,015 MN a 5 MN, o que falhava a verificação dos 4,9 MN. Os cruzamentos fazem-se em graus, o que é exato para projeções afins.
10. **Partida e destino com o mesmo largo** (Oeiras → Algés): vai direto de largo a largo, 17,6 MN pelo largo de Cascais. É uma questão dos dados em `destinos.json`.
11. **3 MN com vento de terra:**
    - Avalia-se no ponto onde a rota se junta à linha. A normal para terra é o lado com a terra mais perto a 1 MN.
    - Sem vento previsto, a alternativa fica excluída.
    - Em Peniche o largo fica em cima da linha de 3 MN, e a terra (a península) fica a NE.
12. **Zonas:** ficam como `{ motivo: 'zona', zona }`. Os pontos intermédios das aproximações não têm nome em `destinos.json`, por isso ficam `wp: null` na linha do tempo e sem evento de chegada.
13. **Config de desenvolvimento:** não acrescentei a rota a `software/dev/config/package.json`. Ainda não há `index.js`, e o SignalK falhava ao carregá-la. Entrou no script `test` e no `instalar` (que faz o `npm install` da rota).
14. **`package-lock.json`:** a rota tem um, só com o link `file:`. Os outros plugins não têm, porque não têm dependências.
