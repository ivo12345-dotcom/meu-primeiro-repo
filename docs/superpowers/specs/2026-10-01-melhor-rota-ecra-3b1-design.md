# Melhor rota 3b-1 — "Antes de sair": ecrã, mini-mapa e plano pelo Telegram

Data: 01/10/2026. Desenho aprovado pelo Ivo por secções, nesta conversa.

Parte do desenho geral `2026-09-29-melhor-rota-ia-design.md` (Parte 4, "Ecrã, avisos e precauções"), sobre o plugin `signalk-arlequin-rota` já feito na 3a (`2026-09-30-melhor-rota-calculo-design.md`).

> **Nota (auditoria, 05/10):** o que o código faz hoje e este desenho não dizia, e as três frases
> que deixaram de valer, estão nas "Notas de implementação (01–03/10)", no fim. Onde diferem, valem
> as notas.

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
| **A calcular** | <ul><li>O progresso de `GET /resultado/:id`.</li><li>"previsão das HH:MM (há X min), AI v000N · N alternativas" (*nota: ficou no Resultado, não aqui; ver as notas, ponto 5*).</li></ul> |
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

O modo noite e o tamanho de letra são os já aprovados para o ecrã. (*Nota: a 01/10 "os já aprovados" era o modo noite a vermelho; no mesmo dia o Ivo trocou-o pelas cores do dia muito escurecidas, com 5 níveis de brilho. Ver as notas, ponto 10.*)

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

Usa o `POST /ativar` da 3a, sem mudanças. Depois de ativar, a página passa ao estado Leme. (*Nota: a 3b-2 mudou o Ativar — plano ativo, reenvio aos contactos, 409, 422 —: ver as notas, ponto 9.*)

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

- Os avisos `notifications.rota.*` (eventos, desvio, recursos, previsão velha, barómetro, "come e bebe") e o acompanhamento de 30 em 30 min (*nota: na 3b-2 o acompanhamento corre de minuto a minuto, no plugin da rota*).
- A faixa "próximo: …" no Leme.
- A mensagem "cheguei bem".
- A pré-visualização no OpenCPN sem ativar.

## Notas de implementação (01–03/10)

O que ficou no código e este desenho não dizia: as revisões da 3b-1 (01/10) e a auditoria de
02–03/10 (as decisões do Ivo estão numeradas como na lista da auditoria). Verificado no código a
05/10. Onde o texto acima e estas notas diferem, valem estas.

1. **Cálculo antigo e "sem p90" (422).** O `POST /plano-telegram` recusa com 422 um cálculo antigo
   — a hora de alarme já passou, ou a partida foi há mais de 1 h —, com "este cálculo é antigo: … —
   calcula outra vez antes de enviar o plano". Sem a chegada mais tarde (`chegada.p90`) não há hora
   de alarme e o plano não vai (422, "sem hora de chegada mais tarde: não há hora de alarme, o plano
   não foi enviado"). Desde 02/10 (decisão n.º 13) o `POST /ativar` recusa da mesma maneira um
   cálculo antigo ("… antes de ativar"), menos ao voltar a ativar a alternativa do plano aberto (a
   rota apagada no OpenCPN a meio da viagem); e um envio já fechado nunca se reaproveita.
2. **Níveis das rotas.** Com a segurança do SignalK ligada, os GET pedem uma sessão (`readonly`) e
   os POST um utilizador "read/write" (`router.access`). O ecrã entra com uma conta "read/write",
   nunca admin (decisão n.º 20).
3. **"enviado ✓" só com contactos em terra.** O ecrã só diz "enviado ✓ a N contactos em terra" (e
   só então marca a precaução "plano deixado a alguém em terra") quando pelo menos um **contacto do
   plano** o recebeu. Só com o chat do Ivo: a amarelo, "enviado só para o teu chat — nenhum
   contacto em terra recebeu (junta contactos do plano na configuração)".
4. **Porto desligado (503).** Com o plugin porto desligado, o `POST /plano-telegram` responde logo
   503 "o plugin porto está desligado: liga-o em Plugin Config" (não espera os 30 s). Ligado mas sem
   resposta em 30 s: "o plugin porto não respondeu (está ligado? tem o token?)".
5. **A linha da previsão** ("previsão das HH:MM (há X min), AI v000N · N alternativas avaliadas")
   aparece no **Resultado** (`paginas/melhor/resultado.js`), não no "A calcular".
6. **O dia da semana.** No plano e nas mensagens para terra, as horas que não são de hoje levam o
   dia da semana e a data ("qua 30/09 às 10:31"); no ecrã, "amanhã" ou o dia ("sex 02/10").
7. **"a motor (sem vento para vela)".** Uma alternativa "vela e motor" que vai toda a motor chama-se
   assim nos cartões, no plano e na descrição da rota para o OpenCPN.
8. **Mini-mapa.** Os abrigos dos pontos de desistência levam "↩ Nome" (mais pequeno e na cor de
   aviso); o rasto a motor é cinzento **tracejado** (de noite, a vela e o motor ficavam quase com a
   mesma cor).
9. **Ativar** (a frase "sem mudanças" da secção "Ativar"): a 3b-2 mudou-o. O Ativar cria o plano
   ativo ("à espera de sair") e, se os contactos em terra tinham um plano (desta viagem ou de outra
   alternativa), manda-lhes o novo com "Este plano substitui o anterior." Um 2.º toque a meio dá 409
   "já há uma ativação a meio: espera um momento"; com o relógio do Pi a mais de 60 s da hora do GPS,
   o Ativar que mandaria o plano para terra dá 422 (decisão n.º 19). Ver o desenho 3b-2 e as notas
   dele.
10. **Modo noite** ("os já aprovados", secção do ecrã): sem vermelho desde 01/10 — as cores do dia
    muito escurecidas, com − e + e 5 níveis de brilho (por omissão o 2), guardados no ecrã
    (`NAVEGACAO.md` §7a).
11. **O acompanhamento** ("de 30 em 30 min", em "Fora de âmbito"): na 3b-2 corre de minuto a minuto,
    no plugin da rota.
12. **"Sair agora mesmo assim"** (decisão n.º 1, 02/10): uma alternativa que de outro modo ficaria
    excluída (gasóleo < 40 L ou bateria < 50 % à chegada, previsão em falta ou a acabar) aparece a
    laranja, "Não recomendado…", com "Se saíres mesmo assim…" e os avisos vermelhos, e continua a
    poder ativar-se.
13. **Horas de Lisboa** em todas as páginas do ecrã, qualquer que seja o fuso do Pi (decisão n.º 22).
14. **Os nomes dos sítios** levam a preposição certa ("à Nazaré", "ao Porto", "às Berlengas", "em
    Lagoa"): a tabela do ecrã (`lib/rota-texto.js`) é a do plugin da rota (`lib/costa.js`), e um teste
    compara as duas.
