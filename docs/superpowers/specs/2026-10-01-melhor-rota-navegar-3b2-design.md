# Melhor rota 3b-2 — "A navegar": plano ativo, avisos, acompanhamento e contactos

Data: 01/10/2026. Desenho aprovado pelo Ivo por secções, nesta conversa.

Parte do desenho geral `2026-09-29-melhor-rota-ia-design.md` (Parte 4: avisos e acompanhamento). Assenta na 3a (`2026-09-30-melhor-rota-calculo-design.md`) e na 3b-1 (`2026-10-01-melhor-rota-ecra-3b1-design.md`), já feitas.

> **Nota (auditoria, 05/10):** este é o desenho que manda para "A navegar". As decisões que vieram
> depois de aprovado estão na tabela abaixo, com a data; o que o código faz e o texto não dizia está
> nas "Notas de implementação (01–02/10)" e nas "Notas de implementação (auditoria, 02–03/10)", no
> fim. Onde o texto e as notas diferem, valem as notas. As frases velhas ficam no sítio, com uma nota.

## Decisões do Ivo

| Tema | Decisão |
|---|---|
| Onde corre | No **plugin da rota, no Pi** (abordagem A): funciona com o ecrã desligado e sobrevive a reinícios |
| Avisos para o Telegram | **Só os importantes**, e só para o chat do Ivo: recalcula, recursos, previsão com mais de 12 h, barómetro. Os lembretes de evento e o "come e bebe" ficam só no ecrã |
| Contactos em terra | **Chegada e atrasos automáticos**: "cheguei bem" à chegada, e "ainda a navegar, nova hora de alarme" quando a chegada passa 30 min ou mais da "mais tarde" do plano (decisão do Ivo de 01/10; depois, no máximo 1× por hora) |
| Mudança de rota | Nunca muda a rota sozinho. "Recalcular" é um botão; ativar outra rota substitui o plano |
| Ver a chegada mesmo em pausa (01/10, revisão) | Em pausa, a chegada ao cais do plano continua a contar (a mesma regra) → "cheguei bem" normal. Em pausa e parado (SOG < 0,5 nó) 30 min a menos de 0,3 MN de **outro** porto da lista, o ecrã pergunta "Chegaste a X? Enviar 'cheguei bem a X'" com um botão; só envia com o toque (`POST /plano-ativo/chegada { destino }`) |
| Recalcular no mar (01/10, revisão) | A navegar (ou em pausa no mar), o Recalcular pede só a partida imediata (`sairAgora: true`), com o "Volta ou abriga-te em X" e os pontos de desistência; à espera de sair, todas as partidas |
| Atrasos para terra: "só a avançar + teto de 3 h" (02/10, revisão final C1) | O "Ainda a navegar, tudo bem…" automático só sai com o barco a avançar na rota: ≥ 1 MN de progresso na rota na última hora e a ≤ 2 MN da rota. A hora de alarme nunca passa sozinha 3 h da do plano; daí para a frente só com o **Estou bem** do Ivo no ecrã. Parado ou à deriva, não sai nada e fica a hora de alarme que terra tem (ver "Contactos em terra") |
| Chegada com progresso real (01–02/10, revisões) | A chegada ao cais só conta depois de feito o caminho: ≥ 50 % das milhas da rota; em pausa, ter estado a pelo menos min(1 MN, metade da linha reta até ao destino) da partida e ter saído 0,5 MN do cais; numa rota com menos de 1 MN, ter saído 0,5 MN do cais e 5 min "a navegar". Ficar no cais logo à saída nunca é "cheguei bem" |
| Plano novo limpo (01/10, revisão) | Um plano novo começa limpo (avisos, fila, marcas); só herda as mensagens para terra do anterior que ainda interessam ("cheguei bem", "viagem terminada", avisos ao Ivo). Os 5 últimos planos fechados ficam em `planos-fechados.json` |
| O atraso só conta quando é entregue (01/10, revisão) | A hora de alarme que terra tem só muda com o que lhe chegou: o "em vez de" de uma mensagem é sempre a última hora que esse contacto recebeu |
| Auditoria (02/10): Ativar com um cálculo antigo (decisão n.º 13) | O Ativar recusa (422) um cálculo antigo, como o envio; um envio já fechado nunca se reaproveita |
| Auditoria (02/10): hora de alarme por contacto (n.º 14) | Cada contacto tem a sua hora de alarme (a do que lhe chegou); o aviso de 60 min conta pela **mais cedo** |
| Auditoria (02/10): plano enviado e nunca ativado (n.º 15) | Aviso 60 min antes da hora de alarme que terra tem: "ativa-o ou avisa-os" |
| Auditoria (02/10): contacto que nunca recebe (n.º 16) | Desistir no fim da hora de alarme desse envio para esse contacto; o Ivo é avisado pelo Telegram ("desisti de entregar a X"); todas as mensagens de fecho levam a data |
| Auditoria (02/10): relógio do Pi (n.º 19) | Com a hora do Pi a mais de 60 s da do GPS: aviso no ecrã (também no Leme), sem "Enviar plano" e sem o ciclo a navegar |
| Auditoria (02/10): apito (n.º 2) | Contínuo só para o perigo imediato (colisão AIS, fumo, água no porão e bomba de porão, fuga de gasóleo, motor a sobreaquecer); todos os avisos da rota com o apito curto |

