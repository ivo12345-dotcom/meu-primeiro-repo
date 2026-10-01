# Melhor rota 3b-1 — "Antes de sair": ecrã, mini-mapa e plano pelo Telegram

Data: 01/10/2026. Desenho aprovado pelo Ivo por secções, nesta conversa.

Parte do desenho geral `2026-09-29-melhor-rota-ia-design.md` (Parte 4, "Ecrã, avisos e precauções"), sobre o plugin `signalk-arlequin-rota` já feito na 3a (`2026-09-30-melhor-rota-calculo-design.md`).

## Divisão da 3b (decisão do Ivo, 01/10)

- **3b-1 "Antes de sair"** (este documento):
  - a página "Melhor rota" com os estados Pedir, A calcular, Resultado e Mapa;
  - Ativar a rota;
  - Enviar o plano pelo Telegram.
- **3b-2 "A navegar"** (desenho próprio, depois):
  - os avisos 30 min antes de cada evento do plano;
  - o acompanhamento ("recalcula");
  - recursos, previsão velha, barómetro e "come e bebe";
  - a faixa "próximo: rizar às HH:MM" no Leme;
  - a mensagem automática "cheguei bem".

## Decisões do Ivo

| Tema | Decisão |
|---|---|
| Divisão | Antes de sair (3b-1), depois a navegar (3b-2) |
| Onde comparar as alternativas | **Mini-mapa no próprio painel**. O OpenCPN mostra a rota só depois de ativada |
| Plano pelo Telegram | **Plano de navegação completo**: texto com hora de alarme + **ficheiro GPX** |
| Arquitetura do ecrã | A página "Melhor rota" passa a ter estados (abordagem A), em módulos pequenos |

## Ecrã: página "Melhor rota" (`software/arlequin-ecra/public/paginas/melhor.js`)

Com rota ativa, a página mostra o **Leme**. É o que já existe hoje (rumo a seguir, bordos, VIRA AGORA), mais um botão **Novo cálculo**. Sem rota ativa, ou depois de "Novo cálculo", mostra os estados abaixo.

| Estado | Mostra |
|---|---|
| **Pedir** | <ul><li>A lista de destinos: a rota ativa do OpenCPN no topo, depois os portos de `GET /destinos` do mais perto para o mais longe, e "+ acrescentar" (aqui ou por coordenadas, com o `POST /destinos` da 3a).</li><li>**Só eu / 2 ou mais**.</li><li>O botão **Calcular**.</li></ul> |
| **A calcular** | <ul><li>O progresso de `GET /resultado/:id`.</li><li>"previsão das HH:MM (há X min), AI v000N · N alternativas".</li></ul> |
| **Resultado** | <ul><li>A faixa do veredicto, com a cor do tipo (Segue verde, Espera amarelo, Não recomendado laranja, Volta/abriga-te vermelho) e as frases de porquê.</li><li>**3 cartões**, a recomendada destacada.</li><li>Por baixo: a linha do tempo dos avisos, os avisos vermelhos, as precauções e os pontos de desistência (detalhe a seguir).</li><li>Botões **Mapa**, **Enviar plano**, **Ativar esta rota** e **Sair agora mesmo assim** (este recalcula com `sairAgora: true`).</li></ul> |
| **Mapa** | O mini-mapa (secção seguinte). Tocar num cartão destaca essa alternativa |
| **Erro / sem GPS** | Caixa vermelha com o motivo em pt-PT, vindo do plugin ou do próprio ecrã. Nunca há ecrã vazio nem texto técnico |

**Cada cartão mostra:**
- o nome;
- a partida e a chegada provável, com a margem cedo–tarde (`chegada.p10`–`p90`);
- as milhas;
- as horas de vela, motor, noite e leme;
- o vento, a rajada e as ondas máximos;
- o gasóleo (provável e pior caso);
- a bateria mínima.

**Por baixo dos cartões:**
- **Linha do tempo:** os `eventos` e os `avisos` da alternativa.
- **Avisos vermelhos**, sempre visíveis:
  - fuga junto à costa com vento do mar (`abrigo.avisoVermelho` / `voltar.avisoVermelho`);
  - Canal da Berlenga por confirmar (`canal`, `nota`);
  - previsão aproximada ou em falta;
  - gasóleo ou bateria desconhecidos;
  - acima dos limites a solo, com tripulação.
