# Protótipo da melhor rota 3b-2 ("a navegar"): relatório

Desenho: `docs/superpowers/specs/2026-10-01-melhor-rota-navegar-3b2-design.md`. Brief: `.superpowers/sdd/proto-3b2-brief.md`.

- **Worktree:** `C:\Users\ivo12\AppData\Local\Temp\claude\C--Users-ivo12-Documents\2cde356d-ff9a-44c4-a341-d9e2c01063d7\scratchpad\proto-3b2`
- **Ramo:** `prototipo-3b2`, a partir de `93fd96f`. Sem push. A configuração do git não foi mexida.
- **Estado:** 7 commits; `cd software/dev && npm test` verde e com a saída limpa; a validação ao vivo foi feita.

## Commits

| # | SHA | O que faz |
|---|---|---|
| 1 | `d41294a` | Rota: o plano ativo (`plano-ativo.json`), com a saída, a chegada e a rota mudada; o `POST /ativar` cria ou substitui o plano |
| 2 | `2b027f8` | Rota: o acompanhamento (milhas, atraso, eventos deslizados, chegada e recursos) |
| 3 | `66bc26b` | Rota: os avisos a navegar (`notifications.rota.*`) e o ciclo de minuto a minuto |
| 4 | `9cb4c83` | Rota: os contactos em terra (chegada, atrasos, terminada, plano novo) e o REST do plano ativo |
| 5 | `6a9565f` | Porto: os avisos da rota no Telegram do Ivo e as mensagens com `tipo` para os contactos do plano |
| 6 | `129a423` | Ecrã: o Leme a navegar (faixa, Recalcular, Terminar, rota mudada) e o apito curto; o `semVela` no `ativarRota` |
| 7 | `818c5e4` | Dev: a viagem acelerada, a validação ao vivo, as capturas, `NAVEGACAO.md` e os acertos vistos ao vivo |

### Ficheiros de cada commit

1. **`d41294a`**
   - novos: `software/signalk-arlequin-rota/lib/plano-ativo.js`, `test/plano-ativo.test.js`, `test/plano-ativo-plugin.test.js`, `test/ajuda.js`;
   - alterados: `index.js` e `lib/previsao.js` (passa a exportar `escreverAtomico`).
2. **`2b027f8`**
   - novos: `lib/acompanhamento.js`, `test/acompanhamento.test.js`.
3. **`66bc26b`**
   - novos: `lib/avisos-navegar.js`, `test/avisos-navegar.test.js`, `test/navegar-ciclo.test.js`;
   - alterados: `index.js` e `lib/plano.js` (exporta `asHoras`, `semVela` e `posicaoTexto`).
4. **`9cb4c83`**
   - novos: `lib/contactos.js`, `test/contactos.test.js`, `test/contactos-plugin.test.js`;
   - alterados: `index.js`, `test/index.test.js` (as 3 rotas REST novas na lista dos níveis) e `test/plano-ativo-plugin.test.js`.
5. **`6a9565f`**
   - alterados: `software/signalk-arlequin-porto/lib/mensagens.js` e `index.js`;
   - novo: `test/navegar.test.js`.
6. **`129a423`**
   - novos: `software/arlequin-ecra/public/paginas/melhor/navegar.js`, `test/navegar.test.mjs`;
   - alterados no ecrã: `public/paginas/melhor.js`, `public/paginas/melhor/leme.js`, `public/lib/alarmes.js`, `public/estilo.css`;
   - alterados na rota: `index.js`, `lib/plano.js` (`propulsaoTexto`), `test/plano.test.js`, `test/plano-ativo-plugin.test.js`, `test/contactos-plugin.test.js`.
7. **`818c5e4`**
   - novos: `software/dev/viagem-acelerada.js`, `software/dev/test/viagem-acelerada.test.js`, `software/signalk-arlequin-rota/test/hora-simulada.test.js`, `docs/capturas-3b2/*.png` (8);
   - alterados:
     - `software/dev/package.json` (os testes do dev no `npm test`, e `npm run viagem-acelerada`);
     - na rota, `index.js`, `lib/acompanhamento.js`, `lib/avisos-navegar.js` e os testes destes dois;
     - no ecrã, `paginas/melhor/navegar.js` e `test/navegar.test.mjs`;
     - `NAVEGACAO.md`.