## Arquitetura

- Fica tudo dentro de `software/signalk-arlequin-rota`, num módulo "a navegar":
  - `lib/plano-ativo.js`: ciclo de vida, gravação e reinício;
  - `lib/acompanhamento.js`: atraso, eventos deslizados, desvio do vento e recursos;
  - `lib/avisos-navegar.js`: as regras de cada aviso, em funções puras com relógio injetado;
  - `lib/contactos.js`: as mensagens para terra e a fila sem rede.
- Corre de **minuto a minuto** (`setInterval` no plugin).
  - Lê do SignalK: posição, SOG, vento real (`environment.wind.speedTrue`), pressão (`environment.outside.pressure`), gasóleo, SoC do banco de serviço e a rota ativa (API de rumo v2).
  - Publica os avisos em `notifications.rota.*`.
- **Encaminhamento:**
  - **Ecrã:** já mostra estas notificações com as regras de apito aprovadas.
  - **Telegram do Ivo:** o plugin porto, com dois ajustes no `lib/mensagens.js`:
    - `notifications.rota.lembrete.*` e `notifications.rota.comer` entram na lista `NUNCA` (só ecrã);
    - `notifications.rota.previsao` entra na lista `SO_ALARME`. Abaixo das 12 h é aviso (`warn`); acima é alarme (`alarm`) mas sem apito contínuo: `method: ['visual','sound']` com o apito curto (ver "Apitos").
  - **Contactos em terra:** pelo mesmo caminho de eventos do plano da 3b-1 (`arlequin:plano`, com um campo `tipo`; ver "Contactos").
- **Fontes de dados:**
  - **A previsão:** a navegar, o plugin da AI já arquiva de hora a hora. O acompanhamento lê a mais recente que cubra a posição (`lib/previsao.js` da 3a), e a idade vem dela.
  - **O rasto previsto e os eventos:** são os da alternativa ativada, guardados no plano ativo.

## Plano ativo (`lib/plano-ativo.js`)

- **Ao Ativar** (`POST /ativar` da 3a/3b-1), grava `plano-ativo.json` na pasta de dados do plugin (escrita atómica com fsync, como o arquivo de previsões). Guarda:
  - o id do cálculo, a alternativa (`rota`, `rasto`, `eventos`, `chegada`, `partida`, `destino` com a aproximação e o cais), a desistência e a tripulação;
  - o `href` da rota no SignalK;
  - o envio do plano: a quem (os contactos entregues) e a hora de alarme;
  - o estado: `"a espera de sair" | "a navegar" | "chegado" | "terminado" | "pausado"` (*nota: no código é `"à espera de sair"`, com acento; um ficheiro antigo lê-se na mesma — auditoria M-35*).
- **Ao arrancar**, o plugin lê o plano ativo e continua. Nada se repete aos contactos: o que já foi enviado fica registado no próprio ficheiro.
- **Saída:** passa a "a navegar" quando a posição fica a mais de 0,5 MN da partida, ou com SOG > 2 nós durante 5 min seguidos. A hora real de saída fica guardada. (*Nota: os 0,5 MN pedem 2 amostras seguidas.*)
- **Chegada:** menos de 0,3 MN do cais do destino (o último ponto da aproximação) e SOG < 0,5 nó durante 5 min seguidos. (*Nota: e com o progresso real — ver "Chegada com progresso real" nas decisões.*)
  - "Cheguei bem a X às HH:MM" segue para os contactos que receberam o plano e para o chat do Ivo.
  - Todos os `notifications.rota.*` voltam a `normal` e o plano fecha ("chegado").
