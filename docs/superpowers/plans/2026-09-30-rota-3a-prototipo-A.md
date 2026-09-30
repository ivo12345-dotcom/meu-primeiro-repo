# Protótipo 3a — parte A (Python, dados, fixtures): relatório

Clone: `scratchpad\proto-3a`, ramo `claude/piloto-automatico-cwnr0f` (sem push; config global não mexida; o repo real não foi tocado).

## Commits (no clone)

| SHA | O quê |
|---|---|
| `bc3847f` | AI: `juntar_previsao` escolhe, entre as previsões obtidas à mesma hora, a do ponto mais perto |
| `9304ade` | AI: modelos de planeamento (velocidade/consumo), células pelo `prevTws`, fixture JS nova, contrato do `modelos.js` |
| `9ce443f` | Costa: `ferramentas/costa` (UTM próprio + gerar + testes) e os ficheiros gerados do OSM |
| `80d3a5f` | Rota: fixture da previsão real de 29/09 |
| `05c04e7` | Rota: `zonas.json` e `destinos.json` |

## Testes

- `software/arlequin-ia`: **54 passed** com `-W error` (eram 47; +7 novos).
- `software/ferramentas/costa`: **18 passed** com `-W error` (4 da projeção e 14 da costa inventada).
- `software/signalk-arlequin-ia`: `npm test`, **34/34 pass**.

## 1. Ajustes à AI (`software/arlequin-ia`, `signalk-arlequin-ia`)

Ficheiros alterados: `arlequin_ia/treino.py`, `arlequin_ia/variaveis.py`, `arlequin_ia/fixture.py`, `tests/test_treino.py`, `tests/test_variaveis.py`, `signalk-arlequin-ia/lib/modelos.js`, `signalk-arlequin-ia/test/modelos.test.js` e `signalk-arlequin-ia/test/fixtures/velocidade.json.gz` (gerada de novo com `python -m arlequin_ia.fixture`).

**Modelo da velocidade:**
- As variáveis são exatamente `['prevTws','twaAbs','prevRajada','prevOndas','prevPeriodo','ondasAnguloRel','grandeRizos','genoaPct']`.
- O filtro é o de antes mais `prevTws.notna()`. O `tws` medido continua a ser exigido, porque a base (a polar) precisa dele.
- A base continua a ser a polar no `tws` medido. É a comparação mais exigente e é a melhor estimativa do vento corrigido que o planeador lhe passa como `stwPolar`.

**Modelo do consumo:** as variáveis são `['rpm','prevOndas','ondasAnguloRel']` e as outras regras ficam como estavam.

**`celulas` (a decisão):** as células passam a ser do **`prevTws`**, pela função nova `treino.chave_celula`.
- O planeador chama `pesoCelula` com o vento previsto em bruto, por isso a chave tem de usar a mesma variável.
- No JS, `preverVelocidade` passou a usar `x.prevTws`, e `pesoCelula(modelo, prevTws, twaAbs)` mudou o nome do parâmetro.
- Isto está escrito no contrato do `modelos.js`.

**Frases da velocidade:** passam a ser "a 66° com 11 nós previstos andas 5,3 nós (houve 13 nós; a polar dizia 6,6)". A polar é calculada no vento medido do grupo.

**`juntar_previsao`:** a escolha passou para a função nova `escolher_previsao`.
- Considera só as previsões com o ponto a 30 MN ou menos e obtidas antes da linha, até 12 h.
- Fica a de obtenção mais recente e, entre as da mesma hora, a do ponto mais perto.
- Há uma diferença deliberada em relação à letra do pedido: se a obtenção mais recente só tiver pontos longe demais, serve a anterior que esteja perto (a idade vai em `idadePrevH`). A letra do pedido dava NaN nesse caso. Está testado.

**Dados sintéticos:** o `sintetico.gerar` não precisou de mudança e os 4 modelos são aceites. Na velocidade, MAE 0,272 contra 0,398 da base. Aos 60° com 12 nós reais (10 previstos) prevê 5,25 nós, e o verdadeiro é 5,18.

**Testes cuja expectativa mudou, e porquê:**
- `test_encontra_o_barco_mais_lento_aos_60_graus`: a entrada passou a ser a previsão em bruto (`prevTws` 10, `prevRajada` 13) em vez do vento medido, e saíram as variáveis medidas. A tolerância de 4% ficou igual.
- `test_quantis_por_ordem_em_media`:
  - Com só `prevTws`/`twaAbs` e o resto a NaN, a média de P10 ficava acima da de P50: 4,75 contra 3,94.
  - Passei a dar as 8 variáveis, que no planeamento são todas conhecidas.
  - É uma mudança honesta de entrada, não um afrouxamento, mas mostra que **com nulls o modelo novo dá quantis cruzados**. O contrato JS avisa disso, e o `preverQuantis` já os ordena.