- **Precauções:** caixas para marcar. Não bloqueiam nada. As marcas ficam guardadas no ecrã para esse cálculo.
- **Pontos de desistência:** a frase-resumo, e a lista hora → abrigo → vento.

**Regras de texto:**
- Nenhum campo mostra `null`, `NaN` ou `undefined`. Um valor em falta aparece como "—".
- A rota direta chama-se "direta (salto curto)".
- As horas aparecem em hora de Lisboa, HH:MM, com "amanhã" ou o dia quando não são de hoje.

O modo noite e o tamanho de letra são os já aprovados para o ecrã.

**Módulos do ecrã:**
- `paginas/melhor.js` decide o estado e chama os outros.
- `paginas/melhor/{pedir,resultado,mapa,leme}.js` tratam de um estado cada um. O `leme.js` é o código atual do `melhor.js`.
- `lib/rota-texto.js` tem as funções puras dos cartões, das horas e dos avisos.
- `lib/mapa.js` tem o desenho SVG, também em funções puras.

## Mini-mapa

**Dados**, do plugin da rota. O resultado ganha:
- `mapa: { janela: {latMin, latMax, lonMin, lonMax}, terra: [[[lat,lon]…]…], zonas: [{nome, pontos}] }`:
  - **janela:** abrange as 3 alternativas e os pontos de desistência, com margem de 10%;
  - **terra:** o contorno de `dados/terra.geojson.gz` recortado à janela e simplificado (Douglas–Peucker a ~0,1 MN), com **no máximo ~2000 pontos**. É a mesma costa com que as rotas são verificadas;
  - **zonas:** as zonas a evitar de `dados/zonas.json` dentro da janela (Estelas, Farilhões, separadores, Cachopos).
- `alternativas[i].rasto: [{lat, lon, t, motor, noite}]`: o rasto do cenário provável, de 10 em 10 min. O `calculo.js` já simula esse rasto; passa a pô-lo no resultado.

**Desenho** (`lib/mapa.js`, SVG):
- projeção equirretangular com a escala da longitude corrigida por cos(latitude média);
- terra a cheio, zonas a tracejado vermelho;
- a alternativa destacada a traço grosso e as outras finas;
- o rasto colorido: vela azul, motor cinzento, noite mais escuro;
- marcas nos avisos; bolinhas nos pontos de desistência, com o nome do abrigo;
- a partida e o destino marcados, e uma escala em MN;
- os mesmos tokens de cor do ecrã, de dia e de noite.

## Plano pelo Telegram

**Percurso:**
1. O ecrã chama `POST /plano-telegram { id, alternativa }` no plugin da rota.
2. O plugin da rota monta o texto (`lib/plano.js`) e o GPX (`lib/gpx.js`).
3. O plugin da rota emite o evento `arlequin:plano { pedido, texto, gpx, nomeFicheiro }` (`app.emit`).
4. O plugin porto, que já tem o bot, envia a cada destinatário a mensagem (`sendMessage`) e o GPX (`sendDocument`, novo no `lib/telegram.js`).
5. O porto responde com `arlequin:plano-enviado { pedido, entregues: [nome…], falhas: [{nome, erro}] }`.
6. O plugin da rota guarda o estado. `GET /plano-telegram/:pedido` devolve "a enviar", "enviado" ou "falhou", com a lista.
7. O ecrã mostra "enviado ✓ a N contactos" ou o erro. Sem resposta do porto em 30 s: "o plugin porto não respondeu (está ligado? tem o token?)".

**Texto** (pt-PT, horas de Lisboa):
- **Barco:** ARLEQUIN, Jeanneau Melody 34, cor do casco, MMSI e indicativo. Vêm da configuração do plugin da rota; os campos vazios ficam de fora.
- **Viagem:** partida (hora e porto), destino, e a rota escolhida (afastamento, ou "direta", ou "via Canal da Berlenga").
- **Chegada:** a provável e a mais tarde.
- **Tripulação:** "só eu" ou "2 ou mais".
- **Abrigos pelo caminho**, e a frase "até às HH:MM ainda volta a X".
- **Hora de alarme** = chegada mais tarde (`chegada.p90`) + 2 h:
  > "Se não houver notícias até HH:MM, liga ao Ivo (telefone). Se não atender, liga ao MRCC Lisboa +351 214 401 919 (ou 112) e diz: veleiro ARLEQUIN, de X para Y, saída HH:MM."