## Interfaces

### `lib/plano-ativo.js`

- **Constantes:**
  - `FICHEIRO = 'plano-ativo.json'`;
  - `ESTADOS = { ESPERA: 'a espera de sair', NAVEGAR: 'a navegar', CHEGADO: 'chegado', TERMINADO: 'terminado', PAUSADO: 'pausado' }`;
  - `PADRAO = { saidaMn: 0.5, saidaSogNos: 2, saidaMin: 5, chegadaMn: 0.3, chegadaSogNos: 0.5, chegadaMin: 5 }`.
- **`criarPlano({ idCalculo, resultado, indice, href, aproximacao?, envio?, agora })`** devolve o plano:
  ```
  { versao: 1, idCalculo, indice, ativadoEm, href, estado, pausadoDe, saida, chegou, fechadoEm, tripulacao,
    alternativa: { id, nome, propulsao, semVela, partida, chegada, milhas, horas, gasoleoL, pontosRota, rasto, eventos },
    destino: { id, nome, aproximacao: [[lat, lon]…], cais: { lat, lon } }, partida: { nome, lat, lon },
    desistencia, desistenciaResumo, envio: null | { contactos: [nome], alarme: iso, pedido, enviadoEm, substitui? } }
  ```
- **Campos que o `index.js` junta ao plano:**
  - `seguimento: { s, t }`: a posição na rota, para um reinício;
  - `contactos`: a fila de `lib/contactos.js`;
  - `atrasoEnviado: { ultimoEm, chegada, alarme }`.
- **`avaliar(plano, { posicao | null, sogNos | null, href | null | undefined }, mem, agora)`** devolve `{ plano, mem, mudou }`:
  - `mudou` é `null`, `'saiu'`, `'chegou'`, `'pausado'` ou `'retomado'`;
  - `href` `undefined` quer dizer que não se sabe (a API de rumo falhou): não pausa.
- **Outras funções:** `novaMemoria()`, `aberto(plano)`, `terminar(plano, agora)`, `continuar(plano)`, `gravar(dir, plano)` (atómico, com fsync) e `ler(dir)`, que devolve `{ plano | null, erro | null }`.

### `lib/acompanhamento.js`

- `prepararRota(plano)` devolve `{ linha, tabela: [{ s, t }] }`: o rasto provável projetado sobre a rota, com a janela de passagem.
- `projetar(rota, pos, anterior, agora)`: a janela vai de `s − 0,5 MN` até `s + max(2 MN, 15 nós × dt)`; sem `anterior`, a rota toda.
- `horaNoPlano(tabela, s)` e `atrasoMin(tabela, s, agora)`.
- `juntarAmostra`, `media` (a média de 10 min) e `desvioVento(amostras)`, que devolve `{ medido, previsto, desvioNos, desvioPct }` ou `null`.
- `deslizarEventos(eventos, atraso)` devolve `[{ id: 'e<i>', tipo, texto, curto, sitio, tPlano, t }]`. São de sítio os tipos `partida`, `wp`, `vela`, `motor` e `chegada`; os outros ficam na hora fixa.
- `proximoEvento(deslizados, agora)` e `chegadaDeNoite(t, cais)`.
- `recursos({ plano, tPlano, gasoleoL, socPct, energia, rpm = 2100, atrasoMs, noite?, radiacao? })` devolve `{ horasMotorFaltam, gasoleoChegadaL, bateriaChegadaPct }`.
- `acompanhar(estado, { plano, posicao, agora, gasoleoL, socPct, energia, rpm, radiacao })` devolve `{ estado, resultado }`, com:
  ```
  { estado, semGps, milhas, distRota, atrasoMin, tPlano, chegadaPlano, chegadaAgora, chegadaNoite, eventos, proximo, recursos }
  ```

### `lib/avisos-navegar.js`