- `test_velocidade_so_a_vela_com_pelo_menos_uma_vela_em_cima`: a tabela do teste recebeu `prevTws=8`, porque o filtro agora exige previsão.
- JS `modelos.test.js`:
  - As chamadas de `preverVelocidade` passaram de `{tws}` para `{prevTws}`.
  - Acrescentei uma verificação de que o `tws` medido já não escolhe a célula.

**Testes novos (7):**
- os dois de `juntar_previsao`: 3 pontos obtidos à mesma hora; a mais recente contra a mais perto, e o recurso à anterior;
- as listas de variáveis;
- o filtro da velocidade sem previsão;
- sem previsões, a velocidade não aprende e o consumo aprende;
- as células pelo `prevTws`;
- as frases com "nós previstos".

**Diferença entre o desenho e o pedido:** o desenho (ponto 3) diz que também o consumo "só aprende em horas com previsão". O pedido mandava manter o filtro do consumo, e assim ficou. Com NaN nas ondas, o consumo aprende pelas rpm. Fica para o Ivo decidir.

## 2. A costa (`software/ferramentas/costa/`)

**Ficheiros:**
- `utm.py`: Transversa de Mercator/UTM 29N em numpy, pelas séries de Krüger até n⁴. Testada contra valores conhecidos (o meridiano central e os 45° N dão 4 982 950,400 m), ida e volta abaixo de 1e-8°, distâncias contra o `geographiclib` (instalado só para os testes) com erro abaixo de 0,1%, e conformidade.
- `gerar.py`: faz tudo. A docstring explica o uso.
  - descarrega o OSM se faltar;
  - lê com o pyshp e o filtro `bbox`;
  - junta os pedaços, passa para UTM e simplifica a terra a 50 m;
  - alarga a terra 3, 5 e 8 MN (`quad_segs=16`) e fica com o contorno exterior do pedaço maior;
  - corta pelo paralelo 41,87° N (o do lado do mar, o mais a oeste) e pelo meridiano 7,40° W (o mais a sul);
  - escolhe o arco que passa pelo ponto mais a oeste (o Cabo da Roca);
  - simplifica com Douglas-Peucker a **0,05 MN**.
  - Com 0,5 MN de tolerância a regra d ± 0,1 MN não se cumpria. Com 0,05 MN, os troços nas retas ficam de 0,9 a 1,5 MN (mediana) e há poucos pontos.
- `tests/test_utm.py`, `tests/test_gerar.py`, `pytest.ini` e `requirements.txt` (numpy, shapely, pyshp, pytest; geographiclib só nos testes).
- `pyshp` 3.1.6 instalado com `pip`.

**Testes com a costa inventada:**
- A costa inventada tem:
  - uma costa oeste que vira para leste num canto (como São Vicente);
  - um cabo em L;
  - uma baía de 2 MN de boca e 7 MN de fundo;
  - uma ilha a 5,5 MN;
  - uma ilha a 20 MN;
  - o continente partido em 2 pedaços, como no OSM;
  - um polígono fora da caixa.
- O que se verifica:
  - as linhas ficam a d ± 0,1 MN da terra, com amostras de 50 m em cada troço;
  - começam a norte e acabam no meridiano de fim, são simples e avançam sempre ao longo da costa;
  - contornam a ilha perto, a d do bordo oeste dela, e ignoram a longe;
  - a linha de 3 MN não entra na baía;
  - contornam o canto a d dele;
  - os ficheiros são escritos em lon/lat e [lat, lon], com 5 casas.

