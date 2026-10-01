# Protótipo da melhor rota 3b-1 ("antes de sair"): relatório

Data: 01/10/2026. Requisitos: `docs/superpowers/specs/2026-10-01-melhor-rota-ecra-3b1-design.md` e
`.superpowers/sdd/proto-3b1-brief.md`.

- **Worktree:** `C:\Users\ivo12\AppData\Local\Temp\claude\C--Users-ivo12-Documents\2cde356d-ff9a-44c4-a341-d9e2c01063d7\scratchpad\proto-3b1`
- **Ramo:** `prototipo-3b1`, a partir de `4cc8827` (`claude/piloto-automatico-cwnr0f`). Sem push.
- **Estado:** 7 commits, todos os testes verdes, validação ao vivo feita (ver abaixo).

## Commits

| # | SHA | O que faz |
|---|---|---|
| 1 | `3b8853b` | Rota: `mapa` e `rasto` no resultado (`lib/mapa.js`) |
| 2 | `d57ec81` | Rota: `lib/plano.js` + `lib/gpx.js` + configuração `barco`/`telefones` |
| 3 | `917018b` | Rota: `POST /plano-telegram` e `GET /plano-telegram/:pedido` |
| 4 | `bf93da9` | Porto: `sendDocument`, `contactosPlano`, envio do plano, código para desconhecidos |
| 5 | `53b4825` | Ecrã: funções puras `lib/rota-texto.js` e `lib/mapa.js` (SVG) |
| 6 | `5824f34` | Ecrã: a página "Melhor rota" com estados |
| 7 | `9bb1dd4` | Dev (porto + Telegram falso), validação ao vivo, capturas, NAVEGACAO.md |

### Ficheiros de cada commit

1. `3b8853b`: `software/signalk-arlequin-rota/lib/mapa.js` (novo), `lib/calculo.js`, `lib/costa.js`
   (expõe `aneis`), `test/mapa.test.js` (novo).
2. `d57ec81`: `lib/plano.js`, `lib/gpx.js` (novos), `index.js` (schema e `o.barco`/`o.telefones`),
   `test/plano.test.js`, `test/fixtures/resultado-3b1.json` (novos).
3. `917018b`: `index.js`, `test/index.test.js`.
4. `bf93da9`: `software/signalk-arlequin-porto/index.js`, `lib/telegram.js`, `test/plano.test.js`
   (novo), `test/telegram.test.js`; `software/dev/telegram-falso.js`.
5. `53b4825`: `software/arlequin-ecra/public/lib/rota-texto.js`, `public/lib/mapa.js` (novos),
   `public/estilo.css` (tokens `--mar`, `--terra`), `test/rota-texto.test.mjs`, `test/mapa.test.mjs`,
   `test/estilo.test.mjs`, `test/fixtures/resultado-{canal,direta,fuga}.json.gz` (novos).
6. `5824f34`: `public/paginas/melhor.js`, `public/paginas/melhor/{pedir,resultado,mapa,leme}.js`
   (novos; `leme.js` = o antigo `melhor.js`), `public/app.js`, `public/signalk.js`, `public/estilo.css`,
   `public/lib/mapa.js`, `public/lib/rota-texto.js`, `test/melhor.test.mjs` (novo),
   `test/mapa.test.mjs`, `test/rota-texto.test.mjs`, `test/signalk.test.mjs`.
7. `9bb1dd4`: `NAVEGACAO.md`, `docs/capturas-3b1/*.png` (29), `software/dev/package.json`,
   `software/dev/config/package.json`, `software/dev/config/plugin-config-data/signalk-arlequin-porto.json`
   (novo), e a correção da rota ativa sem `calcValues` em `paginas/melhor.js`, `melhor/leme.js`,
   `melhor/pedir.js`, `test/melhor.test.mjs`.

## Interfaces

### Plugin da rota (`signalk-arlequin-rota`)

