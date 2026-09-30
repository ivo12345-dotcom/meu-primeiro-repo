# Melhor rota, Parte 3a (o cálculo): desenho

Data: 30/09/2026 · Barco: Arlequin (Jeanneau Melody 34) · Aprovado por secções pelo Ivo nesta data.

Continua o desenho geral `docs/superpowers/specs/2026-09-29-melhor-rota-ia-design.md` (Partes 3 e 4). Esse desenho mantém-se, exceto no que este documento muda.

A Parte 3 foi dividida em duas:
- **3a, o cálculo** (este documento);
- **3b, o ecrã e os avisos**: a página "Melhor rota" nova, o mapa, os avisos durante a viagem, o acompanhamento de 30 em 30 min, as precauções e o plano por Telegram. Terá desenho e plano próprios, e só começa depois de a 3a estar validada.

## Objetivo

Um plugin SignalK, `signalk-arlequin-rota`, que, dado um destino e a tripulação:
1. junta os instrumentos, a previsão ao longo da costa, a maré, a costa, as zonas a evitar e o estado do barco;
2. gera e simula as alternativas (afastamento × hora de partida × propulsão), cada uma em três cenários (pessimista, provável, otimista);
3. aplica as regras de segurança fixas e devolve as 3 melhores, o veredicto e o porquê, os avisos da viagem e os pontos de desistência;
4. tem também o "Sair agora mesmo assim";
5. serve tudo por REST e ativa no SignalK a rota escolhida, para o OpenCPN a mostrar.

**A navegação nunca depende do Python:** usa os modelos da AI através de `signalk-arlequin-ia/lib/modelos.js`.

## Decisões do Ivo (30/09)

| Tema | Decisão |
|---|---|
| Divisão da Parte 3 | 3a (cálculo) primeiro, 3b (ecrã e avisos) depois |
| Variáveis que só se medem (adorno, balanço, rajada medida) | **Opção A:** os modelos de planeamento usam **só o que se sabe antes de partir**. O balanço da IMU fica gravado para um futuro "mar real contra mar previsto" |
| Zona coberta | **Toda a costa continental**, de Caminha a Vila Real de Santo António |
| Arquitetura | **Plugin próprio em Node** + linhas de costa **pré-calculadas no portátil** (Python e shapely) |
| Segurança | Limites avaliados no **cenário pessimista** do vento corrigido pela AI (mais conservador do que o desenho original) |

## Ajustes à Parte 2 (AI), incluídos neste plano

1. **Modelos de planeamento** em `software/arlequin-ia/arlequin_ia/treino.py`:
   - **velocidade**: variáveis `prevTws` (vento previsto corrigido, em nós), `twaAbs`, `prevRajada`, `prevOndas`, `prevPeriodo`, `ondasAnguloRel`, `grandeRizos`, `genoaPct`. Saem `tws` medido, `rajada` medida, `adornoAbs`, `balAdorno` e `balCaimento`.
     - Para aprender com a velocidade real contra o vento previsto, o treino usa o `prevTws` da linha, que é a **previsão em bruto**, sem a correção da AI.
     - Linhas sem previsão não entram no treino. Assim a AI aprende "com esta previsão, andaste X".
     - No planeamento, este modelo recebe também a **previsão em bruto**. A correção do vento (`ventoForca`/`ventoDirecao`) serve para a polar, as regras de segurança, a decisão do motor e o que se mostra ao Ivo, mas **não entra no modelo da velocidade**, para não ser contada duas vezes.
   - **consumo**: variáveis `rpm`, `prevOndas`, `ondasAnguloRel`. Saem `stw` e `balCaimento`.
   - **ventoForca** e **ventoDirecao**: sem mudança, porque já usam só variáveis previstas.
   - O comentário do contrato em `signalk-arlequin-ia/lib/modelos.js` é atualizado. A fixture do avaliador JS é gerada de novo.