**Corrida real:**
- O OSM (928 MB em zip, 1,3 GB o `.shp`) está em `C:\Users\ivo12\Documents\dados-osm\`.
- Dentro da caixa há 558 pedaços com 101 mil vértices. A terra simplificada fica com 523 polígonos e 7905 vértices.
- Demorou cerca de 9 s.

**Verificações numéricas:**

| d | pontos | comprimento | distância à terra (mín–máx) | início | fim |
|---|---|---|---|---|---|
| 3 MN | 421 | 463,8 MN | 2,946–3,048 MN | 41,87 N 8,947 W | 37,113 N 7,40 W |
| 5 MN | 339 | 459,8 MN | 4,945–5,049 MN | 41,87 N 8,993 W | 37,080 N 7,40 W |
| 8 MN | 294 | 458,9 MN | 7,947–8,046 MN | 41,87 N 9,060 W | 37,030 N 7,40 W |

- **Cabo da Roca (38,7804 N):** a linha de 5 MN passa a **−9,607** (o esperado era ≈ −9,607). A de 3 MN passa a −9,564 e a de 8 MN a −9,671. As distâncias mínimas ao cabo são 2,98, 4,98 e 7,96 MN.
- **Cabo de São Vicente:** as distâncias mínimas são 3,01, 5,00 e 8,00 MN. As linhas dão a volta ao cabo e seguem pelo Algarve.
- **Peniche e Berlengas:**
  - Há 5,3 MN entre o Carvoeiro e a Berlenga, menos do que 2 × 3 MN. Por isso **as três linhas passam por fora das Berlengas, das Estelas e dos Farilhões**. A de 3 MN fica a 3,06 MN do Farilhão Grande, a de 5 MN a 5,14 e a de 8 MN a 8,16.
  - A linha de 3 MN faz um desvio grande: a norte de Peniche vai para NW à volta dos Farilhões e volta. Às 39,36 N cruza 3 vezes, entre −9,53 e −9,47.
  - **Nenhuma rota das linhas passa pelo Canal da Berlenga.** Vindo do sul para Peniche não interessa, porque o largo de Peniche fica a sul. Para Peniche → norte é preciso uma regra no `rotas.js` ou aceitar o desvio.
- **Barra do Tejo:** as linhas passam por fora e não entram no estuário (os buracos deitam-se fora). A de 3 MN entra na baía de Setúbal (a boca é larga) e cruza o paralelo de Espichel 3 vezes.
- As linhas não tocam na terra nem em nenhuma zona de `zonas.json`.
- **Tamanhos:** `terra.geojson.gz` tem 46,6 kB e `linhas-costa.json.gz` 7,6 kB.

## 3. Zonas e destinos (`software/signalk-arlequin-rota/dados/`)

### `zonas.json`

São 6 zonas, todas com `confirmado: false` e com `fonte`.

**Separadores de tráfego (Roca e São Vicente):**
- Vêm de dados oficiais da **DGRM** (`webgis.dgrm.mm.gov.pt/arcgis/rest/services/Plano_de_afetacao_eolicas/Eólicas_4wavec_geoportal/MapServer/19`, a camada "Esquemas Separacao Tráfego", pedida em outSR=4326).
- Cada polígono é a envolvente das vias e das zonas de separação, do limite interior ao exterior. A zona de tráfego costeiro fica de fora.
- Roca: vai de 38,565 a 38,865 N e de 9,68 a 10,23 W. **Os dados da DGRM acabam a norte em 38,8652 N.**
- São Vicente: o limite interior segue a zona costeira à volta do cabo.
- A mesma camada tem a "Área a evitar" das Berlengas (IMO, para navios). Inclui a costa de Peniche, por isso **não a usei**.

**Cachopo do Norte e Cachopo do Sul/Banco do Bugio:**
- Desenhei-os à mão sobre o extrato da carta IH 26303 (2005), na figura 1 do relatório APA/IDL de 2013 "Evolução morfodinâmica da região das Barras do Tejo".
- Georreferenciei a figura pelo Bugio, por São Julião e pelo porto de recreio de Oeiras: ~7,4 m/px, coerente nos dois eixos. As boias OSM n.º 1, 3, 5 e 7 do canal batem certo.
- Pus só as partes mais baixas (tom escuro, cerca de < 5 m ZH). O Cachopo do Norte leva 150 m de margem.
- **São aproximados, e os bancos mudam todos os anos.** O Overpass não tinha os baixios, só as boias.

**Berlengas e "Estelas e Farilhões":** envolvente convexa das ilhas do `terra.geojson` (OSM) mais 0,25 MN. A segunda inclui o mar entre as Estelas e os Farilhões.

### `destinos.json`

São os 15 portos pedidos, com `abrigo` e `conhecido` como mandado e `confirmado: false`.

**Campo novo, `entrada`:** é o índice do ponto à boca do porto ou da barra.
- A linha de costa do OSM **fecha os rios e várias bacias**: as marinas de Viana, Figueira, Lagos, Portimão, Vilamoura e Leixões ficam "em terra" (confirmei nos dados crus, não é da simplificação).
- Por isso os troços da `entrada` para dentro não se podem verificar contra a terra.
- **O `rotas.js` tem de saltar a verificação da terra a partir da `entrada`.** Isto muda o desenho ("cada troço não pode tocar em terra"), e o Ivo tem de o aprovar.

**Verificação com shapely (`scratchpad\validar_destinos.py`):**
- Todos os troços do largo até à `entrada` estão no mar e não tocam em nenhuma zona. As folgas mínimas à costa vão de 40 m (Nazaré, dentro do molhe) a vários km.
- Troços em terra do OSM dentro do porto:
  - só alguns metros (a ponta do cais): Peniche (85 m, com o cais dado pelo pedido), Cascais (18 m), Oeiras (22 m) e Algés (23 m, com o CNA na margem);
  - centenas de metros (o rio ou a bacia fechados pelo OSM): Viana, Leixões, Figueira, Nazaré, Lagos, Portimão, Vilamoura e Olhão (dentro da ria).
- Sesimbra, Setúbal e Sines não cortam terra em nenhum troço.

**Algés:** vai exatamente pelos pontos pedidos (Largo de Cascais → Largo de Carcavelos → Barra Norte → Algés).
- **O Largo de Carcavelos (38,663; −9,350) fica dentro da batimétrica dos 10 m do Cachopo do Norte**, pela carta 26303. Fica a ~100 m do polígono da parte baixa.
- A faixa "Barra Norte" da carta segue a ~38,675 N, rente a Carcavelos, com rumo ~282°. A reta dada vai a ~259°.
- Sugiro que o Ivo confirme na carta. Com ondulação de SW o mar rebenta sobre o Cachopo.

**Largos:** ficam a 0,65–3,1 MN da terra e a 1,9–4,4 MN da linha de 5 MN.

**Coordenadas dos portos:** vêm do conhecimento geral, ajustadas à vista da terra do OSM (mapas em `scratchpad\portos*.png` e `olhao.png`). Só confirmei na web a marina de Oeiras (38,6763; −9,3186). É tudo "por confirmar na carta".

**Scripts de geração** (no scratchpad, não estão no repo): `fazer_zonas.py`, `fazer_destinos.py`, `validar_destinos.py`, `mapas_portos.py` e `sanidade_costa.py`.

## 4. A previsão de 29/09 (`software/signalk-arlequin-rota/test/fixtures/previsao-2026-09-29.json.gz`, 12 kB)

**Conteúdo:**
- `{descricao, pontos, nomes, obtidaSimulada:'2026-09-29T14:00:00Z', pedidos (URLs completos), forecast:[9 respostas], marine:[9 respostas], sol:<resposta daily>}`
- **Pontos:** Algés; 6 pontos na linha de 5 MN, a ~9 MN uns dos outros (45,7 MN entre o largo de Cascais e o de Peniche); Peniche; Cascais (38,69; −9,42).
- **Pedido forecast:** `historical-forecast-api`, 29/09 a 01/10, horário, vento em nós, GMT. Veio completo, 72 h, sem nulls.
- **Pedido marine:** `marine-api`, as mesmas datas, com `cell_selection=sea` e `wind_speed_unit=kn`. Com isto, a corrente também vem em nós; sem ele vinha em km/h.
- **Sol a 38,9 N, 9,45 W:** nascer às 06:31 e 06:32 UTC; pôr às 18:23 e 18:22 UTC.

**O que a previsão diz (29/09, à tarde, a 39,1 N):** vento S de 21–22 nós com rajadas de 28–31. Rodou para N fraco na noite de 30/09.

**Ressalva:** o "arquivo histórico" da Open-Meteo cola as corridas sucessivas. **Não é a previsão emitida às 14h de 29/09**, por isso a obtenção é simulada. As horas depois de agora (30/09, 09h) vêm da corrida atual.

## Por confirmar / riscos

- **Cachopos:** aproximados. É preciso a carta 26303 atual.
- **O Largo de Carcavelos:** fica sobre o Cachopo do Norte (10 m).
- **O campo `entrada`:** saltar a verificação da terra dentro dos portos é uma mudança ao desenho.
- **O Canal da Berlenga:** nunca fica disponível pelas linhas.
- **As coordenadas das entradas e dos cais:** vêm de memória, ajustadas ao OSM, e é preciso confirmá-las todas. As de Olhão dentro da ria são as mais incertas.
- **O separador da Roca:** vai só até 38,865 N, tal como nos dados da DGRM.
- **O consumo:** continua a aprender sem previsão, o que difere do desenho (ponto 3).
- **Os nulls no modelo novo da velocidade:** dão quantis cruzados. O planeador tem de passar as 8 variáveis.