**Resultado** (`GET /resultado/:id` → `resultado`), campos novos:
```
mapa: { janela: { latMin, latMax, lonMin, lonMax },
        terra: [[[lat, lon], …], …],              // anéis recortados e simplificados
        zonas: [{ nome, tipo, pontos: [[lat, lon], …] }] } | null
alternativas[i].rasto: [{ lat, lon, t: ISO, motor: bool, noite: bool }]   // 10 em 10 min + a chegada
```

**`lib/mapa.js`**
```
janela(pontos [[lat, lon]], margem = 0.1, spanMin = 0.02) → { latMin, latMax, lonMin, lonMax } | null
recortarAnel(anel [[lon, lat]], janela) → [[lat, lon]]                 // Sutherland–Hodgman
simplificarAnel(anel [[lat, lon]], tolMn, { kx, ky }) → [índices]      // Douglas–Peucker em anel fechado
montarMapa(costa, { pontos: [[lat, lon]] }, { margem: 0.1, toleranciaMn: 0.1, maxPontos: 2000 }) → mapa
```
`costa.aneis` (novo em `lib/costa.js`): os anéis em bruto `[[lon, lat]]` da terra (a mesma das verificações).

**`lib/plano.js`**
```
montarPlano({ resultado, indice, barco, telefones, agora, fuso }) → { texto, gpx, nomeFicheiro }
horaLisboa(t, agora) → "21:05" | "qua 30/09 09:30" | "—"
horaAlarme(alt) → ms (chegada.p90 + 2 h) | null
rotaTexto(alt) → "a 5 MN da costa, via Canal da Berlenga, só motor" | "direta (salto curto), …"
EMERGENCIA_PADRAO = '+351 214 401 919 (MRCC Lisboa, 24 h) ou 112'
```
`nomeFicheiro`: `arlequin-<partida>-<destino>-AAAAMMDD-HHMM.gpx` (hora de Lisboa da partida).

Texto (exemplo real do envio ao vivo):
```
PLANO DE NAVEGAÇÃO · ARLEQUIN
Enviado qui 01/10 10:54 (horas de Lisboa)

Barco: ARLEQUIN, Jeanneau Melody 34
Partida: sex 02/10 23:00 de Peniche
Destino: Nazaré
Rota: a 5 MN da costa, via Canal da Berlenga, vela e motor
Chegada provável: sáb 03/10 07:38 (o mais tarde: sáb 03/10 07:53)
Tripulação: só eu
Até sáb 03/10 às 06:25 ainda volta a Peniche.

Hora de alarme: sáb 03/10 09:53
Se não houver notícias até sáb 03/10 09:53, liga ao Ivo. Se não atender, liga ao MRCC Lisboa +351 214 401 919 (ou 112) e diz: veleiro ARLEQUIN, de Peniche para Nazaré, saída sex 02/10 23:00.

A rota vai em anexo (GPX).
```
("Abrigos pelo caminho: …" aparece quando há abrigos que não são a partida nem o destino.)

**`lib/gpx.js`**
```
gpxRota({ titulo, descricao?, nomeRota?, pontos: [{ lat, lon, nome? }], autor?, quando (ms) }) → XML
```
GPX 1.1, `creator="Arlequin · melhor rota"`, `<metadata>` com nome, descrição, autor e data, um
`<rte>` com `<rtept lat lon><name>` (sem nome: `WP<i>`, como a rota ativada). Texto escapado (`& < > " '`).

**Configuração** (novas): `barco: { nome: 'ARLEQUIN', modelo: 'Jeanneau Melody 34', corCasco: '', mmsi: '', indicativo: '' }`,
`telefones: { ivo: '', emergencia: '+351 214 401 919 (MRCC Lisboa, 24 h) ou 112' }`.