2. **Previsões de vários pontos à mesma hora:** a rota guarda um ficheiro por ponto. O `juntar_previsao` (`variaveis.py`) passa a escolher, entre as previsões com a mesma hora de obtenção (a mais recente antes da linha), **a do ponto mais perto da linha**, dentro do limite de 30 MN. Hoje escolhe uma qualquer.
3. **Aviso para o Ivo:** com isto, os modelos da velocidade e do consumo só aprendem em horas com previsão arquivada. Precisam de rede no barco pelo menos de vez em quando, porque a previsão é arquivada sempre que há rede.

## Arquitetura

```
 portátil (uma vez)                              Pi (sempre)
 ferramentas/costa (Python, shapely)             signalk-arlequin-rota (Node)
   OSM land polygons → recorte PT ──┐              ├─ lib/costa.js      (ponto em terra, distâncias, cruzamentos, seguir linhas)
   afastar 3/5/8 MN → linhas ───────┼─► dados/ ──► ├─ lib/rotas.js      (gerar a geometria de cada alternativa)
   simplificar ~0,5 MN              │  (gzip,     ├─ lib/previsao.js   (Open-Meteo vários pontos + guardar em previsoes/)
 zonas.json, destinos.json ─────────┘   no repo)  ├─ lib/mare.js       (preia-mar de Cascais pelo nível do mar → corrente na barra do Tejo)
                                                  ├─ lib/passagem.js   (motor da simulação, extraído do simular.mjs)
                                                  ├─ lib/energia.js    (bateria simplificada)
                                                  ├─ lib/seguranca.js  (regras fixas)
                                                  ├─ lib/decisao.js    (custo, 3 melhores, veredicto, sair agora)
                                                  ├─ lib/desistencia.js(abrigos ao longo da rota)
                                                  ├─ lib/avisos.js     (eventos da viagem → avisos; precauções por alternativa)
                                                  └─ index.js          (REST, cálculo em segundo plano, ativar rota)
                                                        │ require
                                                  signalk-arlequin-ia/lib/modelos.js  (previsões da AI, limites de sanidade)
```

- **`software/ferramentas/passagem/simular.mjs`** passa a usar `lib/passagem.js`. Os resultados da passagem de 29/09 têm de se manter, com teste.
- O plugin da rota declara `"signalk-arlequin-ia": "file:../signalk-arlequin-ia"` no `package.json`.

## Dados pré-calculados (`software/signalk-arlequin-rota/dados/`)

| Ficheiro | Conteúdo |
|---|---|
| `terra.geojson.gz` | polígonos de terra do OSM (continente e ilhas costeiras) recortados a 36,8°–42,2° N e 10,5°–6,9° W, simplificados a ~50 m |
| `linhas-costa.json.gz` | `{ "3": [...], "5": [...], "8": [...] }`: para cada afastamento, uma polilinha `[lat, lon]` de norte para sul (contorno exterior da terra afastada; não entra nos rios), simplificada a ~0,5 MN |
| `zonas.json` | zonas a evitar: `{ nome, tipo: "baixio" \| "ilhas" \| "separador", poligono: [[lat, lon], …], fonte, confirmado: false }` |
| `destinos.json` | portos e fundeadouros: `{ id, nome, abrigo: bool, conhecido: bool, largo: [lat, lon], aproximacao: [[lat, lon], …] (do largo até ao cais), notas, confirmado: false }` |

- **A ferramenta `software/ferramentas/costa/gerar.py`:**
  - descarrega do osmdata.openstreetmap.de os polígonos de terra (`land-polygons-split-4326`, cerca de 800 MB, só uma vez, para uma pasta fora do repositório);
  - recorta, afasta numa projeção em metros (UTM 29N), extrai o contorno exterior, ordena de norte para sul e simplifica;
  - escreve os ficheiros. Tem testes com uma costa inventada, por exemplo um cabo em forma de L.
- **Listas iniciais, preparadas pelo Claude. O Ivo confirma-as na carta e marca `confirmado: true`:**
  - **zonas:** Cachopos (barra do Tejo), Berlengas, Estelas e Farilhões, separador de tráfego do Cabo da Roca, separador de tráfego do Cabo de São Vicente;
  - **portos:** Viana do Castelo, Leixões, Figueira da Foz, Nazaré, Peniche, Cascais, Oeiras, Algés (CNA), Sesimbra, Setúbal, Sines, Lagos, Portimão, Vilamoura e Olhão.
  - No ecrã (3b), destinos e zonas por confirmar aparecem marcados como tal.