- **`avaliar(estado, entrada, agora)`** devolve `{ estado, avisos: { caminho: { state, method: ['visual','sound'], message, apito?, chave? } } }`.
- **A entrada:**
  ```
  { navegar, tripulacao, saida, destino, semGps, atrasoMin, vento, previsaoIdadeH | null,
    barometro: [{ t, hPa }], recursos, eventos, chegadaNoite }
  ```
- **Os caminhos:**
  - `notifications.rota.lembrete.<id>`;
  - `notifications.rota.comer`;
  - `notifications.rota.recalcula`;
  - `notifications.rota.recursos`;
  - `notifications.rota.previsao` (`alarm` com `apito: 'curto'`);
  - `notifications.rota.barometro`.
- **Outras funções:**
  - `publicar(publicados, avisos)` devolve `{ publicados, deltas: [{ path, value }] }`: só as mudanças, e o que desaparece volta a `normal`;
  - `publicadosDaArvore(arvore)`;
  - `juntarPressao` e `quedaEm3h(amostras, agora)`;
  - `LIMITES`, com os números do desenho.

### `lib/contactos.js`

- **Os textos:**
  - `textoChegada({ destino, chegou, agora })`;
  - `textoAtraso({ chegada, alarme, alarmeAntes, agora })`;
  - `textoTerminado({ posicao, agora })`;
  - `textoSubstitui(textoDoPlano)`;
  - `grausMinutos(p)`.
- **`decidirAtraso(atrasoEnviado | null, { chegadaAgora, p90, alarmePlano, agora })`** devolve `{ chegada, alarme, alarmeAntes }` ou `null`.
- **A fila:**
  - forma: `{ fila: [msg], enviadas: [msg], seq }`;
  - `msg`: `{ id, tipo, texto, contactos, gpx?, nomeFicheiro?, criada, tentativas, proxima, estado: 'fila' | 'a enviar', pedido, erro }`;
  - as enviadas levam também `enviadaEm`, `contactos`, `entregues` e `falhas`;
  - funções: `novaFila`, `porNaFila`, `proxima`, `marcarAEnviar`, `resposta`, `falhou` (nova tentativa em 2 min) e `aoArrancar`.
- **`evento(msg, pedido)`** devolve o que se emite em `arlequin:plano`:
  ```
  { pedido, tipo, texto, gpx?, nomeFicheiro?, destinatarios: 'contactos-do-plano', contactos: [nome] }
  ```
  O `gpx` só vai no tipo `plano`.

### O evento para o porto

- `arlequin:plano` leva `{ pedido, tipo: 'plano' | 'chegada' | 'atraso' | 'terminado', texto, gpx?, nomeFicheiro?, destinatarios: 'contactos-do-plano', contactos: [nome] }`.
- O porto envia aos `chatIds` (o Ivo) e aos `contactosPlano` cujo nome está em `contactos`. O GPX só segue no `tipo` `plano`.
- Responde com `arlequin:plano-enviado`, `{ pedido, entregues, contactos, falhas }`, como na 3b-1.
- Sem `destinatarios` (o "Enviar plano" da 3b-1), fica tudo como antes.

### REST (`/plugins/signalk-arlequin-rota`)

O GET tem o nível `readonly` e os POST `readwrite`.

- **`GET /plano-ativo`**: 404 sem plano. Com plano, devolve:
  ```
  { agora, estado, destino: { id, nome, lat, lon }, tripulacao, idCalculo, indice, alternativa: { id, nome },
    partida, saida, chegou, atrasoMin, proximo: { texto, hora } | null, chegadaAgora, chegadaPlano, chegadaNoite,
    recursos: { gasoleoChegadaL, bateriaChegadaPct, semLeitura, aviso }, semGps,
    barometro: { semLeitura, quedaHpa }, previsaoIdadeH, avisos: [{ caminho, state, message }],
    envio: { contactos, alarme, alarmePlano } | null,
    filaContactos: [{ tipo, criada, tentativas, proxima, estado, erro }],
    enviadas: [{ tipo, enviadaEm, contactos }] }
  ```