**REST**
```
POST /plano-telegram { id, alternativa (índice ou id) } → 202 { pedido }
     404 { erro: 'cálculo desconhecido' | 'alternativa desconhecida' }; 409 cálculo por acabar;
     503 plugin parado ou servidor sem eventos; 500 se o plano não se montar
GET  /plano-telegram/:pedido → { estado: 'a enviar' | 'enviado' | 'falhou', entregues: [nome],
     falhas: [{ nome, erro }], criado: ISO, motivo? }   (404 pedido desconhecido)
```
Eventos: emite `arlequin:plano { pedido, texto, gpx, nomeFicheiro }`; ouve
`arlequin:plano-enviado { pedido, entregues, falhas }` ("enviado" com ≥ 1 entrega; senão "falhou"
com as falhas ou "não há destinatários…"). 30 s sem resposta → "falhou",
`motivo: 'o plugin porto não respondeu (está ligado? tem o token?)'`; uma resposta depois disso
não conta. `deps.limitePortoMs` (por omissão 30000) só para os testes. Guarda os últimos 20 pedidos.

### Plugin porto (`signalk-arlequin-porto`)

```
lib/telegram.js  sendDocument(chatId, buffer, nomeFicheiro, caption?)   // multipart, campo "document"
config           contactosPlano: [{ nome, chatId }]
```
- Ouve `arlequin:plano`: envia `sendMessage(texto)` + `sendDocument(gpx)` a cada `chatIds`
  (nome `chat <id>`) e `contactosPlano` (sem repetir chats), e emite `arlequin:plano-enviado`.
  Sem token: responde logo `{ entregues: [], falhas: [{ nome: 'Telegram', erro: 'o plugin porto não tem o token do bot' }] }`.
- Mensagens de `contactosPlano`: ignoradas (não comandam, sem resposta).
- Chat desconhecido: "Para receberes os planos do ARLEQUIN, dá este código ao Ivo: <chatId>",
  no máximo uma vez por hora por chat; o estado do plugin continua a mostrar o número.
- `dev/telegram-falso.js`: `sendDocument` (guarda `nomeFicheiro`, `tipo`, `conteudo`), multipart
  lido a sério (também o `sendPhoto`), `bloquear(chatId)` / `POST /_bloquear` (responde 403
  "Forbidden: bot was blocked by the user").

### Ecrã (`arlequin-ecra`)

**`public/lib/rota-texto.js`**: `SEM`, `esc`, `horaLisboa(t, agora)` ("HH:MM" / "amanhã HH:MM" /
"sex 02/10 HH:MM"), `quandoAs(t, agora)` ("às …" / "amanhã às …"), `margem(chegada, agora)`
("amanhã 07:10–08:40"), `num(x, casas)`, `idade(t, agora)`, `rotaCurta(alt)`, `nomeAlternativa(alt)`,
`corVeredicto(tipo)` (verde/amarelo/laranja/vermelho/cinzento), `avisosVermelhos(resultado, i, agora)`,
`avisosGerais(resultado)`, `linhaPrevisao(resultado, agora)`.

**`public/lib/mapa.js`**: `projecao(janela, largura, altura) → { xy(lat, lon), pxPorMn, caixa }`,
`escalaMn(pxPorMn, largura)`, `desenharMapa({ mapa, alternativas, selecionada, noite, desistencia,
partida, destino, agora, largura = 1000, altura? }) → '<svg class="mapa[ noite]" …>'` ('' sem mapa).

**Página**: `paginas/melhor.js` (`vista(ctx)` → leme | pedir | a-calcular | resultado | mapa | erro),
`paginas/melhor/pedir.js` (exporta `URL_ROTA`, `posicaoGps`, `rotaAtiva`, `motivoPlugin`,
`buscarDestinos`, `calcular`, `seguir`, `lerCoordenada`), `melhor/resultado.js` (`render`,
`renderACalcular`, `renderErro`, `botoes`, `marcas`, `acao`), `melhor/mapa.js` (`render`),
`melhor/leme.js`.

`data-acao` novos (tratados pela página através do `acao` que o `app.js` já chama):
`rota-novo`, `rota-destino` (data-id), `rota-tripulacao` (data-t), `rota-calcular`,
`rota-acrescentar`, `rota-acr-aqui`, `rota-acr-coord`, `rota-acr-conhecido`, `rota-acr-gravar`
(também Enter nos campos), `rota-acr-cancelar`, `rota-escolher` (data-i), `rota-precaucao`
(data-id), `rota-mapa`, `rota-voltar`, `rota-plano`, `rota-ativar`, `rota-sair-agora`, `rota-repetir`.