- **Terminar** (botão no Leme, com confirmação "Terminar o plano? Os contactos em terra recebem 'viagem terminada, estou bem'"):
  - os contactos recebem "Viagem terminada / mudança de planos: estou bem, em <posição em graus e minutos> às HH:MM";
  - o plano fecha.
- **Rota mudada no OpenCPN:** se a rota ativa da API de rumo deixar de ser o `href` do plano (outra rota, ou nenhuma, sem ter chegado) (*nota: em pelo menos 2 leituras e durante pelo menos 2 min; logo a seguir a um reinício a API de rumo pode ainda não ter a rota*):
  - o plano passa a "pausado" e o acompanhamento para;
  - o ecrã mostra "a rota ativa já não é a do plano: terminar o plano?", com os botões Terminar e Continuar (Continuar volta a ativar a rota do plano);
  - **nada segue sozinho para os contactos.**
- **Recalcular → Ativar:** substitui o plano.
  - Se o plano antigo tinha sido enviado, o novo plano (texto + GPX, como na 3b-1) segue automaticamente para os mesmos contactos, com a nova hora de alarme e a linha "Este plano substitui o anterior".
  - Se o novo cálculo for recusado (422 da 3b-1, por exemplo um cálculo antigo), o ecrã avisa e o plano antigo mantém-se.

## Acompanhamento (`lib/acompanhamento.js`)

- **Milhas feitas:** a projeção da posição sobre a rota do plano (o ponto mais perto, com a janela de passagem da 3a, para não saltar em rotas que voltam atrás).
- **Atraso** = hora atual − hora a que o rasto previsto (provável) passava nas mesmas milhas. Positivo = atrasado. Calcula-se de minuto a minuto, com média móvel de 10 min para não oscilar.
- **Eventos deslizados:**
  - **Eventos de sítio** (rizar, largar rizo, cambar/virar, cabo, largo, chegada): hora do plano + atraso.
  - **Eventos de hora fixa** (pôr e nascer do sol, chuva, visibilidade, frente, rotação do vento da previsão): ficam na hora do plano.
  - **Chegada de noite:** volta a avaliar-se com a chegada deslizada.
- **Chegada prevista agora** = chegada provável do plano + atraso.

## Avisos (`lib/avisos-navegar.js`)

Só com o plano "a navegar". Nenhum muda a rota. (*Nota: o aviso da hora de alarme em terra, `alarmeTerra`, vale também à espera de sair, em pausa e com o plano fechado; ver as notas no fim.*)

| Caminho | Quando | Estado e apito | Telegram do Ivo |
|---|---|---|---|
| `notifications.rota.lembrete.<id>` | 30 min antes de cada evento (hora deslizada): rizar ou largar rizo, cambar/virar, rotação do vento > 45° ou frente, chuva ou visibilidade < 5 km ("radar ligado e luzes"), pôr do sol ("luzes, arnês, come antes de escurecer"), chegada de noite. Apaga-se à hora do evento | `alert`, apito curto | não |
| `notifications.rota.comer` | Só com "só eu": de 3 em 3 h desde a saída real ("Come e bebe: 3 h ao leme"). Apaga-se ao fim de 15 min | `alert`, apito curto | não |
| `notifications.rota.recalcula` | Atraso > 30 min, **ou** vento medido (média de 10 min) afastado do previsto P50 para aquele sítio e hora mais de ±30 % **e** mais de 4 nós, durante 30 min seguidos. A mensagem diz qual dos dois e o valor. Apaga-se quando ambos voltam ao normal durante 10 min | `warn`, apito curto | sim |
| `notifications.rota.recursos` | Gasóleo previsto à chegada < 40 L, ou bateria prevista à chegada < 50 % (detalhe a seguir) | `warn`, apito curto | sim |
| `notifications.rota.previsao` | Previsão mais recente com mais de 6 h: `warn`. Com mais de 12 h: `alarm`, com o texto "previsão com X h: confia nos instrumentos e no barómetro" | `warn` / `alarm`, sempre apito curto | só com mais de 12 h |
| `notifications.rota.barometro` | Queda > 3 hPa em 3 h (pressão medida, amostras de minuto a minuto guardadas no plugin): "o tempo pode piorar antes do previsto". Apaga-se quando a queda em 3 h fica ≤ 2 hPa | `warn`, apito curto | sim |