- **`POST /plano-ativo/terminar`**: devolve `{ ok, estado: 'terminado', contactos }`. Dá 409 sem um plano aberto.
- **`POST /plano-ativo/continuar`**: devolve `{ ok, estado }`. Dá 409 se o plano não estiver pausado e 502 se a API de rumo falhar. Reativa o `href` do plano no ponto a seguir à posição na rota.
- **`POST /ativar`** devolve agora também `planoAtivo: { estado }`. Com um plano aberto já enviado, o plano novo segue para os mesmos contactos. Um 422 (cálculo antigo) não ativa nada e o plano antigo fica.
- **As opções novas do plugin, só para testes:**
  - `horaSimulada` (`false`): o relógio passa a ser o `navigation.datetime`;
  - `cicloSegundos` (`60`).

### O ecrã

- **`paginas/melhor/navegar.js`:**
  - `buscarPlanoAtivo(ctx, forcar)` lê o plano de 10 em 10 s, e logo ao entrar;
  - `planoAberto`, `pausado`, `render(ctx)` e `acao(nome, dados, ctx)`;
  - as ações são `rota-recalcular`, `rota-terminar`, `rota-terminar-sim`, `rota-terminar-nao` e `rota-continuar`.
- **`lib/alarmes.js`:**
  - `deveTocar` devolve `'curto'` com `apito: 'curto'`;
  - `paginaDoAlarme('notifications.rota.…')` leva a `'melhor'`.

## Testes

| Pacote | Antes | Depois |
|---|---|---|
| rota | 216 | 278 |
| porto | 36 | 42 |
| ecrã | 118 | 128 |
| dev (novo) | — | 2 |

- A árvore toda (`cd software/dev && npm test`) está verde, com pytest 57 passed. A saída é limpa: só linhas ✔/ℹ.
- Rota, porto e ecrã correram 3 vezes cada: sempre 278/42/128, sem falhas e sem linhas a mais.
- Os testes usam o relógio injetado (`relogio`, `agendar`, `agendarCiclo`) e o SignalK falso de `test/ajuda.js`.
- **Os limites testados, e o caso ao lado de cada um:**
  - atraso de 29, 30 e 31 min;
  - vento a ±29 % e ±31 %, e 4 nós;
  - 29 e 30 min seguidos;
  - recalcula a apagar com 10 min normal;
  - barómetro: 2,9 e 3,1 hPa, e apaga com 2 hPa;
  - gasóleo a 39 e 40 L; bateria a 49 e 50 %;
  - previsão a 6, 6,2, 12 e 12,6 h, e sem previsão;
  - saída a 0,49 e 0,51 MN, e 4 contra 5 min;
  - chegada a 0,29 e 0,31 MN, e com 0,5 nó.

## Validação ao vivo (01/10, SignalK local do worktree, previsão Open-Meteo do momento)

### A preparação

- **Processos que arranquei:**
  - Telegram falso, PID 29108, porta 8081;
  - SignalK, PID 14852 e depois 12404, porta 3000;
  - a viagem, PID 4448, que acabou sozinha.
- **Configuração mudada só durante o teste**, com cópia antes e reposta no fim (o `git status` do worktree ficou limpo):
  - o simulador desligado;
  - o porto ligado;
  - a rota com `horaSimulada: true` e `cicloSegundos: 1`;
  - a caixa negra desligada a meio, porque o aviso "relógio do Pi desacertado" tapava os avisos da rota na barra.
- **A viagem:** `software/dev/viagem-acelerada.js` a 60× (1 s = 1 min).
  - Algés → Peniche "sair agora", só eu, 70 L e 85 % de SoC.
  - Atraso forçado de 60 min a 30 % da viagem.
  - O barómetro cai 4 hPa em 2 h a partir de 55 %.
  - O gasóleo gasta 2,5 L/h, contra os 1,45 do plano.
- **No fim:**
  - apaguei a rota ativa (`DELETE …/navigation/course`);
  - parei só os meus PIDs;
  - apaguei o `plano-ativo.json` e o `barometro.json` do dev.

### Linha do tempo

Hora real (UTC) · hora da viagem (Lisboa).

1. **16:21:02 · qui 17:21.** Cálculo: "Não recomendado sozinho"; a 1.ª é "Agora, 5 MN, só motor", com chegada às 09:24 e p90 igual a p50.
   - **Plano enviado:** entregue a `chat 111` e a "Teste em terra"; os contactos em terra são `["Teste em terra"]`.
   - **Ativada:** o plano fica "a espera de sair" e passa a "a navegar" um minuto depois (`saida` às 17:22).