`ctx` ganha (no `app.js`): `noite`, `guardado(k, def)`, `guardar(k, v)`; a página aceita também
`ctx.agora` e `ctx.agendar` (testes). As marcas das precauções ficam em `ctx.estado.marcas` e no
armazenamento do ecrã, chave `arlequin.precaucoes` → `{ [idCalculo]: { [idPrecaucao]: true } }`
(os últimos 10 cálculos). `signalk.js` `pedir`: o erro leva `e.corpo` (num 409, o id do cálculo em curso).

## Testes

- Rota: 189 (eram 169): `test/mapa.test.js` (8), `test/plano.test.js` (9), 3 novos em `test/index.test.js`.
- Porto: 27 (eram 23): `test/plano.test.js` (4); `test/telegram.test.js` ajustado (o desconhecido
  passa a receber o código, por desenho).
- Ecrã: 94 (eram 60): `rota-texto.test.mjs` (9), `mapa.test.mjs` (7), `melhor.test.mjs` (16, com os
  3 resultados gravados — canal, rota direta, fugas com aviso vermelho — de dia e de noite, sem
  null/NaN/undefined), `estilo.test.mjs` (+1), `signalk.test.mjs` (+1).
- Árvore toda (`cd software/dev && npm test`): verde, saída limpa (só ✔/ℹ), pytest 57 passed.
  Rota, ecrã e porto corridos 3 vezes: 189/94/27, sempre verdes.

## Validação ao vivo (SignalK local do worktree, previsão Open-Meteo de 01/10)

- Telegram falso na porta 8081; servidor SignalK na 3000; GPS falso por WebSocket (de 1 em 1 s);
  simulador desligado durante a validação (para a posição não mudar), reposto depois.
- **Peniche → Nazaré:** calculado no browser ("Espera até amanhã às 23:00", as 3 pelo Canal da
  Berlenga), Resultado, Mapa (a 3.ª destacada), **Enviar plano** → "enviado ✓ a 2 contactos" e a
  precaução marcada. No Telegram falso: texto + `arlequin-peniche-nazare-20261002-2300.gpx` nos
  chats 111 (chatIds) e 222 (contactosPlano), conferidos (texto acima; GPX com 25 pontos, nomes
  "Peniche (partida)", "Canal da Berlenga", "Linha de 5 MN", "Largo de Nazaré", "Nazaré").
  "Sair agora mesmo assim" de noite também.
- **Algés → Peniche:** calculado e **Ativar** → rota ativa na API de rumo v2
  (`activeRoute.href` = a gravada, 57 pontos) e a página passa ao Leme.
- Erro do cálculo ("Já estás em Algés (CNA)."), sem GPS e plugin da rota desligado (503).
- Nenhum erro de JavaScript nas páginas; nenhum null/NaN/undefined no texto.
- Capturas: `docs/capturas-3b1/` (29 PNG, 1280×800), cada estado de dia e de noite.
- Parei só os processos que arranquei (servidor, Telegram falso, GPS falso, servidor de
  pré-visualização). A configuração do dev que o servidor reescreveu (`settings.json`,
  `resources-provider.json`) e as que mudei para o teste (`arlequin-simulador.json`,
  `signalk-arlequin-rota.json`) foram repostas.

## Tamanhos medidos (resultado JSON, previsão de 29/09)

| Cálculo | Antes | Depois | `mapa` | rastos | pontos de terra |
|---|---|---|---|---|---|
| Algés → Peniche | 30,7 KB | 59,6 KB | 4,3 KB | 24,6 KB | 152 (3 anéis) |
| Peniche → Nazaré | 18,7 KB | 35,9 KB | 2,5 KB | 14,7 KB | 90 |
| Cascais → Algés | 12,2 KB | 20,0 KB | 1,6 KB | 6,1 KB | 48 |
| Algés → Peniche "sair agora" | 37,1 KB | 67,6 KB | 4,5 KB | 26,0 KB | 152 |

