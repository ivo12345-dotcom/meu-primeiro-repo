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
- **Piloto automático:** continua a não haver; está por decidir (`PILOTO-AUTOMATICO.md`).