2. **Lembretes.** O ecrã mostra-os todos; o Telegram não recebe nenhum.
   - 18:51: `lembrete.e1` alert, "Às 19:21: pôr do sol — luzes, arnês, come antes de escurecer". Apaga-se às 19:21.
   - Captura `01-leme-faixa-lembrete-*`.
   - 20:22: "Come e bebe: 3 h ao leme", durante 15 min; repete às 23:22, 02:22, 05:23 e 08:22.
   - 00:56: `lembrete.e4`, a passagem da frente das 01:26.
3. **Recalcula.**
   - 22:10: atraso forçado (parado).
   - 22:45: `recalcula` warn, "atraso de 30 min sobre o plano" (já com o arredondamento corrigido, diria 31). O chat 111 recebe ⚠️; os contactos não.
   - Captura `02-leme-recalcula-*`.
4. **Atraso aos contactos.** Os dois foram para o 111 e para o 222.
   - 22:13 (21:13Z): "Ainda a navegar, tudo bem. Nova chegada prevista ~sex 02/10 09:25. Nova hora de alarme: sex 02/10 11:25 (em vez de sex 02/10 11:24)."
   - 23:13, uma hora depois: "Nova chegada prevista ~sex 02/10 10:22. Nova hora de alarme: sex 02/10 12:22 (em vez de sex 02/10 11:25)."
   - Depois o atraso ficou nos 60 min e não houve mais mensagens.
5. **Rota mudada.** Com a viagem em pausa:
   - `DELETE` da rota ativa: o plano fica "pausado", os avisos voltam a normal e nada segue para terra.
   - Captura `03-leme-rota-mudada-*`.
   - `POST /plano-ativo/continuar` devolve `{ ok: true, estado: 'a navegar' }` e a rota volta a ficar ativa, com `pointIndex` 16.
6. **Recursos.** 00:46: `recursos` warn, "gasóleo à chegada ~40 L" (o valor era 39,6; com o acerto diz ~39). Vai para o 111.
7. **Barómetro.**
   - 03:41: `barometro` warn, "caiu 3,0 hPa em 3 h" (com o acerto diz 3,1). Vai para o 111.
   - Captura `04-leme-avisos-recursos-barometro-*`.
   - 06:11: normal, e o 111 recebe "✓ Resolvido".
8. **Servidor parado a meio.** Às 16:33:51 real, com a viagem às 03:42, parei e voltei a arrancar o SignalK.
   - O plano continuou do ficheiro: "a navegar", atraso de 60 min e a posição na rota.
   - O barómetro guardado manteve o aviso.
   - Os avisos ativos foram publicados outra vez, porque o servidor novo não os tinha.
   - Nada se repetiu para os contactos: as enviadas continuaram a ser só os 2 atrasos.
9. **Previsão.** 23:21: warn, "Previsão com 6 h" (só no ecrã). 05:22: alarm, com o apito curto, "Previsão com 12 h: confia nos instrumentos e no barómetro". Vai para o 111.
10. **Chegada.** 10:29: chegado.
    - "Cheguei bem a Peniche às 10:24. Obrigado!" segue para o 111 e o 222, uma vez.
    - Todos os `notifications.rota.*` voltam a normal, com os "✓ Resolvido" para o 111.

### Conferido

- O contacto em terra (222) recebeu só o plano (texto + GPX), os 2 atrasos e o "cheguei bem".
- O chat do Ivo (111) recebeu também o recalcula, os recursos, o barómetro, a previsão em alarme e os "Resolvido".
- O 111 não recebeu nenhum lembrete nem nenhum "come e bebe".
- Nas capturas não há erros de JavaScript nem null/NaN/undefined.

## Desvios ao desenho, com a razão

