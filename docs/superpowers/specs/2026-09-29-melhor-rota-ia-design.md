# Melhor rota com AI e caixa negra: desenho

Data: 29/09/2026 · Barco: Arlequin (Jeanneau Melody 34) · Aprovado por partes pelo Ivo nesta data.

## Objetivo

Quando o Ivo carrega em **"Calcular melhor rota"** no ecrã da roda, o sistema:

1. junta **todos** os dados: instrumentos em tempo real, estado do barco, previsão, corrente e maré, costa, e quem vai a bordo;
2. gera e simula várias alternativas;
3. devolve as **3 melhores lado a lado**, com um veredicto (segue / espera / não recomendado sozinho / volta ou abriga-te), **avisos** e **precauções**.

O barco **aprende a navegar** com uma AI (LightGBM) treinada a bordo com os dados reais. Uma **caixa negra** grava tudo desde o primeiro dia, para o Claude analisar a fundo pelo Tailscale e melhorar os modelos.

A decisão é sempre do Ivo. O botão **"Sair agora mesmo assim"** dá a melhor rota para partir já, mesmo contra a recomendação.

## Decisões do Ivo (29/09)

| Tema | Decisão |
|---|---|
| Resposta da melhor rota | **Alternativas lado a lado + veredicto** (opção C) |
| Aprendizagem | **AI a sério a bordo** (opção C). Dentro dela o Claude escolheu LightGBM com margens, validação e versões |
| Dados para o Claude | **Tailscale.** O Ivo dá rede ao Pi com o telemóvel (ou com o RUT241) |
| Destino | **Lista no ecrã + rota ativa do OpenCPN** no topo da lista |
| Arquitetura | **Opção 1:** caixa negra (Node) + treino em Python + previsões e rota em Node |
| Guardar dados | **Desde o 1.º dia, nunca apagar sozinho.** Aos 80% do SSD passa o mais antigo para o **portátil** (opção B), só depois de confirmado |
| Limites "não recomendado sozinho" | vento médio > **22 nós**, rajadas > **30**, ondas > **3 m**, > **8 h** equivalentes ao leme (motor em calma conta metade, a roda tem travão), chegada de noite a porto desconhecido |
| Sair contra a recomendação | Botão **"Sair agora mesmo assim"** |
| Rotas costeiras | **Por fora**, afastamento mínimo **5 MN** por defeito |

## Arquitetura

```
 instrumentos ─► SignalK ─┬─► signalk-arlequin-caixanegra ─► ~/arlequin-dados/{bruto,tabela,saidas,previsoes}
                          │                                          │
                          │                         arlequin-ia (Python, no porto) ─► ~/arlequin-dados/modelos/*
                          │                                          │
                          └─► signalk-arlequin-rota ◄── modelos (JSON), previsão (Open-Meteo + cache), costa OSM
                                     │  ▲
                        REST /calcular │  │ notifications.rota.*  ──► alarmes do ecrã (regras de apito aprovadas)
                                     ▼  │
                              arlequin-ecra: página "Melhor rota" (+ botões das velas, cartão AI no Diário)

 portátil ◄── Tailscale (ssh) ── ferramentas/sincronizar: copia, verifica (sha256) e confirma ao Pi
```

**Princípio:** o Python só é preciso para **aprender**. As previsões dos modelos são feitas em JavaScript, a partir do ficheiro JSON do LightGBM. Se o Python falhar, a melhor rota continua a funcionar com o último modelo bom ou com a polar de origem.

## Parte 1: Caixa negra (`software/signalk-arlequin-caixanegra/`)

Plugin SignalK. Grava **desde o primeiro dia** em `~/arlequin-dados/`:

| Pasta | Conteúdo | Formato |
|---|---|---|
| `bruto/` | **todas** as mensagens do servidor: todos os contextos (o próprio barco e os do AIS), valores dos plugins, notificações | NDJSON comprimido (gzip), 1 ficheiro por hora `AAAA-MM-DDTHH.ndjson.gz` |
| `tabela/` | tabela de treino, 1 linha a cada 10 s (colunas abaixo) | CSV comprimido, 1 ficheiro por dia |
| `previsoes/` | cada previsão descarregada (o plugin rota escreve aqui), com a hora a que foi obtida | JSON comprimido |
| `saidas/` | resumo por saída (deteção: motor ligado e o barco a mais de 0,5 MN do porto) | JSON |

