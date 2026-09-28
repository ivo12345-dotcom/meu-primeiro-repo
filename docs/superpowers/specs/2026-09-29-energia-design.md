# ARLEQUIN · Plugin de energia + simulador (desenho)

Data: 29/09/2026 · Aprovado pelo Ivo no chat · Âmbito: sub-projeto 1 do código
(base + energia). O Meshtastic fica de fora até o sistema estar validado.

## Objetivo

Correr no Pi (SignalK do OpenPlotter) um plugin que vigia as baterias AGM do
Arlequin e avisa o Ivo quando ligar e desligar o motor para carregar. Regista
cada carga feita pelo motor. Tudo se desenvolve e testa no portátil, com um
simulador que finge o barco.

## Peças

```
software/
  signalk-arlequin-energia/   plugin de energia (vai para o Pi tal como está)
    index.js                  ligação ao SignalK: subscrições, notificações, diário
    lib/regras.js             lógica pura dos alarmes (sem SignalK, testável)
    lib/sessao.js             sessão de carga pelo motor (lógica pura)
    lib/diario.js             escrita do registo (JSONL + logbook opcional)
    test/                     testes (node:test, sem dependências)
  arlequin-simulador/         plugin que finge o barco (desligado no Pi)
    index.js                  emite deltas SignalK a partir do modelo
    lib/modelo.js             modelo de bateria/sol/motor/velocidade (puro)
    test/
  dev/                        SignalK local no portátil (package.json + config)
```

Porque em plugins do SignalK: correm no mesmo processo que o OpenPlotter já
instala, e as notificações aparecem nos ecrãs e no telemóvel sem código extra.
Alternativas postas de lado: Node-RED (difícil de testar e de guardar no
GitHub) e um serviço Python à parte (mais um processo para manter).

## Dados lidos (caminhos SignalK)

São os nomes que o plugin `signalk-victron-ble` entrega (verificado no código
dele a 29/09). Os IDs (`servico`, `motor`, `mppt1`, `mppt2`) são configuráveis.

| Dado | Caminho | Unidade |
|---|---|---|
| Carga do serviço | `electrical.batteries.servico.capacity.stateOfCharge` | razão 0–1 |
| Tensão / corrente do serviço | `electrical.batteries.servico.voltage` / `.current` | V / A (+ = a carregar) |
| Tensão da bateria do motor (aux do SmartShunt) | `electrical.batteries.motor.voltage` | V |
| Potência de cada MPPT | `electrical.solar.mppt1.panelPower`, `…mppt2…` | W |
| Rotação do motor | `propulsion.main.revolutions` | Hz |
| Velocidade GPS | `navigation.speedOverGround` | m/s |
| Dia / noite | `environment.mode` (`day`/`night`, do signalk-derived-data) | — |

## Regras dos alarmes (lógica pura em `regras.js`)

| Id | Condição | Estado | Som |
|---|---|---|---|
| `ligarMotor` | SoC ≤ 55% e motor parado | `warn` | bip; repete de 30 em 30 min enquanto ativo |
| `desligarMotor` | SoC ≥ 85% com o motor ligado | `warn` | bip (uma vez) |
| `servicoCritico` | SoC < 50% | `alarm` | contínuo até OK (sempre, também de noite) |
| `motorFraca` | tensão do banco motor < 12,2 V com o motor parado há ≥ 5 min | `alarm` | contínuo até OK (sempre) |

- **Histerese:** `ligarMotor` limpa só acima de 58% ou quando o motor liga.
  `servicoCritico` limpa acima de 52%. `motorFraca` limpa acima de 12,4 V.
- **Silêncio de noite:** com `environment.mode = night` e o barco **parado**, os
  avisos `warn` vão só para o ecrã (`method: ['visual']`). Os `alarm` levam
  sempre som.
- **A navegar:** SOG > 1 nó (0,514 m/s) de forma contínua durante 5 min. Volta a
  "parado" com SOG < 1 nó durante 5 min.
- **Motor ligado:** `revolutions` > 5 Hz (300 rpm).
- **Dados em falta:** SoC sem atualizar há mais de 5 min → um único aviso
  `sensorPerdido` (`warn`, só ecrã).
- A tensão do banco motor só conta com o motor parado há ≥ 5 min, porque com o
  alternador a tensão está sempre alta.

Saída: notificações SignalK em `notifications.arlequin.energia.<id>` com
`state`, `method` e `message` em pt-PT. Quando o besouro estiver ligado ao Pi,
toca nas notificações que tragam `sound` no `method`.

## Sessão de carga pelo motor (`sessao.js`)

- Abre quando o motor liga; fecha quando para (ou se os dados do motor se
  perdem por mais de 2 min).
- Integra os Ah que entram no serviço (corrente positiva × tempo).
- Ao fechar gera: início, fim, duração, Ah carregados, SoC inicial → final.
- Contador total de horas de motor, guardado no disco do plugin e publicado em
  `propulsion.main.runTime` (s), que é o caminho padrão.

## Diário (`diario.js`)

- Sempre: uma linha JSON por sessão em `sessoes-carga.jsonl`, na pasta de
  dados do plugin.
- Opcional (configurável): `POST /plugins/signalk-logbook/logs` com
  `{ text, category: "engine", origin: "auto" }` (campos confirmados no schema do logbook) para aparecer no diário de bordo. Isto fica
  desligado até o logbook estar instalado no Pi.

## Simulador (`modelo.js`)

- 440 Ah AGM, carga inicial configurável.
- Consumos por hora a partir do balanço do §5b: base no porto ~1,1 A, a
  navegar ~5 A, radar e luzes à noite.
- Sol: 2 × 305 W, curva em sino entre o nascer e o pôr do sol, fator 0,55–0,75.
- Aceitação AGM: a corrente de carga cai acima de 80%.
- Alternador: 60 A com o motor ligado.
- Guião de cenário: lista de passos (`{horas, navegar, motor, noite}`) e fator
  de tempo acelerado (por exemplo 1 h simulada = 2 s).
- Emite `environment.mode` próprio para não depender do derived-data em casa.

## Validação

1. Testes unitários às regras, à sessão e ao modelo (`node --test`).
2. Cenário de vários dias acelerado dentro do SignalK real: confirmar que cada
   alarme aparece em `/signalk/v1/api/vessels/self/notifications` no momento
   certo (dia/noite × parado/a navegar) e que as sessões ficam no JSONL.
3. Só depois: instalar no Pi e trocar o simulador pelos dados reais.

## Fora do âmbito

Meshtastic (só após validação), besouro por GPIO (hardware), J1939 do motor
(sub-projeto próprio), ecrã da roda.