**Recursos:**
- **Gasóleo à chegada** = gasóleo medido agora − (horas de motor que faltam no plano, deslizadas) × consumo do plano a 2100 rpm (a mesma curva da 3a).
- **Bateria à chegada** = SoC agora + o balanço de energia da 3a (`lib/energia.js`) no troço que falta.
- **Sem leitura:** sem gasóleo ou sem SoC medidos não há aviso, mas o ecrã mostra "recursos: sem leitura" na faixa do Leme.

**Apitos:** todos os avisos da rota usam `method: ['visual', 'sound']`. Pelas regras do ecrã, `alert`/`warn` dão o **apito curto**. Para a previsão com mais de 12 h (`alarm`), que pelas regras atuais daria o apito contínuo, o plugin publica `method: ['visual', 'sound']` e o campo `apito: 'curto'`. O ecrã respeita `apito: 'curto'` (ajuste no `lib/alarmes.js`). **O apito contínuo fica só para perigo imediato (AIS).** (*Nota: a decisão do Ivo n.º 2, de 02/10, alargou o "perigo imediato" — contínuo para a colisão AIS, o fumo, a água no porão e a bomba de porão, a fuga de gasóleo e o motor a sobreaquecer; tudo o resto, incluindo todos os avisos da rota, com o apito curto. Ver as notas no fim.*)

**Resolvido:** quando a condição passa, o estado volta a `normal`. O porto já envia "✓ Resolvido: …" ao Ivo para os avisos que seguiram para o Telegram.

## Contactos em terra (`lib/contactos.js`)

Só se o plano foi enviado e há contactos entregues. As mensagens seguem só para esses contactos e para o chat do Ivo.

| Mensagem | Quando |
|---|---|
| "Cheguei bem a X às HH:MM. Obrigado!" | na chegada (uma vez) |
| "Ainda a navegar, tudo bem. Nova chegada prevista ~HH:MM. Nova hora de alarme: HH:MM (em vez de HH:MM)." | quando a chegada prevista agora passa **30 min ou mais** da "mais tarde" (`chegada.p90`) do plano (decisão do Ivo de 01/10, depois do protótipo: num plano só a motor a p90 é igual à p50, e uns minutos de atraso não são motivo para ninguém em terra se preocupar). A nova hora de alarme é a chegada prevista agora + 2 h. Depois, no máximo 1× por hora, só se a chegada voltar a escorregar mais de 15 min |
| "Viagem terminada / mudança de planos: estou bem, em … às HH:MM." | ao Terminar |
| O plano novo, com "Este plano substitui o anterior" | ao Recalcular → Ativar, se o antigo tinha sido enviado |

- **As guardas do atraso (decisão do Ivo de 02/10, "Só a avançar + teto de 3 h"; revisão final C1):** o atraso automático diz "tudo bem" aos contactos, por isso só sai quando o barco está mesmo a avançar:
  - **progresso real:** ≥ 1 MN na rota na última hora, a avançar agora (os últimos 15 min ao mesmo ritmo: um barco que acabou de parar não diz "tudo bem") e a ≤ 2 MN da rota. As milhas na rota guardam-se de 5 em 5 min no plano ativo (valem depois de um reinício), e cada troço conta no máximo o que o barco andou de facto (longe da rota, numa curva, a projeção salta sem o barco andar);
  - **teto:** a hora de alarme nunca passa sozinha mais de 3 h da hora de alarme do plano;
  - parado ou à deriva, ou acima do teto, **não sai nada** e fica a hora de alarme que terra já tem (falha segura: se o Ivo estiver incapacitado, os contactos chegam à hora de ligar ao MRCC). Um atraso na fila que deixou de passar nas guardas sai da fila;
  - o ecrã mostra então "A hora de alarme em terra é HH:MM e não foi adiada (barco parado / limite de 3 h). Se estás bem, carrega Estou bem." com o botão **Estou bem** (`POST /plano-ativo/estou-bem`, `readwrite`): liberta **um** atraso com a estimativa de agora, e o teto passa a ser 3 h sobre a hora de alarme dessa mensagem.
