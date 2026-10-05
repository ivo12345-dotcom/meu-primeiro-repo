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

## Notas (02/10): como ficou

- **`desligarMotor` só quando o motor arrancou para carregar:** o aviso "já podes desligar o
  motor" aos 85 % só aparece se o motor arrancou com o aviso dos 55 % ativo ou com o SoC a 58 % ou
  menos. Sair da marina a motor com a bateria cheia não é uma carga (29/09: a simulação Algés →
  Peniche mostrou o aviso ao largar; commit `8d961f4`, `lib/regras.js`).
- **Horas de motor sem duplicados:** a regra está no desenho do J1939 ("Horas de motor sem
  duplicados"): o contador deste plugin só se publica se nenhuma outra fonte tiver publicado
  `propulsion.main.runTime` nos últimos 5 min. (*Nota de 05/10: mudou na auditoria — ver abaixo.*)

## Notas de implementação (auditoria, 02–03/10)

O que a auditoria mudou (frentes F6 e F6b; as decisões do Ivo numeradas como na lista da
auditoria). Verificado no código a 05/10. Onde o texto acima e estas notas diferem, valem estas.

- **Apito** (decisão n.º 2, contrato C1; substitui o "contínuo até OK" da tabela): `servicoCritico` e
  `motorFraca` são `alarm` com `apito: 'curto'` — o ecrã dá o apito curto; o contínuo fica para o
  perigo imediato. Os `warn` continuam como na tabela (e só no ecrã de noite e parado).
- **Horas de motor:** o contador deste plugin só se publica se nenhuma outra fonte (o J1939, as
  horas do MDI) tiver publicado `propulsion.main.runTime` desde que o servidor arrancou; nos
  primeiros 30 s espera. Com a ignição desligada o J1939 deixa de as republicar, mas continuam a ser
  as horas certas. O contador grava-se de minuto a minuto com o motor a trabalhar (`runtime.json`):
  um corte de energia já não as perde (M-65).
- **O relógio dos dados** (M-60): segue só a hora do SoC do SmartShunt (no simulador acelerado, o
  tempo simulado); outra fonte noutro relógio (no dev, o J1939 em hora real; um GPS com outra hora)
  já não o faz saltar. No dev, os cenários acelerados já não precisam do J1939 desligado.
- **Dados velhos** (M-65): sem SoC durante 5 min (desde o arranque ou o último SoC), as regras do
  SoC não se julgam e fica o aviso `sensorPerdido` ("Sem dados do SmartShunt há mais de 5 min", só
  no ecrã); a sessão de carga só conta a corrente e o SoC recentes (2 min e 5 min) e diz "—" sem
  eles; uma falha curta das rotações (até 2 min) não parte a sessão.
- **Reinício** (nota do SignalK 2.33): os alarmes ativos ficam em `alarmes-ativos.json` e voltam a
  publicar-se ao arrancar (até 10 min depois); o `stop()` põe-nos a normal.
- **Permissões** (K-11, contrato C2): `GET /plugins/signalk-arlequin-energia/sessoes` com
  `router.access('readonly')`.
- **Diário:** com a segurança ligada, o `signalk-logbook` só aceita admin: escrever as cargas no
  diário pede um token de admin no campo `token` da configuração deste plugin (fica só aqui, nunca
  no ecrã).
