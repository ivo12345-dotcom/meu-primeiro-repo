# ARLEQUIN · Ecrã da roda (desenho)

Data: 29/09/2026 · Aprovado pelo Ivo no chat (opção A, "mete as páginas todas").
Base visual: `maqueta-arlequin.html` e NAVEGACAO.md §7a/§7b.

## Objetivo

Um painel web do Arlequin, ao lado do OpenCPN, com as 9 páginas da maqueta a
funcionar com dados reais do SignalK. Sem EV-100, a Melhor rota e o Recolher
velas guiam o Ivo ao leme. O painel abre também no telemóvel e no 2.º ecrã.

## Arquitetura

```
software/
  arlequin-ecra/                pacote = plugin SignalK + webapp SignalK
    index.js                    plugin: /plugins/arlequin-ecra/janela (layout/noite → comandos do Pi)
    public/                     webapp servida em /arlequin-ecra/
      index.html, estilo.css
      app.js                    arranque, barra de cima, botões, render 1 Hz
      signalk.js                cliente WebSocket + REST (store caminho→valor)
      paginas/*.js              uma por botão (carta, instr, ais, motor, viagem,
                                diario, melhor, velas) → HTML a partir do store
      lib/*.js                  CÁLCULOS PUROS (ES modules, testados em node)
      polar-arlequin.csv
    test/                       node:test para public/lib/*
  signalk-arlequin-ais/         plugin: alarmes CPA/TCPA no servidor
    index.js
    (usa arlequin-ecra/public/lib/cpa.js — o mesmo cálculo do ecrã)
  arlequin-simulador/           + cenário "navegar-demo" em tempo real
```

- **OpenCPN à esquerda (58%), painel à direita.** As páginas de ecrã inteiro
  (tudo menos a Carta) pedem ao plugin `layout: inteiro`. A Carta pede
  `layout: carta`. A Noite pede `noite: true/false`. Os comandos são texto na
  configuração do plugin (ex. `wmctrl`/`xdotool` no Pi) e ficam vazios no
  portátil. O resultado aparece no estado do plugin.
- **Sem passo de build:** ES modules nativos, sem dependências no browser.
- **Dados:** WebSocket `/signalk/v1/stream?subscribe=none` e depois
  `subscribe` a `vessels.self` (todos os caminhos) e a `vessels.*`
  (`navigation.position`, `navigation.courseOverGroundTrue`,
  `navigation.speedOverGround`, `name`, `mmsi`, `design.aisShipType`), com
  reconexão automática. O render corre a 1 Hz.

## Caminhos SignalK usados (SI)

| Grupo | Caminhos |
|---|---|
| Navegação | `navigation.position`, `headingTrue` (ou `headingMagnetic`), `courseOverGroundTrue`, `speedOverGround`, `speedThroughWater`, `attitude.roll`, `leewayAngle` |
| Fundo | `environment.depth.belowTransducer` |
| Vento | `environment.wind.angleApparent`, `speedApparent`, `angleTrueWater`, `speedTrue`, `directionTrue` |
| Corrente / ar | `environment.current` `{setTrue, drift}`, `environment.outside.pressure`, `environment.inside.temperature`, `environment.inside.relativeHumidity` |
| Rota | `navigation.course.calcValues.{bearingTrue,distance,crossTrackError,timeToGo,velocityMadeGood}`; recurso: `navigation.courseRhumbline.nextPoint.{bearingTrue,distance}` + `navigation.courseRhumbline.crossTrackError` |
| Motor | `propulsion.main.{revolutions,temperature,oilPressure,alternatorVoltage,runTime,fuel.rate}` |
| Gasóleo | `tanks.fuel.0.{currentLevel,capacity}` |
| Energia | `electrical.batteries.servico.{capacity.stateOfCharge,current,voltage}`, `electrical.batteries.motor.voltage`, `electrical.solar.mppt1/2.panelPower` |
| Piloto | `steering.autopilot.state` (sem dados → "manual") |
| Alarmes | `notifications.*` (value com `id`, `state`, `method`, `message`, `status`) |

## Cálculos puros (`public/lib`, testados)

- `formato.js`: nós, graus (3 dígitos), MN, m, °C, hPa, L, horas; vírgula
  decimal pt-PT; `—` quando falta o dado.
- `cpa.js`: CPA/TCPA com plano local (equiretangular) a partir de posição, COG
  e SOG dos dois barcos. Também distância e marcação, e classifica o alvo em
  perigo / atenção / seguro / afasta-se com os limites (CPA 0,5 MN, TCPA
  20 min).
- `polar.js`: lê o CSV (TWA;TWS…), dá a velocidade alvo por interpolação
  bilinear e a % da polar. Calcula os ângulos ótimos de VMG de bolina e de
  popa para um TWS.
- `rumo.js`: correção ao leme (diferença angular com sinal, EB/BB). Rumos de
  bolina ótimos para um WP contra o vento e deteção da layline. Rumo para
  aproar ao vento (`directionTrue`).