- **Subscreve tudo o que passa no servidor**, e não só as ligações de entrada, porque os valores calculados pelos plugins também contam. O registo de dados de raiz do SignalK pode ficar ligado em paralelo para guardar o NMEA em bruto.
- **Colunas da tabela:** hora, lat, lon, proa, COG, SOG, STW, TWS, TWA, TWD, AWS, AWA, rajada (máximo de 2 min), adorno, caimento, pressão, rotação do motor, consumo L/h, estado das velas (`grandeRizos`, `genoaPct`), previsão para o sítio e a hora (vento, rajada, direção, ondas, período, direção das ondas, corrente), profundidade, SoC, `simulado`, `estavel`.
- **`estavel`:** 2 min seguidos com a proa a variar menos de 10°, sem viragem ou cambadela, STW acima de 1 nó, a mais de 0,5 MN de qualquer porto e sem alarme de sensor.
- **`simulado`:** fica verdadeiro quando os dados vêm do `arlequin-simulador`, pela fonte ou porque o plugin está ativo. **Nunca entra no treino.**
- **Estado das velas:** novos botões grandes na página "Velas":
  - Grande: inteira, 1 rizo, 2 rizos, arriada;
  - Genoa: 100%, 70%, 50%, enrolada;
  - publicados em `sails.grande.rizos` e `sails.genoa.percentagem` (caminhos próprios, documentados);
  - se o vento real mudar mais de 40% sem mudança nas velas, aparece ao fim de 1 h um lembrete discreto "as velas continuam assim?".
- **Disco:**
  - **aos 80%**: aviso no ecrã, e os ficheiros de `bruto/` já **confirmados no portátil** podem ser apagados, os mais antigos primeiro;
  - **aos 95%** sem nada confirmado: deixa de gravar `bruto/` (a tabela continua), com aviso no ecrã e Telegram;
  - **nunca** apaga ficheiros não confirmados. `tabela/`, `previsoes/`, `saidas/` e `modelos/` nunca se apagam.
- **REST:**
  - `GET /estado` (disco, ficheiros, última gravação);
  - `GET /ficheiros?desde=`;
  - `POST /confirmados` (lista `{ficheiro, sha256}` enviada pelo portátil; o Pi verifica o hash antes de marcar como confirmado).

### Sincronização com o portátil (`software/ferramentas/sincronizar/`)

