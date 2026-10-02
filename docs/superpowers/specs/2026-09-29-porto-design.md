# ARLEQUIN · Monitorização no porto (desenho)

Data: 29/09/2026 · Aprovado pelo Ivo: **Telegram** + router **Teltonika RUT241**;
intrusão armada à mão com lembrete; deriva > **30 m**; bomba de porão > **4
arranques/h** ou > **3 min seguidos**. Meshtastic só depois de o sistema estar
validado.

## Peças

```
software/signalk-arlequin-porto/
  index.js              plugin: sensores → regras → notificações; Telegram; batimento
  lib/telegram.js       cliente da API do Telegram (long polling, só saída)
  lib/regras.js         deriva, porão, intrusão, sensores simples (lógica pura)
  lib/mensagens.js      que notificações seguem para o Telegram (mudanças de estado)
  lib/resumo.js         texto do /estado
software/dev/telegram-falso.js   servidor que finge o Telegram (testes e demo)
```

- **Sem portas abertas no barco:** o Pi faz long polling ao Telegram (só
  ligações de saída). Só responde ao(s) `chatId` autorizado(s); os outros são
  ignorados e ficam no registo para os autorizar.
- **Token:** criado pelo Ivo no @BotFather e colado por ele na configuração.
- **Batimento:** GET a um URL (healthchecks.io) de 5 em 5 min. Se o barco
  deixar de responder (bateria, Pi, 4G), o serviço avisa o Ivo.

## Sensores (caminhos SignalK configuráveis, 0/1 ou true/false)

`sensors.porao.agua`, `sensors.porao.bomba`, `sensors.gaiuta.aberta`,
`sensors.movimento`, `sensors.fumo`, `sensors.gasoleo.liquido`. Vêm de um
ESP32 (SensESP) ou do GPIO do Pi.

## Regras → `notifications.arlequin.porto.<id>`

| id | Regra | Estado |
|---|---|---|
| `aguaPorao` | sensor de água no porão | alarm |
| `bombaPorao` | bomba > 4 arranques na última hora, ou > 3 min seguidos | alarm |
| `fumo` | detetor de fumo (saída de relé) | emergency |
| `fugaGasoleo` | sensor de líquido debaixo do depósito | alarm |
| `intrusao` | armado e (gaiuta aberta ou movimento) → alarm + fotografia | alarm |
| `deriva` | afastou-se > 30 m do ponto de amarração (limpa < 24 m) | alarm |

- **Ponto de amarração:** gravado sozinho com 30 min parado (SOG < 0,3 nó e
  motor parado), ou com `/amarrar`; apagado com `/largar` ou ao ligar o motor e
  andar.
- **Lembrete de armar:** desarmado e sem movimento há 12 h → mensagem (uma vez
  em cada 12 h).

## Telegram

- **Mensagens:** qualquer notificação que passe a `warn`, `alarm` ou
  `emergency` (de todos os plugins); "✓ resolvido" quando volta a `normal`. Um
  mesmo caminho no máximo de 10 em 10 min enquanto oscilar.
- **Comandos:** `/estado`, `/foto`, `/posicao`, `/armar`, `/desarmar`,
  `/amarrar`, `/largar`, `/ajuda`.
- **Fotografia:** comando configurável que escreve um JPEG (ex.
  `rpicam-still -n -o {ficheiro}`); vai no `/foto` e em cada alarme de
  intrusão.

## Validação

Testes das regras e das mensagens; teste de ponta a ponta com o Telegram
falso (comandos, alarme, foto, utilizador não autorizado); no SignalK local,
eventos do simulador (`POST /plugins/arlequin-simulador/evento`).

## Notas (02/10): o que o código e os desenhos seguintes acrescentaram

- **Quem escreve sem estar autorizado** recebe "Para receberes os planos do ARLEQUIN, dá este
  código ao Ivo: NNNN", no máximo uma vez por hora (desenho 3b-1), e não fica autorizado.
- **Contactos do plano** (`contactosPlano`, nome e código): recebem os planos de navegação e as
  mensagens para terra da 3b-2, mas não comandam; as mensagens deles são ignoradas.
- **Que notificações seguem para o Telegram** (`lib/mensagens.js`): as que passam a `warn`,
  `alert`, `alarm` ou `emergency` (também o `alert`). Algumas só seguem em alarme (`SO_ALARME`: o
  disco da caixa negra e a previsão velha da rota) e outras nunca seguem (`NUNCA`: o lembrete das
  velas, o relógio do Pi, os lembretes da rota, o "come e bebe" e a hora de alarme em terra). Com o
  barco amarrado (ponto de amarração gravado), os alarmes AIS não seguem. Tudo isto só para os
  chats autorizados, nunca para os contactos do plano.
- **O que já foi mandado** fica em `encaminhador.json` (escrita atómica): um reinício do plugin
  não repete os avisos nem o "✓ Resolvido"; depois de um reinício do servidor, um aviso ainda ativo
  volta a seguir uma vez (revisão final da 3b-2, C2: mais vale repetido do que perdido).