- `barometro.js`: histórico em memória e tendência de 3 h
  (sobe/desce/estável, hPa/3 h).
- `viagem.js`: acumulador da viagem (distância, tempo, tempo à vela/motor,
  médias, vento máximo, gasóleo gasto, pressão inicial/final), guardado em
  `localStorage`, com "Nova viagem".
- `alarmes.js`: escolhe o alarme mais grave para a barra, diz para que página
  leva, e se deve tocar (`sound` no method e não silenciado/reconhecido).

## Páginas

Iguais à maqueta (§7a/§7b). Ajustes aprovados:

- **Motor** inclui a **energia**: SoC, corrente, tensão, painéis, bateria do
  motor e as últimas sessões de carga. Para isto, o plugin de energia ganha
  `GET /plugins/signalk-arlequin-energia/sessoes`.
- **Diário** usa a API REST do `signalk-logbook`
  (`GET /plugins/signalk-logbook/logs/:data`, `POST …/logs`). Sem o plugin,
  mostra "diário não instalado".
- **Melhor rota** (sem EV-100): a rota ótima calcula-se e ativa-se no OpenCPN
  (Weather Routing). A página mostra o rumo ao WP, a **correção ao leme em
  grande**, o XTE e a VMG. Contra o vento, mostra os dois rumos ótimos da polar
  e "vira agora" na layline.
- **Rec. velas** (sem EV-100): passos com toque. (1) Motor ligado (verificado
  pelas rpm). (2) Aproar: rumo alvo = direção do vento real, com indicador de
  quanto falta. (3) Recolher. (4) Terminar. Cada passo fica no diário
  (`category: navigation`).
- **Noite**: tema vermelho por variáveis CSS, e pede `noite` ao plugin.

## Alarmes

- O ecrã toca um bip (Web Audio) enquanto houver uma notificação ativa com
  `sound` que não esteja silenciada nem reconhecida. `alarm`/`emergency` dão
  um bip contínuo; `warn` dá um bip curto.
- Tocar no alarme da barra leva à página certa. O botão Silenciar faz
  `POST /signalk/v2/api/notifications/{id}/silence`.
- `signalk-arlequin-ais` publica `notifications.arlequin.ais.<mmsi>`: `alarm`
  com som abaixo dos limites, `normal` quando passa. Usa o mesmo `cpa.js`.

## Simulador: cenário `navegar-demo` (tempo real)

Rota Peniche → Nazaré com 3 WP. Vento real de 14 nós de 330° com rajadas.
Três alvos AIS: NORDIC STAR em rota de colisão (CPA < 0,5 MN), MARIA JOÃO a
pescar e SEAGULL a afastar-se. Emite rota ativa (`calcValues`), fundo, pressão
a descer, adorno, abatimento, corrente e gasóleo. Ciclo de 20 min à vela e
5 min a motor, para ver a página do motor viva.

## Validação

1. `node --test` em `arlequin-ecra/test` e `signalk-arlequin-ais`.
2. SignalK local com o `navegar-demo`: ver cada página no browser em
   1280×800 e 1024×600, de dia e de noite. Confirmar o alarme AIS na barra, o
   bip, o silenciar, e as entradas do diário.

## Fora do âmbito

Comando do EV-100, Meshtastic, besouro GPIO, centrar a carta no alvo (depende
do OpenCPN), exportar GPX (o OpenCPN já exporta).

## Alterações depois de 29/09 (nota de 02/10)

O que mudou depois deste desenho; o resto mantém-se.

- **Melhor rota:** deixou de se calcular no OpenCPN (Weather Routing). É o plugin próprio
  `signalk-arlequin-rota` (desenhos 3a, 3b-1 e 3b-2, de 30/09 e 01/10). A página tem os estados
  Pedir, A calcular, Resultado, Mapa e Leme; com um plano ativo, o Leme mostra a faixa do
  acompanhamento.
- **Noite** (decisão do Ivo de 01/10): sem tema vermelho. As cores do dia muito escurecidas, sobre
  fundo preto, com − e + ao lado do botão Noite e 5 níveis de brilho (2 por omissão): ver o
  `NAVEGACAO.md`, §7a.
- **Rec. velas** passou a chamar-se **Velas**: o estado da grande e da genoa (para a AI) e o
  Recolher velas sem piloto, passo a passo.
- **Simulador `navegar-demo`:** o vento real é de 14 nós de **020°** (a rota até à Nazaré fica
  contra o vento) e a rota tem **4 WP** (Sul Carvoeiro, Carvoeiro, Baleal e Nazaré:
  `arlequin-simulador/lib/navegacao.js`).
- **Piloto automático:** continua a não haver. Decidido a 02/10: Raymarine EV-100 Wheel, por comprar e
  instalar (`PILOTO-AUTOMATICO.md` §3); a ligação ao ecrã fica para depois de montado.