- **Telefones por defeito**, na configuração e alteráveis: o do Ivo (vazio até ele o pôr) e o do MRCC Lisboa, **+351 214 401 919**, 24 h. O número foi confirmado em diretórios SAR e no site da Marinha a 01/10/2026.

**GPX:** GPX 1.1 com um `<rte>`, com os pontos da alternativa e os nomes, mais o nome do barco e a data.

**Destinatários** (plugin porto):
- os `chatIds` que já existem: o Ivo e quem pode comandar o barco;
- uma lista nova, **`contactosPlano: [{ nome, chatId }]`**, que **só recebe**. As mensagens e os comandos destes chats são ignorados: não podem /armar, /posicao, etc.

**Entrar na lista:**
- A pessoa manda /start ao bot e recebe: "Para receberes os planos do ARLEQUIN, dá este código ao Ivo: NNNN" (o chatId).
- O Ivo junta o código na configuração. **Ninguém entra sozinho.**
- Hoje o porto já mostra no estado do plugin o número de quem escreve sem autorização. Fica igual, e passa também a responder com o código.

**Precaução:** depois de um envio bem-sucedido, a precaução "plano deixado a alguém em terra" fica marcada.

## Ativar

Usa o `POST /ativar` da 3a, sem mudanças. Depois de ativar, a página passa ao estado Leme.

## Falhas

| Falha | Comportamento |
|---|---|
| Sem GPS | Pedir mostra "sem GPS: não dá para calcular" |
| Plugin da rota desligado | Caixa vermelha "o plugin da rota não responde" |
| Cálculo com erro | O motivo do plugin, em pt-PT |
| Sem rede (previsão em cache) | A idade da previsão no topo do resultado |
| Porto sem token ou desligado | "não foi possível enviar: …", e o resultado continua utilizável |
| Resultado sem `mapa` (versão antiga) | O botão Mapa fica desativado, com a explicação |

## Testes e validação

**Node (`node:test`):**
- **Plugin da rota:**
  - `mapa`: recorte da terra à janela, simplificação (≤ ~2000 pontos, sem cortar cabos: os pontos da rota continuam no mar no contorno simplificado), zonas incluídas;
  - `rasto` de 10 em 10 min;
  - `plano.js`: horas de Lisboa; hora de alarme = p90 + 2 h; canal e rota direta escritos; nunca "null"/"NaN";
  - `gpx.js`: XML válido, com os pontos da alternativa;
  - `POST`/`GET /plano-telegram`: entregue, falhado, e sem resposta em 30 s.
- **Plugin porto:**
  - o evento envia texto + GPX aos `chatIds` e aos `contactosPlano`;
  - um contacto do plano não consegue comandar;
  - um /start desconhecido recebe o código e não fica autorizado;
  - `sendDocument` testado no Telegram falso.
- **Ecrã:**
  - cada estado (Pedir, A calcular, Resultado, Mapa, Leme, erro, sem GPS) dá o HTML esperado a partir de resultados gravados;
  - o mini-mapa a partir de uma rota conhecida;
  - nenhum texto com `null`, `NaN` ou `undefined`.

**Validação ao vivo (SignalK local):**
- Cálculos verdadeiros: Peniche → Nazaré (com o canal) e Algés → Peniche.
- O ecrã verificado no browser em **todos os estados, de dia e de noite**, com capturas mostradas ao Ivo.
- O plano enviado ao **Telegram falso** (`software/dev/telegram-falso.js`), com o texto e o GPX conferidos.
- Ativar uma rota e ver a página passar ao Leme.
- Parar só o servidor arrancado para o teste.
- O envio para o Telegram verdadeiro fica para o Ivo, com o token dele. Não se mexe no token.

## Fora de âmbito (3b-2 e depois)

- Os avisos `notifications.rota.*` (eventos, desvio, recursos, previsão velha, barómetro, "come e bebe") e o acompanhamento de 30 em 30 min.
- A faixa "próximo: …" no Leme.
- A mensagem "cheguei bem".
- A pré-visualização no OpenCPN sem ativar.