- **Plano de outra alternativa (revisão final I1):** o último plano entregue a contactos em terra fica em `ultimo-envio.json`. Ao Ativar sem um plano aberto enviado, se terra tem o plano de outra alternativa ou de outro cálculo (com a hora de alarme por passar e sem "cheguei bem"/"terminada"), o novo segue como no Recalcular → Ativar ("Este plano substitui o anterior"). O Resultado avisa antes.
- **Contacto que falhou (revisão final I3):** os contactos que não receberam uma mensagem (bloquearam o bot, um erro do Telegram) recebem-na outra vez, igual e com a mesma referência, de 2 em 2 min, até entregar ou deixar de interessar; o ecrã diz "não chegou a X (a tentar outra vez)". (*Nota: desde 02/10, decisão n.º 16, desiste-se no fim da hora de alarme desse contacto e o Ivo é avisado pelo Telegram; ver as notas da auditoria.*)
- **A hora de alarme no ecrã (revisão final I2):** a faixa e a caixa da pausa dizem "contactos em terra: alarme HH:MM", "mensagem para terra por enviar (sem rede)" e, em pausa, "em pausa: os atrasos não seguem para terra"; 60 min antes da hora de alarme, com o plano aberto (também à espera de sair e em pausa), o aviso `notifications.rota.alarmeTerra` (alert, apito curto, só no ecrã): "Os contactos em terra ligam ao MRCC às HH:MM: avisa-os ou Terminar".
- **Horas:** como na 3b-1, horas de Lisboa com o dia da semana, a data e o sufixo de verão/inverno na hora ambígua.
- **Fila sem rede:**
  - uma mensagem que falha fica em fila (gravada no plano ativo) e volta a tentar de 2 em 2 min;
  - uma mensagem que deixou de interessar sai da fila: um "atraso" mais antigo, ou qualquer "atraso" depois de "cheguei bem" ou "terminada";
  - a hora em que realmente saiu fica registada.
- **Transporte:**
  - o plugin da rota emite `arlequin:plano` com `{ pedido, tipo: 'plano'|'chegada'|'atraso'|'terminado', texto, gpx?, nomeFicheiro?, destinatarios: 'contactos-do-plano' }`;
  - o porto envia só aos `contactosPlano` que receberam o plano (lista no pedido) e ao chat do Ivo, e responde com `arlequin:plano-enviado`;
  - o `gpx` só segue no `tipo: 'plano'`.

## Ecrã (Leme)

- **Faixa por cima do rumo:**
  - "próximo: rizar às 22:50 (daqui a 25 min) · +20 min sobre o plano";
  - "chegada ~sáb 07:58 (plano 07:38)";
  - "recursos: gasóleo à chegada ~34 L" quando há aviso.
  - Antes de sair: "plano ativo · à espera de sair".
- **Botões:**
  - **Recalcular**: um cálculo novo de onde estás para o mesmo destino e tripulação. Leva ao Resultado da 3b-1, onde "Ativar" substitui o plano;
  - **Terminar** (com confirmação).
- **Rota mudada:** a caixa "a rota ativa já não é a do plano" com Terminar / Continuar.
- **REST novo:**
  - `GET /plano-ativo` → `{ estado, destino, atrasoMin, proximo: {texto, hora}, chegadaAgora, chegadaPlano, recursos, filaContactos }`;
  - `POST /plano-ativo/terminar`;
  - `POST /plano-ativo/continuar`.
  - GET `readonly`, POST `readwrite`, como na 3b-1.
  - (*Nota: o código tem também `POST /plano-ativo/estou-bem` e `POST /plano-ativo/chegada`, e o `GET /plano-ativo` devolve muitos mais campos: ver as notas no fim.*)

## Falhas

| Falha | Comportamento |
|---|---|
| Sem GPS mais de 2 min | os avisos de sítio param; "sem GPS: acompanhamento parado" na faixa; nada segue para os contactos |
| Sem previsão nenhuma | o desvio do vento não se avalia; o aviso de previsão velha fica ativo |
| Sem pressão medida | sem aviso do barómetro ("barómetro: sem leitura" na faixa) |
| Porto desligado ou sem rede | as mensagens para os contactos ficam em fila; os avisos no ecrã continuam |
| Plugin reiniciado | o plano continua do ficheiro; os temporizadores de "30 min seguidos" recomeçam (avisar mais tarde, nunca a dobrar) |

## Testes e validação