1. **Lembretes de cambar/virar e de rotação do vento > 45°.** A 3a não gera esses eventos: só conta as viragens, e a rotação vem dentro do evento "Passagem da frente". Por isso lembra-se a frente. O evento da chuva e da visibilidade da 3a é a < 3 km, não < 5 km.
2. **A classificação dos eventos, pela forma real `{ t, hora, tipo, texto }`.**
   - O tipo `motor` (motor ligado/desligado) também é de sítio; o desenho não o diz.
   - Os tipos desconhecidos ficam na hora fixa.
3. **"10 min normal" conta-se como os "30 min seguidos"**: da 1.ª à última amostra.
4. **A mensagem de um aviso fica a do momento em que apareceu.** Cada delta novo faz o ecrã apitar outra vez. Só se publica de novo quando muda o estado ou o motivo (a chave do recalcula e dos recursos). A faixa mostra os valores atuais.
5. **Sem GPS:**
   - os lembretes de sítio vão a normal;
   - o recalcula e os recursos ficam como estavam;
   - não se decide nenhum atraso para terra;
   - a fila já decidida continua a sair.
6. **Entrega parcial.** Uma mensagem conta como enviada quando pelo menos um contacto em terra a recebeu; não se repete a quem já a recebeu. Um plano novo entregue passa a ser o envio, para os contactos que o receberam.
7. **Quando o Ativar não reenvia o plano:**
   - quando é a mesma alternativa outra vez (é o mesmo plano, que fica com o estado);
   - quando o Ivo já enviou a nova pelo "Enviar plano" depois de ativar a antiga.
8. **O `GET /plano-ativo` tem campos a mais** (`agora`, `destino.lat/lon`, `envio`, `enviadas`, `avisos`, …). Dá 404 sem plano.
9. **Opções só de testes no plugin da rota:** `horaSimulada` e `cicloSegundos`. O ecrã conta "daqui a X min" com a hora do plugin (o `agora` do GET); no barco é o mesmo relógio. Foram precisas para a viagem acelerada, porque o simulador do dev não acelera.
10. **Os avisos da rota no chip da barra levam à página Melhor rota.** É um acréscimo.
11. **Os números das mensagens arredondam para o lado do aviso** ("31 min", "~39 L", "3,1 hPa"). Foi visto ao vivo.
12. **A bateria à chegada** usa a radiação da previsão no ponto do rasto (sem previsão, sem sol) e a noite pelo sol à hora deslizada.
13. **O vento previsto P50** é o bruto × a razão P50 do modelo `ventoForca`, quando há modelo (`criarCorrecaoVento` da 3a).
14. **A descrição da rota para o OpenCPN** usa `propulsaoTexto` (novo em `lib/plano.js`), o mesmo do plano.

## Problemas encontrados

- **"✓ Resolvido" a dobrar.** Para os recursos e para a previsão, o chat do Ivo recebeu-o duas vezes na chegada, depois do reinício do servidor.
  - Numa experiência isolada (warn → normal) sai um só.
  - Não encontrei a causa. O `encaminhar` do porto não mudou, e os contactos não são afetados.
- **Depois de reiniciar o servidor,** o porto voltou a mandar ao Ivo os avisos que estavam ativos. O encaminhador do porto começa vazio; já era assim antes.
- **Mensagem de atraso logo ao primeiro minuto.** Num plano só a motor, p90 = p50, e o atraso para terra sai com 1 min: "11:25 em vez de 11:24". É o que o desenho diz, mas faz barulho. Talvez o Ivo queira uma margem mínima.
- **Na viagem acelerada:**
  - a caixa negra avisa "relógio desacertado" (desliguei-a durante o teste);
  - o `course-provider` do dev não avança o `nextPoint` com o barco, e o Leme mostra o WP1 e uma XTE grande;
  - a hora da barra de cima é a real, enquanto a viagem vai à frente.
- **As capturas são de antes do acerto dos arredondamentos**: mostram "30 min", "~40 L" e "3,0 hPa".
- **Leme pausado sem rota ativa:** o título diz "Sem rota ativa", mas o texto por baixo continua a ser o da espera pelo rumo.
- **Reinício a meio de um envio para terra:** a mensagem que estava "a enviar" volta à fila e sai outra vez. Se o porto já a tinha entregado antes da queda, o contacto recebe-a duas vezes.
- `npm run instalar` correu no worktree; `node_modules` não entrou nos commits.