## Geração das rotas (`lib/rotas.js`)

Para cada afastamento d ∈ {3, 5, 8} MN:
1. **Saída:** a `aproximacao` do porto de partida, ao contrário (do cais ao largo). Se o barco já estiver a mais de 0,5 MN de qualquer porto, parte da posição atual.
2. **Juntar-se** à linha de d MN no ponto mais perto que fique à frente, no sentido da viagem.
3. **Seguir a linha** até ao ponto mais perto do `largo` do destino, com pontos de rota de 2 em 2 MN no máximo.
4. **Entrada:** a `aproximacao` do destino.
5. **Verificação:** cada troço não pode tocar em `terra` nem em `zonas`.
   - Se um troço de ligação (passos 2 ou 4) cortar terra, tenta o ponto seguinte da linha, até 5 MN.
   - Se não houver forma, a alternativa é **excluída** com o motivo ("não há passagem a 3 MN entre X e Y").
- **3 MN só com vento de terra:** no troço inicial, a direção do vento previsto vem do lado de terra da linha (a normal à linha que aponta para terra, ±60°).
- **Destino pela rota ativa do OpenCPN:** o último ponto da rota ativa é o destino. Se não for um `largo` da lista (a mais de 0,5 MN), o último troço vai direto e a alternativa leva o aviso "último troço por confirmar na carta".

## Previsão ao longo da rota (`lib/previsao.js`)