**Node (`node:test`), com relógio e SignalK falsos:**
- **Plano ativo:**
  - gravação atómica e leitura;
  - reinício a meio sem repetir mensagens;
  - saída (0,5 MN ou > 2 nós durante 5 min) e chegada (< 0,3 MN e < 0,5 nó durante 5 min);
  - Terminar;
  - rota mudada → "pausado", sem mensagens aos contactos;
  - Recalcular → Ativar substitui o plano e reenvia o novo plano aos contactos.
- **Acompanhamento:**
  - atraso pela projeção sobre a rota;
  - média de 10 min;
  - eventos de sítio deslizam e os de hora fixa não;
  - chegada de noite reavaliada.
- **Avisos:**
  - cada um no limite e ao lado: 29 contra 31 min, 2,9 contra 3,1 hPa, 29 % contra 31 %, 30 min seguidos;
  - apagam-se como descrito;
  - "come e bebe" só com "só eu";
  - `apito: 'curto'` na previsão > 12 h.
- **Porto:**
  - `rota.lembrete.*` e `rota.comer` nunca vão ao Telegram;
  - os importantes vão só ao chat do Ivo;
  - as mensagens de `tipo` chegada/atraso/terminado vão só aos contactos entregues e ao Ivo, sem GPX.
- **Contactos:**
  - atraso no máximo 1× por hora e só com escorregamento > 15 min;
  - "cheguei bem" uma vez;
  - a fila guarda e descarta as mensagens que deixaram de interessar.
- **Ecrã:**
  - a faixa com o atraso, Recalcular, Terminar com confirmação e a caixa da rota mudada;
  - de dia e de noite, sem `null`/`NaN`/`undefined`;
  - o `lib/alarmes.js` respeita `apito: 'curto'`.

**Validação ao vivo (SignalK local):**
- Uma viagem Algés → Peniche simulada **acelerada** (por exemplo 60×) com o simulador do dev, com:
  - um atraso forçado a meio;
  - uma queda de barómetro forçada;
  - o gasóleo a descer.
- Confirmar, pela ordem, os lembretes, o recalcula, os recursos, o barómetro, a mensagem de atraso aos contactos e o "cheguei bem".
- Telegram falso: os contactos só recebem chegada e atrasos; o chat do Ivo recebe os importantes.
- Parar o servidor a meio e voltar a arrancar: o plano continua e nada se repete.
- Capturas do Leme (faixa, avisos, rota mudada), de dia e de noite, mostradas ao Ivo.
- Parar só os processos arrancados e repor a configuração do dev.

## Fora de âmbito

- O piloto automático (EV-100): o rumo da rota ativa para o piloto, quando vier. (Nota de 02/10:
  hoje não há piloto; o Ivo decidiu o EV-100 Wheel, por comprar e instalar: `PILOTO-AUTOMATICO.md` §3.)
- Meshtastic (depois do sistema validado).
- O estado das barras automático (fica como precaução manual).

## Acerto incluído (resto da 3b-1)

- Na descrição da rota para o OpenCPN (`ativarRota`), usar `semVela` como o ecrã e o plano: "a motor (sem vento para vela)" em vez de "vela e motor" quando a passagem vai toda a motor.

## Notas de implementação (01–02/10)