## Notas de implementação (auditoria, 02–03/10)

O que a auditoria mudou no ecrã (frentes F3, F3c e F3b; as decisões do Ivo numeradas como na lista
da auditoria). Verificado no código a 05/10. Onde o texto acima e estas notas diferem, valem estas.

- **Apito** (decisão n.º 2, contrato C1; substitui o 1.º ponto de "Alarmes"): o ecrã toca o apito
  **contínuo** (um bip de 0,4 s a 1000 Hz em cada segundo) só se a notificação tem som, não está
  calada nem reconhecida, e (`apito: 'continuo'`, ou sem o campo `apito` e no estado `emergency`).
  Tudo o resto com som dá o **apito curto** (um bip de 0,35 s a 660 Hz quando a notificação muda).
  Hoje o contínuo é a colisão AIS, o fumo, a água no porão, a bomba de porão, a fuga de gasóleo e o
  sobreaquecimento do motor.
- **Fumo reconhecido** (Adenda 2): o contínuo pára, o alarme fica vermelho e repete um bip curto de
  2 em 2 min (o 1.º 2 min depois de o ecrã o ver reconhecido) enquanto houver fumo; se passar e
  voltar, apita contínuo outra vez.
- **Calado depois de um reinício** (nota do SignalK 2.33): um alarme que o Ivo calou continua calado
  se o plugin que o publica reiniciar e o repuser em menos de 3 min com a mesma mensagem (não vale
  para a emergência). Fica só na memória do ecrã.
- **"Larguei (sou eu)"** (contrato C10): o alarme "o barco saiu do lugar" (com `acao: 'largar'`) leva
  este botão, que chama `POST /plugins/signalk-arlequin-porto/largar` e apaga o ponto de amarração.
- **Som ao arrancar** (K-03): o `AudioContext` nasce logo ao arrancar e tenta `resume()` em cada
  ciclo e em cada toque; o chip "🔇 SEM SOM: toca no ecrã" só aparece com o som parado. No Pi o kiosk
  do Chromium tem de arrancar com `--autoplay-policy=no-user-gesture-required` (sem a opção o ecrã
  fica mudo até ao 1.º toque).
- **Proa** (I-11; o caminho "`headingTrue` (ou `headingMagnetic`)" da tabela): `headingTrue`, ou
  `headingMagnetic` + `magneticVariation` (as duas), com "(mag.)" à vista; sem declinação, "—".
- **Diário** (contrato C3, decisão n.º 20; substitui o ponto "Diário" das Páginas): o ecrã lê e
  escreve pelo plugin do ecrã, `GET /plugins/arlequin-ecra/diario/:dia` e `POST
  /plugins/arlequin-ecra/diario`; o plugin fala com o `signalk-logbook` com um token de admin posto
  só na configuração dele. O ecrã entra com uma conta "read/write", nunca admin. 8 botões de um toque
  (com "Orcas").
- **Toque e letra** (I-26): todos os alvos de toque com 44 px no mínimo, também no LAFVIN de
  1024×600; a letra de base nunca abaixo de 14 px (`font-size: max(14px, 2vh)`).
- **Noite** (decisão n.º 21, I-27): as cores da correção BB/EB e as etiquetas clarearam para se lerem
  no brilho 2 (≥ 3:1, a confirmar no barco, de noite).
- **Motor** (contrato C11, I-23): três estados — "a trabalhar", "motor desligado" (rotações a 0 ou a
  ignição desligada, `propulsion.main.ligacao` = `calado`; conta como vela) e "sem leitura do motor"
  (`sem-ligacao`, uma ligação com mais de 20 s, ou sem rotações).
- **AIS** (contrato C12): com `navigation.arlequin.emPorto` (com menos de 30 s), a linha "Em porto: os
  alvos parados aparecem a amarelo e não apitam"; o alvo com alarme do plugin fica "perigo" e à
  frente; "sem rumo do alvo", "sem o nosso rumo", "sem rumo de nenhum dos dois".
- **Gasóleo e água:** com o nível de mais de 2 min, "sem leitura (último N L, há X min)"; o consumo de
  cruzeiro do ecrã é 1,45 L/h (2100 rpm, como a rota); a água diz "sem sensor", "nível por
  confirmar: carrega Enchi" ou "sem nível" e nunca aparece cheia por omissão (decisão n.º 23).
- **Horas de Lisboa** em todas as páginas, qualquer que seja o fuso do Pi (decisão n.º 22).
- **Erros:** uma exceção a desenhar uma página já não cala os alarmes (I-06); sem caixas
  `confirm()` do browser, que paravam o ciclo (I-10); os erros em pt-PT (I-32).
- **Verificador** (`npm run verificar-ecra`, F3c/F3b): desenha 74 estados num Chromium a 1024×600 e
  falha se um alvo de toque ou uma lista ficar cortada; corre-se também no Chromium do Pi (a letra de
  lá é outra).