- Script Node no portátil. Liga-se ao Pi por **ssh via Tailscale** e usa o OpenSSH do Windows (`ssh`/`scp`).
- Copia para `C:\Users\ivo12\Documents\Veleiro\arlequin-dados\` (fora do git) tudo o que for novo.
- Calcula o sha256 dos dois lados e só então faz `POST /confirmados`.
- Mostra um resumo: ficheiros, MB, saídas novas.
- **Tailscale:** a conta e o primeiro login no Pi e no portátil são feitos **pelo Ivo**. O Claude não trata credenciais. Os passos ficam escritos no `NAVEGACAO.md`.
- Recomendação (a decisão é do Ivo): incluir a pasta `arlequin-dados` na cópia de segurança do Windows ou no OneDrive. Depois dos 80%, o portátil passa a ser a única cópia dos dados antigos.

## Parte 2: AI (`software/arlequin-ia/`, Python)

### Modelos

Todos são LightGBM com **regressão por quantis: P10, P50 e P90** (pessimista, provável, otimista).

| Modelo | Alvo | Variáveis |
|---|---|---|
| `velocidade` | STW | TWS, \|TWA\|, rajada, ondas (altura, período, ângulo relativo), adorno, rizos, genoa %, rotação do motor (0 à vela) |
| `vento` | razão TWS medido/previsto e diferença de direção | quadrícula de 0,1° (~6 MN), TWS e TWD previstos, hora do dia, idade da previsão, tendência de 3 h do barómetro |
| `consumo` | L/h de gasóleo (J1939) | rotação, STW, altura das ondas, ângulo às ondas |

### Treino

- Usa só linhas com `estavel` verdadeiro, `simulado` falso e sensores sem alarme.
- **Quando:**
  - sozinho, no porto, com o motor parado há 1 h e dados novos desde o último treino;
  - ou com o botão **"Treinar agora"** (cartão AI no Diário).
- O plugin da rota lança `python -m arlequin_ia treinar` como processo filho, com prioridade baixa (`nice`).
- **Validação:** a **última saída** fica de fora e serve de teste. Não se baralham linhas soltas, porque linhas seguidas são quase iguais e o teste ficaria contaminado.
- **Aceitação:** o modelo novo só passa a ser o atual se o erro P50 (MAE) na última saída for **≤** ao do modelo atual. Se não, fica guardado mas não é usado.
- **Arranque do zero:** o 1.º modelo precisa de pelo menos 5 h de dados estáveis. Antes disso usa-se a polar de origem.
- **Versões:**
  - `modelos/<nome>/v0001.json`, … e `modelos/<nome>/atual` (aponta para a versão em uso);
  - `modelos/registo.json` com a data, as horas de dados, as métricas e se foi aceite;
  - voltar a uma versão anterior é um toque no cartão AI.
- **Revisão pelo Claude:** pelo Tailscale, com o histórico todo. Pode limpar dados, criar variáveis e treinar de novo. O modelo que fizer passa **pelo mesmo teste de aceitação**.

### Previsões dos modelos (em Node, `signalk-arlequin-rota/lib/modelos.js`)

- Lê o JSON (`dump_model` do LightGBM) e percorre as árvores.
- **Mistura com a polar de origem:**
  - `peso = min(1, horasNaCelula / 2)`;
  - as células são de TWS (2 nós) × TWA (15°);
  - resultado = `peso·AI + (1−peso)·polar`.
- **Limites de sanidade:**
  - a velocidade fica entre 40% e 120% da polar;
  - a correção do vento fica entre 0,5× e 1,5×, e a direção até ±40°;
  - o consumo fica entre 50% e 200% da curva Volvo.
- **Cartão AI no Diário:**
  - horas aprendidas, erro atual e versão;
  - 3 frases do que aprendeu, por exemplo "a 60° com 15 nós andas 5,4 nós (a polar dizia 6,1)";
  - botões "Treinar agora" e "Voltar à versão anterior".

**A AI nunca mexe nas regras de segurança da Parte 3.**

## Parte 3: Melhor rota: cálculo (`software/signalk-arlequin-rota/`)

### Recolha

| Fonte | O quê |
|---|---|
| Instrumentos | posição, proa, SOG/STW, vento real e rajada (e tendência de 30 min), adorno, pressão e tendência de 3 h (`lib/barometro`), profundidade, velas |
| Barco | gasóleo (plugin gasóleo), SoC e autonomia (energia), água, motor (horas, alarmes J1939), AIS à volta (CPA) |
| Previsão | Open-Meteo forecast (vento, rajada, chuva, visibilidade) e marine (ondas, período, direção, **corrente SMOC com maré**), 48 h, pontos a cada ~10 MN ao longo da zona. **Cache** em `previsoes/`: sem rede usa a última e indica a idade. Corrigida pelo modelo `vento` |
| Terra | **costa OpenStreetMap** (polígonos de terra recortados para a costa portuguesa, preparados no portátil, alguns MB) + `zonas.json` editável: Cachopos (barra do Tejo), Berlengas e Farilhões, separador de tráfego da Roca + `destinos.json`: portos e fundeadouros com os pontos de **aproximação** (ex.: barra norte do Tejo) e se são conhecidos do Ivo |
| Ivo | destino, **tripulação (só eu / 2 ou mais)**, afastamento mínimo (5 MN) |

### Alternativas (cerca de 24)

- **Afastamento:** {3 (só se abrigar do vento ou do mar), 5, 8} MN.
  - A rota é uma linha paralela à costa a essa distância, com as aproximações de partida e de chegada.
- **Partida:** {agora, +3 h, +6 h, melhor janela em 48 h}.
- **Propulsão:** {vela com motor abaixo de 7 nós, só motor}.
- **Simulação:** o motor da passagem de `ferramentas/passagem/simular.mjs` passa para `lib/passagem.js` (função pura). O `simular.mjs` passa a importá-lo.
  - Usa os modelos (P10/P50/P90) em vez da polar fixa.
  - Mantém: rizos por limiares, popa até 155° com cambadelas em corredor de ±0,7 MN, bordos contra o vento, noite, chuva e visibilidade, energia e gasóleo.

### Segurança (regras fixas, só o Ivo as muda)

- **Excluída sempre:** passa em terra, numa zona a evitar ou no separador de tráfego, ou mais perto da costa do que o afastamento mínimo (fora das aproximações).
- **Excluída (vira aviso vermelho em "Sair agora mesmo assim"):** gasóleo < 40 L ou bateria < 50% à chegada, no cenário **P10**.
- **"Não recomendada sozinho"** (só com tripulação "só eu"): vento médio > 22 nós, rajadas > 30, ondas > 3 m, > 8 h equivalentes ao leme (o motor em calma, com vento < 10 nós e ondas < 1,5 m, conta a metade), chegada de noite a porto marcado como desconhecido.

### Decisão

- **Custo** = horas de viagem + 0,25 × horas de espera até partir + 1,5 × horas de noite + 1,0 × horas ao leme (só eu) + 0,5 × (rajada máxima − 20, se positivo) + 2 × (onda máxima − 2 m, se positivo) + 0,5 × horas contra o vento.
  - **Esperar ganha quando poupa mais risco do que tempo.**
  - **Horas ao leme (decidido pelo Ivo a 29/09, opção b):** sem piloto contam todas as horas, à vela e a motor. **As horas a motor em calma (vento < 10 nós e ondas < 1,5 m) contam a metade**, porque a roda tem travão e dá para pausas curtas. Isto vale para o limite das 8 h e para o custo.
- **Exemplo (29/09, só eu):**
  - partir agora por fora: 14,3 + 0 + 15,6 + 14,3 + 3,5 + 1,2 + 0 = **48,9**. O motor depois da meia-noite apanha ondas de 2,5 m, por isso não conta como calma. Tem 14,3 h equivalentes ao leme, o que a marca como "não recomendada sozinho";
  - amanhã às 08:00 a motor: 12,2 + 4,1 + 1,4 + 6,1 + 0 + 0 + 0 = **23,8**. São 12,2 h a motor em calma, que equivalem a 6,1 h ao leme, abaixo das 8 h;
  - veredicto: **"Espera até amanhã às 08:00"**.
- **Mostra as 3 de menor custo.**
- **Veredicto:**
  - **Segue:** a melhor parte agora e não é "não recomendada".
  - **Espera até às HH:MM:** a melhor parte mais tarde.
  - **Não recomendado sozinho:** todas as de partida próxima estão marcadas.
  - **Volta ou abriga-te em X:** já no mar, e continuar é "não recomendado" enquanto um abrigo próximo não é.
  - O veredicto vem sempre com 1–2 frases de porquê.
- **"Sair agora mesmo assim":**
  - recalcula só com partida imediata;
  - inclui as "não recomendadas" e mostra a de menor custo;
  - reforça as precauções;
  - junta **pontos de desistência**: até que hora ainda se volta à partida com margem, e qual o abrigo mais perto em cada troço.
- **Acompanhamento:** com uma rota ativa, a cada 30 min compara a realidade com o plano. Com o vento a mais de ±30% do previsto, ou a chegada a atrasar mais de 30 min, surge o aviso "recalcula". **Nunca muda a rota sozinho.**

### REST

- `POST /calcular {destino, tripulacao, sairAgora}` devolve `{id}`. O cálculo corre em segundo plano, e `GET /resultado/:id` dá o progresso e o resultado.
- `POST /ativar {id, alternativa}`: grava a rota na API de recursos do SignalK e ativa-a na API de rumo (v2). O OpenCPN mostra-a.
- `POST /plano-telegram {id, alternativa}`: por evento para o plugin porto, que envia para o chat do Ivo e para os contactos autorizados na configuração.
- `GET/POST /destinos`: acrescentar a posição atual ou coordenadas.
- `POST /treinar`, `GET /ia` (estado da AI), `POST /ia/voltar`.

## Parte 4: Ecrã, avisos e precauções

### Página "Melhor rota" (`arlequin-ecra/public/paginas/melhor.js`)

| Estado | Mostra |
|---|---|
| **Pedir** | botão "Calcular melhor rota"; lista de destinos (rota ativa do OpenCPN no topo, portos, "+ acrescentar"); **só eu / 2 ou mais** |
| **A calcular** | progresso: "previsão das HH:MM (há X min), corrigida pela AI v000N · 24 alternativas" |
| **Resultado** | faixa do veredicto (cor por tipo) + 3 cartões (nome, chegada P50 com margem P10–P90, milhas, horas de vela, motor, noite e leme, vento, rajada e ondas máximos, gasóleo, bateria mínima; a recomendada destacada) + avisos em linha de tempo + precauções com caixas para marcar + botões **Ver no mapa**, **Enviar plano por Telegram**, **Ativar esta rota**, **Sair agora mesmo assim** |
| **Mapa** | costa, rota, rasto previsto por cor (vela ou motor, noite), marcas dos avisos e dos pontos de desistência |
| **Leme** (com rota ativa) | o modo atual (rumo a seguir, bordos, VIRA AGORA) + faixa "próximo: rizar às 22:50 (daqui a 25 min)" + "Recalcular" |

- O modo noite e o tamanho de letra são os já aprovados para o ecrã. A maquete foi mostrada ao Ivo a 29/09.

### Avisos (`notifications.rota.*`, regras de apito já aprovadas)

- **30 min antes de cada evento do plano:** rizar ou largar rizo, chuva ou visibilidade < 5 km (radar), rotação do vento > 45° ou frente, pôr do sol (luzes, arnês, comer), cambar ou virar, chegada de noite.
- **Só eu:** "come e bebe" de 3 em 3 h ao leme.
- **Desvio do plano:** vento medido contra previsto > ±30%, chegada a atrasar > 30 min, o que dá "recalcula".
- **Recursos:** gasóleo ou bateria a caminho da reserva antes do destino.
- **Previsão velha:** > 6 h aviso; > 12 h aviso grande "confia nos instrumentos e no barómetro".
- **Barómetro:** queda > 3 hPa em 3 h, com o aviso "o tempo pode piorar antes do previsto".

### Precauções (lista de verificação por alternativa, não bloqueia nada)

| Sempre | Condicionais |
|---|---|
| VHF no canal 16 | noite ou só eu: arnês e linha de vida montada |
| telemóvel carregado | popa (TWA > 120°): retenida na retranca |
| plano deixado a alguém em terra | chuva ou visibilidade: radar ligado e luzes |
| estado da barra (Capitania) | rajadas > 20 antes da barra: rizo feito à saída |
| | frente ou vento a cair: prender a retranca, motor pronto |
| | "Sair agora mesmo assim": precauções do nível acima + pontos de desistência |

### Falhas

| Falha | Comportamento |
|---|---|
| Sem rede | usa a cache com a idade visível |
| Sem previsão nenhuma | só instrumentos e tendência, com margem larga e aviso |
| AI sem modelo ou com erro | polar de origem, com "AI: a aprender" |
| Sem GPS | não calcula e explica porquê |
| Destino sem aproximação | pede para confirmar o último troço no OpenCPN |

## Testes e validação

- **Node (`node:test`):**
  - `modelos.js`: árvore de exemplo com resultado conhecido, limites e mistura por horas;
  - `passagem.js`: os resultados de hoje têm de bater com `simular.mjs`;
  - `alternativas.js`, `seguranca.js` (cada regra), `decisao.js` (custo e os 4 veredictos, e "sair agora");
  - `avisos.js`, `acompanhamento.js`;
  - `costa.js`: pontos em terra e no mar, distância, zonas;
  - caixa negra: rotação de ficheiros, `estavel` e `simulado`, 80% e 95%, e nunca apagar o que não foi confirmado, com um disco falso.
- **Python (`pytest`):**
  - dados sintéticos com uma polar conhecida: o modelo recupera-a dentro da margem;
  - um modelo pior é rejeitado;
  - `simulado` nunca entra no treino;
  - o export JSON é lido pelo `modelos.js` com o mesmo resultado (teste cruzado).
- **Integração no SignalK local:**
  - replay da passagem, e a caixa negra grava com `simulado`;
  - um treino com o marcador de teste produz um modelo;
  - `/calcular` com uma **previsão gravada** (a de 29/09, fixa para os testes serem repetíveis) dá "Espera até amanhã às 08:00" sozinho e mostra "Sair agora" com os pontos de desistência;
  - o ecrã é verificado no browser em todos os estados, de dia e de noite.
- **Sincronização:** pastas locais a fazer de "Pi", hashes, e confirmação só depois da verificação.

## Fora de âmbito (por agora)

- Piloto automático (EV-100): quando vier, o rumo da rota ativa vai para o piloto.
- Meshtastic (só depois do sistema validado).
- Estado das barras automático (AMN): fica como precaução manual.
- Isócronas contínuas: o OpenCPN Weather Routing continua disponível à parte.
- Modelos de anomalia (motor, energia) e um LLM a bordo.

## Dependências e custos

- **Sem custos novos de material.** Pi 5 8 GB e SSD 256 GB já estão na lista.
- **Tailscale:** plano gratuito, conta criada pelo Ivo.
- **Software livre:**
  - Python 3 no Pi (`lightgbm`, `pandas`, `numpy`);
  - polígonos de terra do OpenStreetMap (osmdata.openstreetmap.de), recortados no portátil.