O que as revisões de 01–02/10 mudaram (antes da auditoria; está também no `NAVEGACAO.md`, "A
navegar"). Verificado no código a 05/10.

- **Saída:** mais de 0,5 MN da partida em 2 amostras seguidas (com ≤ 2 min entre elas), ou SOG
  > 2 nós durante 5 min seguidos. Sem posição do GPS, nenhuma das duas conta.
- **Chegada:** a regra do texto, mais o progresso real (tabela das decisões), e verificada mesmo
  em pausa. Em pausa e parado 30 min a menos de 0,3 MN do cais de **outro** porto (só os de
  `dados/destinos.json`), o Leme pergunta "Chegaste a X? Enviar 'cheguei bem a X'"; só envia com o
  toque (`POST /plano-ativo/chegada`).
- **Rota mudada:** a pausa só com ≥ 2 leituras e ≥ 2 min; uma resposta da API de rumo que não chega
  em 10 s não conta. Quando a rota do plano volta a estar ativa, o plano continua sozinho.
- **Lembretes:** "virar/cambar" (a motor, "mudar de rumo") nos pontos onde o rumo da rota muda mais
  de 45° (fora das pernas de porto); a rotação do vento previsto de mais de 45° em 1 h só com ≥ 6 nós
  nos dois extremos, pelo menos 3 h entre lembretes e nenhuma a ±1 h de uma passagem da frente (essa
  já diz para onde roda).
- **A hora de alarme em terra** (`notifications.rota.alarmeTerra`, `alert`, apito curto, só no
  ecrã): 60 min antes, com o plano aberto — também à espera de sair e em pausa.
- **Os avisos são 7:** `lembrete.<id>`, `comer`, `recalcula`, `recursos`, `previsao`, `barometro` e
  `alarmeTerra`. A auditoria juntou o 8.º, `relogio` (ver abaixo).
- **REST:** além do texto, `POST /plano-ativo/estou-bem` (o botão **Estou bem**: liberta um atraso
  com a estimativa de agora) e `POST /plano-ativo/chegada { destino }`.
- **Referência:** cada mensagem para terra acaba com uma referência curta ("ref. A3"), a mesma em
  todas as tentativas; depois de um reinício a meio de um envio a mensagem volta a sair (mais vale
  repetida do que perdida).

## Notas de implementação (auditoria, 02–03/10)

O que a auditoria de 02/10 mudou (plugin da rota: frente F2; ecrã: F3b; porto: F4b). As decisões do
Ivo estão numeradas como na lista da auditoria. Verificado no código a 05/10.

**Mensagens para terra:**
- **K-02:** um atraso automático só sai com o plano "a navegar" e com GPS. Em pausa, à espera de
  sair ou com o plano fechado sai da fila; sem GPS fica retido, sem prender as outras. O atraso que
  o **Estou bem** liberta sai na mesma.
- **K-13:** uma mensagem que falha para todos já não prende a fila: as que já falharam 3 vezes, as
  do plano anterior e os avisos ao Ivo vão para trás das outras.
- **Decisão n.º 14 (I-01):** cada contacto tem a sua hora de alarme (a do que lhe chegou:
  `envio.porContacto` no `GET /plano-ativo`); o `envio.alarme` e o aviso de 60 min contam pela **mais
  cedo**. O Leme mostra a de cada um quando são diferentes.
- **K-12:** com o plano fechado e o "cheguei bem" (ou a "viagem terminada") ainda por entregar, o
  aviso continua: "O «cheguei bem» ainda não chegou a terra: os contactos ligam ao MRCC às HH:MM —
  liga-lhes" (`fechoPorEntregar` no GET).
- **Decisão n.º 15 (I-02):** se terra tem um plano que não é o do plano ativo, o aviso de 60 min diz
  "Os contactos em terra têm um plano com alarme às HH:MM e não há plano ativo: ativa-o ou avisa-os"
  (ou "… têm o plano de outra alternativa, com alarme às HH:MM: avisa-os"); `envioEmTerra` no GET,
  também na resposta 404 (sem plano).
- **Decisão n.º 13 (I-03):** o Ativar dá 422 com um cálculo antigo (a hora de alarme já passou, ou a
  partida foi há mais de 1 h), menos a alternativa do plano aberto ativada outra vez; um envio
  fechado nunca se reaproveita. O "antigo" conta por alternativa, como no envio.
- **I-04:** um "cheguei bem" herdado de um plano anterior só fecha o envio desse plano.
- **Decisão n.º 16 (I-05, M-28):** a um contacto que nunca recebe, desiste-se no fim da hora de
  alarme desse envio para esse contacto, e só quando a falha é dele (outro contacto ou o Ivo
  receberam; sem rede nunca se desiste). Um plano novo ("substitui") que passou a sua hora de alarme
  sai da fila. O Ivo recebe pelo Telegram (só no chat dele; tenta durante 24 h) "X não recebeu … e já
  passou a hora de alarme (…): desisti de o entregar. Liga-lhe."; o GET traz as 10 desistências mais
  recentes (`desistencias`). As mensagens de fecho levam sempre a data ("Cheguei bem à Nazaré qua
  30/09 às 10:10. Obrigado!").
- **M-32:** o plano da alternativa ativa mandado outra vez junta-se aos contactos que já o tinham.
- **M-22:** o "Terminar" sem posição fresca diz a última posição conhecida e a hora dela.

**Relógio (decisão n.º 19):** com a hora do Pi a mais de 60 s da do GPS (`navigation.datetime`), o
`POST /plano-telegram` dá 422, o Ativar que mandaria o plano para terra dá 422, e o ciclo a navegar
não corre (nada sai para terra). O aviso `notifications.rota.relogio` (`warn`) diz "Relógio do Pi
desacertado N min da hora do GPS: o acompanhamento e as mensagens para terra estão parados — acerta a
hora do Pi"; vai também para o Telegram do Ivo (não está na lista `NUNCA` do porto). O GET (e o 404)
traz `relogioDesacertadoS`, e o Leme mostra o aviso no mosaico "Contactos em terra".

**Avisos e acompanhamento:**
- **Apito (decisão n.º 2, contrato C1):** todos os avisos da rota têm `method: ['visual', 'sound']`
  e dão o apito curto; o campo `apito: 'curto'` vai na previsão em alarme e no `alarmeTerra`. O
  contínuo é só para o perigo imediato, que não vem da rota.
- **Telegram do Ivo:** recalcula, recursos, previsão com mais de 12 h, barómetro e relógio. Os
  lembretes, o "come e bebe" e o `alarmeTerra` ficam só no ecrã. O porto insiste até entregar (recuo
  até 1 min) e junta "(atrasado N min)" (decisão n.º 17).
- **I-12:** o gasóleo e o SoC só contam com uma leitura de ≤ 2 min e sem o aviso de sonda ou sensor
  perdido do plugin que os publica; senão "recursos: sem leitura".
- **Decisão n.º 4 (I-13):** os recursos à chegada contam com 440 Ah e o fator solar 0,65.
- **I-16:** a correção do vento a navegar recebe também a tendência do barómetro em 3 h.
- **Decisão n.º 10 (I-17):** um lembrete por episódio de visibilidade abaixo de 5 km: "pouca
  visibilidade — radar ligado e luzes" (com chuva, "chuva e pouca visibilidade — …").
- **M-23:** arredonda-se para cima ("Previsão com 7 h" com 6,2 h; "+34 %" com 33,3 %).
- **M-26:** os afastamentos da pausa só sobem com 2 amostras seguidas (um salto do GPS não conta).
- **M-27:** a previsão de agora lê-se do arquivo de 10 em 10 min (ou depois de 5 MN), e só as das
  últimas 50 h; mais velha é "Sem previsão: confia nos instrumentos e no barómetro" (`alarm`).
- **M-19:** "Cheguei bem à Nazaré", "virar/cambar na Nazaré", "chegada de noite à Nazaré".

**REST e servidor:**
- **M-21:** um 2.º Ativar a meio dá 409 "já há uma ativação a meio: espera um momento".
- **M-24:** os pedidos à API do SignalK têm limite de tempo (um pedido pendurado já não prende o
  `/calcular` nem o Ativar).
- **M-34:** as rotas dos planos substituídos e das ativações falhadas apagam-se do servidor; a do
  plano terminado ou chegado fica até ao Ativar seguinte.
- **M-35:** o estado é "à espera de sair", com acento.
- **I-32:** os erros para o Ivo vêm em pt-PT; o pormenor fica no registo do SignalK.
- **O `GET /plano-ativo`** ganhou na auditoria `envio.porContacto`, `envio.alarmePlano`,
  `fechoPorEntregar`, `relogioDesacertadoS`, `envioEmTerra` e `desistencias` (o `envio.alarme`
  passou a ser a hora mais cedo); os `avisos` vêm também em pausa e com o plano fechado. O 404 (sem
  plano) traz `envioEmTerra` e `relogioDesacertadoS`. Os campos todos estão no cabeçalho do
  `index.js` do plugin.
- **Reinício (nota do SignalK 2.33):** ao parar o plugin, o servidor apaga os valores dele; os
  avisos da rota voltam no 1.º ciclo (até 60 s depois do arranque) e o porto não os repete por isso.
- **06/10 (demonstração ao vivo no portátil):** o ponto seguinte da rota ativa não avançava — a API de rumo v2
  do SignalK não o faz sozinha, o `course-provider` só calcula para o `nextPoint` que lá está e o OpenCPN
  não o avança pela rede — e o "Rumo a seguir" do Leme ficava preso ao WP1. O plugin passa a projetar o barco
  na rota ativa (`lib/acompanhamento.js` `pontoASeguir`: janela que nunca recua, 5 MN à frente, círculo de
  chegada 0,1 MN, só a andar, só a menos de 2 MN da rota) e, quando passa um ponto, volta a ativar a rota com
  o `pointIndex` seguinte (`app.activateRoute`, a API interna). Testes: `acompanhamento.test.js` e
  `navegar-ciclo.test.js`.
