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
  volta a seguir uma vez (revisão final da 3b-2, C2: mais vale repetido do que perdido). (*Nota de
  05/10: mudou na auditoria — um caminho que desaparece e volta ativo em 2 min já não se repete; ver
  abaixo.*)

## Notas de implementação (auditoria, 02–03/10)

O que a auditoria mudou (frentes F4 e F4b; as decisões do Ivo numeradas como na lista da
auditoria, com as Adendas). Verificado no código a 05/10. Onde o texto acima e estas notas diferem,
valem estas.

**Ponto de amarração** (decisão n.º 24 e Adenda 2, "Largar"; substitui o ponto da secção "Regras"):
- **Grava-se sozinho** só com o barco parado 30 min (SOG < 0,3 nó e o motor parado) **junto a um
  porto ou fundeadouro conhecido**: a menos de 1 km da aproximação de um destino da rota
  (`software/signalk-arlequin-rota/dados/destinos.json`, só se lê) ou de um sítio da opção `lugares`
  (por omissão a Ericeira). No mar nunca se grava sozinho; o `/amarrar` grava-o em qualquer sítio.
- **Apaga-se sozinho** só com o motor a trabalhar, o barco a andar (> 1 nó) e o alarme de intrusão
  **desarmado** (uma largada de propósito). Sem motor (ou sem leitura do motor: `calado` ou
  `sem-ligacao` no `propulsion.main.ligacao`) **nunca** se apaga sozinho — só com "Larguei" no ecrã ou
  `/largar` no Telegram. **Armado nunca** se apaga sozinho, nem a motor (tratado como roubo). Nunca
  um "✓ Resolvido" automático por o barco ir depressa (âncora a garrar, amarra partida).
- **"Larguei"** (contrato C10): `POST /plugins/signalk-arlequin-porto/largar` (`router.access(
  'readwrite')`; 503 com o plugin parado) faz o mesmo que o `/largar`: apaga o ponto e recomeça a
  contagem dos 30 min. O alarme "O barco saiu do lugar: está a N m do ponto de amarração" leva
  `acao: 'largar'`, para o ecrã lhe pôr o botão.

**Apito de cada alarme** (decisão n.º 2, contrato C1, Adenda 2): `fumo` (`emergency`), `aguaPorao`,
`bombaPorao` e `fugaGasoleo` com `apito: 'continuo'`; `intrusao` e `deriva` com `apito: 'curto'`.
A bomba de porão dispara com mais de 3 min seguidos ou ao 5.º arranque na última hora (mais de 4).
O fumo reconhecido no ecrã repete um bip curto de 2 em 2 min (é do ecrã).

**Telegram** (K-08, K-09, decisão n.º 17):
- **A fila insiste até entregar:** recuo de 2, 4, 8, 16 e 32 s e depois 60 s (nunca menos do que o
  `retry_after` do Telegram), 1 s entre mensagens; o texto leva "(atrasado N min)" (ou "(atrasado mais
  de 7 dias)"), pelo relógio monotónico. Os alarmes passam à frente (emergência, alarme, aviso, e só
  depois os "Resolvido" e os avisos do plugin), sem trocar a ordem de cada caminho.
- **Uma mensagem que o Telegram recusa sempre** (403, 400 ou 413, em todos os chats) sai ao fim de 3
  recusas, com registo e o aviso "⚠️ O Telegram recusou 3 vezes uma mensagem e desisti dela (…)".
  Falhas de rede, 401, 429 e 5xx nunca contam.
- **Limite de 100 mensagens** na fila: cortam primeiro as oscilações, os casos já resolvidos, os
  avisos do plugin e os "Resolvido" soltos; só em último caso a mensagem ativa menos grave e mais
  antiga (com uma linha no registo). Texto cortado a 4000 letras.
- **O limite dos 10 min** por caminho já não perde um alarme que volta (K-08): fica à espera e segue
  quando passam os 10 min, se ainda estiver ativo.
- **Nota do SignalK 2.33:** um caminho ativo que desaparece da árvore (o plugin dele reiniciou)
  fica como estava: se voltar ativo, não se repete; se voltar normal, ou não voltar em 2 min, sai o
  "✓ Resolvido".
- **Amarrado** (o ponto de amarração gravado e sem a deriva ativa), um alarme AIS não segue e o
  estado não se grava: segue quando deixar de estar amarrado, se ainda estiver ativo.
- **Nunca seguem** (`NUNCA`, contrato C11): também os caminhos que acabam em `.sondaPerdida`,
  `.sensorPerdido` ou `.semLigacao`. O `notifications.rota.relogio` (`warn`) segue.
- **`/ajuda`** (e qualquer outro texto) responde com a lista dos comandos.
- **Ficheiros ilegíveis:** `porto.json` ilegível → grava-se logo um novo e o Ivo recebe, uma vez, "⚠️
  Perdi o estado do porto (porto.json ilegível): o alarme de intrusão ficou desarmado e o ponto de
  amarração apagado. Arma-o outra vez com /armar."; `encaminhador.json` ilegível → "⚠️ Perdi a lista dos
  alarmes do Telegram (encaminhador.json ilegível): as mensagens por entregar perderam-se e os
  alarmes ainda ativos vão chegar outra vez."
- **O token** nunca vai para o registo, o estado, as mensagens nem os ficheiros.
- **A fotografia temporária** leva o número do processo e um contador no nome (dois pedidos no mesmo
  milissegundo já não se pisam).
- **O offset do Telegram** fica entre reinícios do plugin com o mesmo token (um comando a meio não
  corre duas vezes).
- **Reinício:** os alarmes do próprio porto ficam em `porto.json` (`ativos`) e voltam a publicar-se
  ao arrancar; o "✓ Resolvido" sai quando o sensor o diz.
