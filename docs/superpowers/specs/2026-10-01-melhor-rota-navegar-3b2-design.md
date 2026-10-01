# Melhor rota 3b-2 — "A navegar": plano ativo, avisos, acompanhamento e contactos

Data: 01/10/2026. Desenho aprovado pelo Ivo por secções, nesta conversa.

Parte do desenho geral `2026-09-29-melhor-rota-ia-design.md` (Parte 4: avisos e acompanhamento). Assenta na 3a (`2026-09-30-melhor-rota-calculo-design.md`) e na 3b-1 (`2026-10-01-melhor-rota-ecra-3b1-design.md`), já feitas.

## Decisões do Ivo

| Tema | Decisão |
|---|---|
| Onde corre | No **plugin da rota, no Pi** (abordagem A): funciona com o ecrã desligado e sobrevive a reinícios |
| Avisos para o Telegram | **Só os importantes**, e só para o chat do Ivo: recalcula, recursos, previsão com mais de 12 h, barómetro. Os lembretes de evento e o "come e bebe" ficam só no ecrã |
| Contactos em terra | **Chegada e atrasos automáticos**: "cheguei bem" à chegada, e "ainda a navegar, nova hora de alarme" quando a chegada passa da "mais tarde" do plano (no máximo 1× por hora) |
| Mudança de rota | Nunca muda a rota sozinho. "Recalcular" é um botão; ativar outra rota substitui o plano |

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
  - o estado: `"a espera de sair" | "a navegar" | "chegado" | "terminado" | "pausado"`.
- **Ao arrancar**, o plugin lê o plano ativo e continua. Nada se repete aos contactos: o que já foi enviado fica registado no próprio ficheiro.
- **Saída:** passa a "a navegar" quando a posição fica a mais de 0,5 MN da partida, ou com SOG > 2 nós durante 5 min seguidos. A hora real de saída fica guardada.
- **Chegada:** menos de 0,3 MN do cais do destino (o último ponto da aproximação) e SOG < 0,5 nó durante 5 min seguidos.
  - "Cheguei bem a X às HH:MM" segue para os contactos que receberam o plano e para o chat do Ivo.
  - Todos os `notifications.rota.*` voltam a `normal` e o plano fecha ("chegado").
- **Terminar** (botão no Leme, com confirmação "Terminar o plano? Os contactos em terra recebem 'viagem terminada, estou bem'"):
  - os contactos recebem "Viagem terminada / mudança de planos: estou bem, em <posição em graus e minutos> às HH:MM";
  - o plano fecha.
- **Rota mudada no OpenCPN:** se a rota ativa da API de rumo deixar de ser o `href` do plano (outra rota, ou nenhuma, sem ter chegado):
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

Só com o plano "a navegar". Nenhum muda a rota.

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

**Apitos:** todos os avisos da rota usam `method: ['visual', 'sound']`. Pelas regras do ecrã, `alert`/`warn` dão o **apito curto**. Para a previsão com mais de 12 h (`alarm`), que pelas regras atuais daria o apito contínuo, o plugin publica `method: ['visual', 'sound']` e o campo `apito: 'curto'`. O ecrã respeita `apito: 'curto'` (ajuste no `lib/alarmes.js`). **O apito contínuo fica só para perigo imediato (AIS).**

**Resolvido:** quando a condição passa, o estado volta a `normal`. O porto já envia "✓ Resolvido: …" ao Ivo para os avisos que seguiram para o Telegram.

## Contactos em terra (`lib/contactos.js`)

Só se o plano foi enviado e há contactos entregues. As mensagens seguem só para esses contactos e para o chat do Ivo.

| Mensagem | Quando |
|---|---|
| "Cheguei bem a X às HH:MM. Obrigado!" | na chegada (uma vez) |
| "Ainda a navegar, tudo bem. Nova chegada prevista ~HH:MM. Nova hora de alarme: HH:MM (em vez de HH:MM)." | quando a chegada prevista agora passa da "mais tarde" (`chegada.p90`) do plano. A nova hora de alarme é a chegada prevista agora + 2 h. Depois, no máximo 1× por hora, só se a chegada voltar a escorregar mais de 15 min |
| "Viagem terminada / mudança de planos: estou bem, em … às HH:MM." | ao Terminar |
| O plano novo, com "Este plano substitui o anterior" | ao Recalcular → Ativar, se o antigo tinha sido enviado |

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

- O piloto automático (EV-100): o rumo da rota ativa para o piloto, quando vier.
- Meshtastic (depois do sistema validado).
- O estado das barras automático (fica como precaução manual).

## Acerto incluído (resto da 3b-1)

- Na descrição da rota para o OpenCPN (`ativarRota`), usar `semVela` como o ecrã e o plano: "a motor (sem vento para vela)" em vez de "vela e motor" quando a passagem vai toda a motor.