- **Um pedido forecast e um pedido marine à Open-Meteo, com vários pontos** (até 60 por pedido):
  - os pontos são os da linha de 5 MN a cada ~10 MN entre a partida e o destino, mais a partida e o destino;
  - variáveis horárias, 48 h, UTC, vento em nós:
    - forecast: `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `precipitation`, `visibility`, `shortwave_radiation`;
    - marine: `wave_height`, `wave_period`, `wave_direction`, `ocean_current_velocity`, `ocean_current_direction`, `sea_level_height_msl` (este só para Cascais).
- **Interpolação:** cada posição e hora da simulação usa o ponto de previsão mais perto no espaço e interpola linearmente no tempo. Os ângulos são interpolados por seno e cosseno.
- **Arquivo:** cada ponto é guardado em `previsoes/AAAA-MM-DDTHH-MM-<lat>_<lon>.json.gz`, no formato da Parte 2 (`{obtida, lat, lon, horas, tws, rajada, twd, ondas, periodo, ondasDir}`), para a AI aprender.
- **Sem rede:** usa as previsões guardadas mais recentes que cubram a rota. A idade vai no resultado:
  - mais de 6 h: aviso;
  - mais de 12 h: aviso grande;
  - sem nenhuma que cubra: não calcula e explica porquê.
- **Correção pela AI** (`modelos.preverVento`): cada ponto e hora dá o vento P10, P50 e P90 e a direção corrigida.

## Maré na barra do Tejo (`lib/mare.js`)

- **Preia-mares de Cascais:** os máximos locais da série `sea_level_height_msl` no ponto de Cascais (38,69 N; 9,42 W), com uma interpolação parabólica à volta do máximo horário.
- **Corrente na barra** (a leste de 9°25' W): o modelo do `simular.mjs`, com a preia-mar calculada em vez da hora fixa. Corrente máxima de 1,8 nó, vazante para 250°, enchente para 70°, estofo 45 min depois da preia-mar.
- **Ao largo:** a corrente da Open-Meteo.

## Simulação (`lib/passagem.js`)

- **Função pura** `simularPassagem({ rota, partida, previsao, mare, modelos, polar, barco, cenario })`. Passos de 1 min.
- **Velocidade à vela:** `modelos.preverVelocidade(modelo, x, stwPolar)`.
  - O `x` leva as variáveis de planeamento da secção "Ajustes à Parte 2", com o vento previsto em bruto.
  - `stwPolar` é a polar no vento **corrigido** (P50, ou o do cenário).
  - Os rizos e a genoa decidem-se pelos limiares da simulação atual (rizo com rajadas > 20 nós, 2 rizos com rajadas > 26).
- **Motor:**
  - **Quando entra:** com o vento corrigido abaixo de 7 nós, quando a velocidade à vela prevista fica abaixo de 3 nós, ou nas aproximações de saída e entrada.
  - **Regime:** `rpmCruzeiro` configurável, **2100** por omissão (a simulação de 29/09 usava 2000; o teste de reprodução passa 2000).
  - **Velocidade na água:** a da simulação atual, 4,3 nós × fator de mar (4,8 nós no rio), configurável.
  - **Gasóleo:** de `modelos.preverConsumo`, ou da curva da Volvo, nessas rotações.
- **Cenários:**
  - **pessimista:** P10 da velocidade, P90 do vento e P90 do gasóleo;
  - **provável:** P50 de tudo;
  - **otimista:** P90 da velocidade, P10 do vento e P10 do gasóleo.
- **Mantém-se do `simular.mjs`:** popa até 155° com cambadelas em corredor de ±0,7 MN, bordos contra o vento, noite pelo nascer e pôr do sol, chuva e visibilidade.
- **Energia (`lib/energia.js`):**
  - parte do SoC atual;
  - consumo de serviço de 4,5 A de dia e 6 A de noite;
  - solar = radiação × área × rendimento (2 × 305 W, 1,65 m² cada, 20%);
  - alternador a 45 A com o motor ligado;
  - banco de serviço de 200 Ah.
  - Todos os valores são configuráveis no plugin.
- **Saída:** a linha do tempo (posição, vento, velocidade, motor, rizos, noite, SoC, gasóleo), os eventos (rizar, chuva, noite, motor, cambadela, chegada) e os totais.

## Segurança (`lib/seguranca.js`, regras fixas, a AI não as muda)

- **Excluída sempre:** um troço em terra, numa zona a evitar ou no separador de tráfego, ou mais perto da costa do que o afastamento mínimo (5 MN, configurável) fora das aproximações.
- **Excluída** (em "Sair agora" passa a aviso vermelho): gasóleo < 40 L ou bateria < 50% à chegada, no **cenário pessimista**.
- **"Não recomendada sozinho"** (só com "só eu"):
  - vento médio > 22 nós, rajadas > 30 ou ondas > 3 m, no **cenário pessimista**;
  - mais de 8 h equivalentes ao leme (o motor em calma, com vento < 10 nós e ondas < 1,5 m, conta metade);
  - chegada de noite a um porto com `conhecido: false`.

## Decisão (`lib/decisao.js`)

- **Custo** (cenário provável) = horas + 0,25 × horas de espera + 1,5 × horas de noite + 1,0 × horas ao leme (só eu) + 0,5 × (rajada máxima − 20)⁺ + 2 × (onda máxima − 2)⁺ + 0,5 × horas contra o vento.
- **Partidas:** agora, +3 h, +6 h, e a melhor janela de 3 em 3 h até +48 h.
  - Cada partida é combinada com os afastamentos e a propulsão (vela com motor abaixo de 7 nós, ou só motor).
  - Passagens que acabem depois do fim da previsão ficam de fora.
- **3 melhores** por custo, entre as não excluídas.
- **Veredicto:** Segue / Espera até às HH:MM / Não recomendado sozinho / Volta ou abriga-te em X, com 1–2 frases de porquê.
  - "Volta ou abriga-te em X" só aparece se o pedido vier já no mar (a mais de 0,5 MN de um porto).
- **"Sair agora mesmo assim":** só com partida imediata, inclui as "não recomendadas" e junta os pontos de desistência.

## Pontos de desistência (`lib/desistencia.js`)

- **Onde:** de 5 em 5 MN, e ao passar cada cabo (os pontos da linha de costa onde o rumo roda mais de 30°).
- **O que se calcula em cada um:** o abrigo mais perto da lista (`abrigo: true`), a distância, a hora a que lá se chega (motor a 2100 rpm, cenário provável) e o ângulo ao vento previsto dessa perna ("a favor", "de través", "contra").
- **Resumo:** "até às HH:MM ainda voltas a X com vento a favor" (último ponto em que voltar à partida tem vento a favor ou de través).

## REST (`/plugins/signalk-arlequin-rota`)

| Rota | Pedido e resposta |
|---|---|
| `POST /calcular` | pedido `{ destino, tripulacao: "so" \| "acompanhado", sairAgora: bool }` → `202 { id }`. O cálculo corre em segundo plano; um de cada vez (409 se houver outro a correr) |
| `GET /resultado/:id` | `{ estado: "a calcular" \| "pronto" \| "erro", progresso, resultado? , erro? }` |
| `GET /destinos`, `POST /destinos` | ler e acrescentar destinos: posição atual ou coordenadas, com nome; `conhecido` e `abrigo` escolhidos pelo Ivo |
| `POST /ativar { id, alternativa }` | grava a rota na API de recursos do SignalK (`/signalk/v2/api/resources/routes`) e ativa-a na API de rumo v2 (`/signalk/v2/api/vessels/self/navigation/course/activeRoute`) |

**`resultado`:**
- `veredicto: { tipo, texto, porque[] }`;
- `alternativas: [3 × { id, nome, afastamento, partida, propulsao, chegada: {p10, p50, p90}, milhas, horas: {vela, motor, noite, leme}, maximos: {vento, rajada, ondas}, gasoleoL: {p50, p90}, bateriaMin, chegadaNoite, excluida?, naoRecomendada?, motivos[], rota: [[lat, lon]…], eventos[], avisos[], precaucoes[] }]`;
- `desistencia[]`, `previsao: { obtida, idadeH }`, `ia: { versoes }`.

## Falhas

| Falha | Comportamento |
|---|---|
| Sem GPS | não calcula e explica porquê |
| Sem previsão que cubra a rota | não calcula e explica porquê |
| Previsão velha | calcula e avisa |
| Plugin da AI ausente ou modelo ilegível | polar e curva da Volvo, com a nota "AI: a aprender / indisponível" |
| Erro no cálculo | `estado: "erro"` com a mensagem; nunca derruba o servidor, porque tudo corre dentro de try/catch e as promessas acabam em `.catch` |

## Testes e validação

- **`ferramentas/costa`:** pytest com uma costa inventada (um cabo em L e uma ilha): a linha a d MN está a d ± 0,1 MN da terra, não entra na baía estreita e contorna a ilha.
- **Node, com `node:test`:**
  - `costa` (ponto em terra, cruzamentos, seguir a linha);
  - `rotas` (Algés → Peniche a 5 MN nunca a menos de 4,9 MN depois de Cascais; o troço que corta um cabo é corrigido);
  - `previsao` (vários pontos, interpolação, nomes dos ficheiros);
  - `mare` (preia-mar de uma série sinusoidal conhecida);
  - `passagem`:
    - reproduz o `simular.mjs` de 29/09 dentro de ±2% na distância e na hora de chegada, com a mesma rota e previsão;
    - os três cenários ficam por ordem;
  - `energia`;
  - `seguranca` (cada regra, e o cenário pessimista);
  - `decisao` (custo; os 4 veredictos; "sair agora");
  - `desistencia`;
  - `index` (REST com fetch e SignalK falsos).
- **Previsão de 29/09 gravada:** vem do arquivo histórico de previsões da Open-Meteo (previsão emitida em 29/09, por volta das 14h UTC) e fica em `test/fixtures/`. Com ela:
  - Algés → Peniche, só eu, a partir às 15:32, dá "não recomendado sozinho" ou "espera", e a melhor alternativa chega de dia;
  - com "acompanhado", o veredicto é igual ou melhor.
- **Ao vivo:** SignalK local com o simulador:
  - `/calcular` Algés → Peniche com a previsão real do dia;
  - o resultado é visto e avaliado pelo Claude;
  - `/ativar` e confirmação no SignalK de que a rota fica ativa.

## Fora de âmbito (3b ou mais tarde)

- A página "Melhor rota" nova, o mapa, os avisos durante a viagem (notificações), o acompanhamento e o recálculo, a lista de precauções no ecrã e o plano por Telegram. Tudo isto é a **3b**.
- A correção do mar real contra o previsto, com a IMU.
- As rotas fora da costa continental.
- As isócronas.