`montarMapa` demora ~5 ms. A terra dos dados já é grosseira: a 0,1 MN fica muito abaixo dos 2000 pontos.

## Desvios ao desenho (e porquê)

1. **"previsão das HH:MM (há X min), AI v000N · N alternativas"** está no topo do **Resultado**, não
   no "A calcular": o `GET /resultado/:id` só traz esses dados quando o cálculo acaba. (Também cobre
   "sem rede: a idade da previsão no topo do resultado".) "N alternativas" = candidatos avaliados.
2. **Horas no plano**: "HH:MM" se for o dia do envio, senão "qua 30/09 HH:MM" (nunca "amanhã": quem
   lê o plano pode lê-lo no dia seguinte); o envio leva a data. No ecrã usa-se "amanhã HH:MM", como o brief pede.
3. **Frase do MRCC**: com o telefone de emergência por omissão sai exatamente a do desenho ("liga ao
   MRCC Lisboa +351 214 401 919 (ou 112)"); se o Ivo o mudar, sai "liga para <o que escreveu>".
4. **"Até … ainda volta a X" e abrigos**: os pontos de desistência só se calculam para a 1.ª
   alternativa (3a). O "até às" só vai no plano da 1.ª; os abrigos (geográficos) vão em todas, sem
   a partida e o destino. No ecrã, as alternativas 2 e 3 dizem que a desistência é da 1.ª.
5. **Precauções marcadas depois do envio**: "plano" e também "plano-hora" (o plano leva a hora de
   alarme), quando existem.
6. **Rota ativa**: além do `calcValues` (o que o Leme antigo usava), a página reconhece a rota
   ativa por `navigation.course.activeRoute`. Encontrado ao vivo: sem um fornecedor de cálculos de
   rumo, o SignalK não manda `calcValues`, e a página voltaria ao Pedir com uma rota ativa. Agora
   mostra o Leme "Rota ativa · à espera do rumo do SignalK", com "Novo cálculo".
7. **Leme**: o código antigo do `melhor.js` mantém-se, com "Novo cálculo" a mais e, sem rumo, o
   estado "Rota ativada / Rota ativa · à espera do rumo" (antes dizia "Sem rota ativa: calcula no OpenCPN").
8. **Mini-mapa**: o nome do abrigo só aparece quando muda de um ponto para o seguinte (evita
   "Peniche" repetido 8 vezes); tudo fica cortado à janela (o mar só na janela).
9. **Ilhéus mais pequenos do que a tolerância** saem do contorno (só tiram terra; nenhum ponto da
   rota fica em terra por isso).
10. **Tokens novos no `estilo.css`**: `--mar`, `--terra` e as cores das faixas (`--segue`,
    `--espera`, `--naorec`, `--volta`, `--faixa-texto`), de dia e de noite.
11. **Nomes dos `chatIds` nas entregas**: `chat <id>` (a configuração não lhes dá nome).

## Problemas encontrados e notas

- **Sem `calcValues` no SignalK do dev**: depois de ativar, o Leme não mostra o rumo a seguir, só
  "Rota ativada · à espera do rumo do SignalK" (captura `09-leme-depois-de-ativar`). Precisa de um
  fornecedor de cálculos de rumo no SignalK (ex.: o plugin `@signalk/course-provider`); no Pi
  convém confirmar. Não instalei nada.
- O Telegram falso também recebeu 2 alarmes de outros plugins ("Sem dados do SmartShunt há mais de
  5 min" e o "Resolvido"), por o porto estar agora ligado no dev: é o encaminhamento normal.
- O ecrã aceita GPS com menos de 10 s (como o chip GPS da barra); na validação foi preciso um GPS
  falso de 1 em 1 s.
- `npm run instalar` e o `npm install` do `software/dev/config` (para o porto) correram no worktree;
  `node_modules` não foram para os commits.
- O dev guarda agora o plugin porto ligado com o Telegram falso (`telegramToken` de teste); sem o
  `npm run telegram-falso` a correr, o porto regista erros de ligação de 10 em 10 s.
