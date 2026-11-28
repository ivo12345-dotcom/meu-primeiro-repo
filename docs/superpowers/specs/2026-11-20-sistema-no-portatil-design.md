# ARLEQUIN · Sistema no portátil, com duas caixas ESP32 (desenho)

Data: 20/11/2026 · Estado: **aprovado pelo Ivo para avançar (22/11: "vamos agora pôr o sistema todo a
funcionar e validar tudo")**; os pontos em aberto continuam em aberto. Nasce das conversas de 20/11 (registo no
`NAVEGACAO.md`, §2b). Substitui, nesta fase, o Raspberry Pi e a MacArthur HAT. Não muda o desenho do
sistema definitivo: prepara-o.

## Objetivo

Pôr o sistema inteiro do Arlequin a funcionar já, **com o portátil no lugar do Raspberry Pi**, e a
gravar a caixa negra desde a primeira viagem. O ecrã deixa de ser um ecrã fixo na roda e passa a ser
o portátil, o tablet ou o telemóvel (o Fold do Ivo, no suporte da roda).

Tudo o que se gravar fica na mesma pasta e no mesmo formato do sistema definitivo, para depois se
passar para lá e acertar a polar, os consumos, as velocidades, as médias e os adornamentos.

## O que entra e o que fica de fora

| Entra nesta fase | Fica para depois |
|---|---|
| Vento (força e direção) | Piloto automático EV-100 (chega em dezembro) |
| Velocidade na água (roda do log) | Vigiar o barco parado e o Telegram |
| Proa, adornamento e caimento | Avisos de alagamento e fumo por LoRa (com as Heltec do Ivo) |
| Motor pelo J1939 (vela ou motor, rotações, horas, temperaturas, alarmes, consumo estimado) | Sonda do gasóleo, água doce, barómetro, frigorífico, sonda de profundidade |
| GPS e AIS (B330) | Baterias Victron (quando o SmartShunt estiver montado) |
| Caixa negra, AI, Melhor rota, Diário, Velas, alarmes | Posição para o radar. O VHF não se liga ao sistema: tem GPS próprio, já ligado (Ivo, 22/11) |
| Sobe e desce do barco na onda, só gravado (decidido pelo Ivo, 21/11) | Altura e período da onda no ecrã (a conta faz-se depois, com dados reais) |

No ecrã, o que fica para depois aparece a "—", como já acontece quando falta uma leitura.

## Visão geral

```
 roda do log ──┐
 mostrador do  ├──► CAIXA 1 (ESP32, selada) ──USB──► PORTÁTIL ◄──USB── AIS B330 (GPS + AIS)
 vento ────────┤        ▲                            │  SignalK + os nossos plugins
 sensor BNO085 ┘        │ rádio das placas           │  caixa negra em ~/arlequin-dados
                        │ (ESP-NOW, sem rede)        │
 motor (J1939) ──► CAIXA 2 (ESP32, junto ao motor)   └──Wi-Fi do Fold──► FOLD (ecrã + internet)
```

Três ideias mandam no desenho:

1. **Caixas simples, inteligência no portátil.** As caixas só leem e mandam os valores em bruto. As
   contas e as calibrações ficam num plugin do SignalK, no portátil. Assim corrige-se uma calibração
   em andamento sem voltar a gravar as placas, e o bruto fica gravado para refazer as contas.
2. **A leitura dos sensores não depende do telemóvel.** A caixa 2 fala com a caixa 1 pelo rádio
   próprio das placas (ESP-NOW), e a caixa 1 fala com o portátil por cabo. O Fold só é preciso para
   ver o ecrã e dar internet.
3. **O computador é trocável.** Quando houver o computador definitivo (Raspberry, Orange Pi ou
   outro), o cabo USB da caixa 1 muda para ele e o resto fica igual.

## Caixa 1: instrumentos

Placa ESP32 da ELEGOO (30 pinos, USB-C), numa caixa de **plástico** selada (metal tapava o rádio e
enganava a bússola), com bucins. Alimentação e dados pelo mesmo cabo USB do portátil.

| Entrada | De onde | Como |
|---|---|---|
| Velocidade na água | Cabo coaxial da roda do log (o mostrador NASA está avariado e sai do circuito) | A bobina dá um sinal fraco: passa por um comparador pequeno e entra num contador de impulsos. Cerca de 2 impulsos por volta; 1 impulso por segundo ≈ 0,2 nós (a confirmar na nossa roda) |
| Vento | Ficha redonda de saída do mostrador NASA Clipper Wind, que continua a funcionar | Chicote feito por nós. Se sair NMEA 0183 (MWV, 4 800 baud), entra numa porta série com adaptação de nível. Se sair só a linguagem do repetidor (versões antigas), lê-se como I²C |
| Proa, adornamento, caimento | Sensor Adafruit BNO085 (ref. 4754), dentro ou junto da caixa | O chip entrega os valores já calculados e calibra-se sozinho. A maneira de o ligar à placa (4 fios ou 10 fios) decide-se na bancada: ver o ponto 12 dos pontos em aberto |
| Movimento do barco na onda (sobe e desce) | O mesmo BNO085 | Aceleração e rotação nos três eixos, lidas pelo menos 100 vezes por segundo; a caixa manda a média de cada décimo de segundo. Ver "Sobe e desce da onda" |

O sensor fica fixo, alinhado com o eixo do barco e longe de ferro, do motor e de cabos com muita
corrente.

**Sítio da caixa 1 (ideia do Ivo, 20/11): no cubículo da bússola do piloto velho, ao lado da cama
da cabine de popa,** com o BNO085 dentro da mesma caixa. É um sítio seco e resolve o problema do
cabo curto do sensor. Regras da caixa:

- o sensor a 15 cm ou mais da placa e dos fios de alimentação, porque a corrente da placa e as
  peças de aço dela também enganam a bússola; os fios de alimentação torcidos. Os fios do sensor
  soldam-se à medida, em cabo de silicone (Ivo, 22/11). A primeira versão da base tinha 12 cm,
  que era onde chegava o cabo de encaixe de 20 cm; com os fios soldados voltou aos 15.
- **sem parafusos (ideia do Ivo):** nada de metal dentro da caixa. Da base saem quatro espigões
  maciços por placa, nas posições dos furos; a placa enfia-se neles e prende-se com uma gota de
  cola em cima de cada espigão. (A primeira versão tinha estacas soltas a entrar à pressão em
  apoios de furo fendido; no ensaio do Ivo com as placas verdadeiras alguns apoios partiram, e a
  ideia dos espigões é dele, de 22/11);
- fita isoladora líquida só nos fios, nas soldaduras e nas fichas, para não se soltarem com a
  vibração; as placas têm de poder sair. Testar primeiro num resto do mesmo plástico, porque o
  solvente pode atacá-lo;
- caixa em PETG ou ASA (o PLA amolece com o calor do verão);
- a 20–30 cm, pelo menos, da bússola do piloto velho.

**Base da caixa 1, versão 2 (redesenhada a 22/11 à noite, depois do ensaio do Ivo; por imprimir).**
Gera-se com `software/ferramentas/caixas/caixa1_base.py`; os ficheiros para imprimir e as imagens
estão em `docs/caixas/`.

- Base de 280 × 52 mm (76 mm nas orelhas) e só 13 mm de altura, com o fundo de 3 mm e um rebordo de
  5 mm onde vai encaixar a tampa. É uma peça só: já não há estacas soltas.
- **As duas placas ficam de pinos para cima**, para os fios se ligarem por cima, à vista (foi como o
  Ivo as montou na peça de ensaio; com os pinos para baixo não havia espaço para as fichas dos
  fios). O sensor fica numa ponta, a 4 mm do fundo; o ESP32 15 cm adiante, a 6 mm do fundo, com o
  lado das peças para baixo. Os botões e a luz da placa ficam por baixo: não fazem falta no uso (a
  placa grava-se pelo USB sem tocar nos botões, confirmado na bancada).
- **Torres do ESP32:** um pé de 6 mm de diâmetro, um espigão de 2,6 mm que atravessa o furo, e um
  quarto de anel do lado de fora de cada furo, onde o canto da placa pousa. O pé acaba abaixo dos
  botões, que ficam encostados aos furos. Por baixo da tampa de metal do módulo e da tomada USB
  há dois batentes, 0,3 mm abaixo delas: seguram a placa quando se carrega nas fichas dos fios.
- **Torres do sensor:** um anel de 4,6 mm à volta de cada furo, onde a placa pousa, e um espigão de
  2,1 mm.
- O cabo USB sai por baixo da placa e prende-se a um berço com uma abraçadeira de plástico, para a
  ficha não trabalhar na tomada com o balanço. A abraçadeira passa por duas ranhuras do fundo e por
  um rasgo por baixo da base, sem a levantar. Os fios do sensor prendem-se ao fundo da mesma
  maneira, em dois sítios.
- Quatro orelhas com furo de 4,3 mm para fixar a caixa com parafusos de latão ou de nylon; a tampa
  prende pelos mesmos parafusos.
- Uma seta em relevo com a palavra PROA. Diz só para que lado a caixa aponta; o sítio da caixa não
  muda, é o cubículo da cabine de popa. A seta aponta para a ponta dos cabos, para o sensor ficar
  do lado da popa, mais longe do motor. Se no cubículo a caixa tiver de ficar virada de outra
  maneira, monta-se como couber e acerta-se no programa. (A primeira versão dizia "eixo do barco" e
  o Ivo leu, com razão, que a caixa ia para o meio do barco; corrigido a 22/11.)
- Marcas nas pontas e nos lados (o sítio do sensor), para as medidas do ponto em aberto 11.
- Peça de ensaio (`caixa1-ensaio.stl`, 96 × 35 mm): os dois bocados da base onde as placas
  assentam, cortados da própria base e postos lado a lado. Serve para ver com as placas verdadeiras
  se os espigões entram e se as placas pousam, antes da base inteira.

Verificado no modelo: nada bate em nada (as duas placas, as peças de baixo do ESP32, os pinos, as
fichas dos fios e a ficha do cabo USB), as placas têm onde pousar, e o programa diz com quantos
centímetros se corta cada fio do sensor (23 a 26 cm). A distância entre os furos do ESP32 ficou
confirmada pela primeira peça de ensaio (as placas entraram). Por confirmar: as posições das peças
de baixo do ESP32 (os botões, a tomada, o módulo), que vieram da fotografia do anúncio, com um erro
de cerca de 0,2 mm; e o espaço no cubículo (com as fichas dos fios nos pinos, a caixa fechada fica
com cerca de 280 × 76 × 35 mm). Fica para depois: a tampa, as saídas dos cabos e o sítio do pequeno
circuito do log e do vento (há 12 cm livres entre o sensor e o ESP32). Com o sensor montado como no
desenho (a fila do VIN do lado oposto à palavra PROA, e a seta X impressa no sensor a apontar para
onde aponta a seta da base), o eixo dele que aponta à proa é o X: na configuração do plugin das
caixas fica `eixoProa: '+x'`, a confirmar com a bússola na bancada.

**Bancada de 28/11 (01:20–01:32), com o sensor novo na base: o X está ao comprido, mas parece
apontar para a popa.** O Ivo inclinou a base para um lado e para o outro, ao comprido, com a caixa 1
à escuta. O sensor sentiu os dois gestos no eixo Y dele (52° e 28°) e quase nada no X, o que
confirma que o X está ao comprido da base. Pela descrição do Ivo (a placa do ESP32 do lado dele e o
sensor adiante; primeiro para a esquerda, depois para a direita), a seta X aponta para a ponta do
sensor, que é a da popa: a configuração seria `eixoProa: '-x'`, com `eixoCima: '+z'`, e não `'+x'`.
**Por confirmar** com a prova que não depende de esquerda e direita: levantar a ponta da ficha USB
(a proa da base) e ver o caimento subir. Só depois se muda a configuração do `software/bordo`, que
hoje tem `'+y'` (o valor por omissão do plugin) nos três perfis: com ela, um adornamento sai como
caimento.

**Confirmado a 28/11, às 09:19: `eixoProa: '-x'`, `eixoCima: '+z'`.** Com a caixa 1 à escuta e as
contas feitas com essa montagem, o Ivo levantou a ponta da ficha USB uns três dedos, segurou e
pousou: o caimento subiu de -3,3° para +6,8° (cerca de 10°, que é o que três dedos dão em 28 cm de
base), ficou assim 5 s e voltou; o adornamento não mexeu (+2,5°). A proa subiu, como devia. O
sensor está portanto montado com a seta X para a popa, ao contrário do que este desenho previa, e
fica assim: acerta-se no programa, não na base. Mudado no modelo do `software/bordo` e na
configuração do barco. No modo de ensaio (a caixa a fingir, ou os geradores de bancada da caixa
verdadeira) vale a montagem de quem finge, eixo y à proa e z para cima, e o `preparar.js` passou a
pô-la por cima da do barco: sem isso o adornamento a fingir saía como caimento.

Os chicotes do vento e do log passam a ir para a cabine de popa, e não para a mesa de navegação.
**Ligação ao portátil:** cabo USB se o portátil ficar até 5 m (dá também a alimentação). Se não
chegar, a caixa 1 fala pelo rádio das placas com uma terceira placa pequena ligada ao USB do
portátil. O Wi-Fi fica de fora para os sensores, porque dependia da rede do Fold.

## Caixa 2: motor

A segunda placa ESP32 da ELEGOO, na derivação soldada à cablagem do MDI que já estava decidida
(`NAVEGACAO.md`, "Motor J1939: compras": pinos 5 CAN-H, 2 CAN-L e 4 massa; o pino 6 não se toca).

**Onde se faz a derivação (Ivo, 22/11): primeiro tenta-se por trás do painel do motor; se não der,
no chicote junto ao motor.** O par de fios dos dados vai da caixa do motor (MDI) ao mostrador do
painel, por isso é o mesmo nas duas pontas, e a caixa 2 fica junto do sítio onde se fizer a
derivação (no máximo a 50 cm). O painel tem três vantagens: é mais seco e mais fresco do que a casa
do motor, chega-se lá melhor, e é onde estão os botões de ligar e desligar que o Ivo quer comandar
mais tarde. Antes de mexer: fotos das costas do painel e da caixa MDI, e identificar os fios com o
multímetro, com tudo desligado (60 a 120 Ω entre os dois fios dos dados).

**Costas do painel, primeira vista (Ivo, 23/11, fotogramas de um vídeo):**

- O conta-rotações tem nas costas a ficha de 6 fios do cabo de dados do motor (cinzenta, com o fecho
  laranja; cabo de manga amarela, depois vermelha). É aí que se tenta a derivação. Veem-se dois fios
  amarelos, um branco, um preto e um vermelho, mas ainda não que fio entra em cada número da ficha
  (resolvido a 25/11 com duas fotos de perto: ver "A ficha de 6 pinos, vista de perto", abaixo).
- A outra ficha do conta-rotações, pequena, de 3 fios (vermelho, azul, amarelo), é a saída para os
  mostradores extra da Volvo. O mostrador branco pequeno ligado a ela (ficha vermelha, do lado
  esquerdo visto por trás) é o do **nível do combustível** (Ivo, 23/11). **Pista a confirmar na
  primeira escuta:** se o nível aparece num mostrador da Volvo alimentado pelo conta-rotações, é
  provável que o valor também vá no cabo de dados, e nesse caso a caixa 2 lê-o sem sonda nossa. (O
  `NAVEGACAO.md` §2b dava o nível do gasóleo como fora da caixa do motor, por se julgar que o medidor
  era só analógico.)
  **Corrigido a 25/11, com as fotos da frente e das costas lado a lado:** esse mostrador branco
  pequeno é o da **temperatura da água** (na frente: em baixo, à direita, da Volvo, com o símbolo
  do termómetro), e não o do gasóleo. A pista do nível do gasóleo no cabo de dados cai, e o
  `NAVEGACAO.md` §2b fica como estava: o gasóleo tem um mostrador à parte (ver o ponto das costas
  verdes, abaixo).
- Visto por trás, o painel fica ao contrário: o conta-rotações está à esquerda na frente do painel
  e à direita nas costas.
- O Ivo viu nas imagens que as costas de uma das fichas têm **letras em vez de números** (por
  exemplo, parece ler-se "óleo" junto ao fio amarelo e branco): por confirmar em que ficha, com
  uma imagem melhor.
- Os fios vermelhos grossos no cimo do painel vão aos interruptores das **duas ventoinhas do cofre do
  motor** (uma mete ar, a outra tira; explicado pelo Ivo). Não têm que ver com os dados do motor, mas
  são motores: a derivação e a caixa 2 ficam afastadas desses fios.
- Há ainda um mostrador antigo de ponteiro, de costas verdes, com três pernos e um fio cinzento:
  por identificar pela frente do painel (se for o do gasóleo, o fio cinzento é o da sonda).
  **Identificado a 25/11: é o do gasóleo** (na frente: em cima, à direita, branco, com "FUEL"; não
  tem a marca da Volvo). Tem fios próprios nos três pernos e não entra na corrente dos mostradores
  da Volvo.
- As etiquetas dos fios são de dois tipos (Ivo, 23/11): umas têm números (referências), outras têm
  a descrição escrita à mão.
- O Ivo tem um vídeo das costas do painel inteiro, que não cabe no envio pelo telemóvel (limite de
  30 MB): passa-se para o portátil e tiram-se de lá as imagens.
- Faltam: a frente do painel inteiro (não está nas notas nem nas fotos guardadas), uma vista de
  mais longe das costas (espaço e folga do cabo) e os números da etiqueta branca e da manga vermelha
  do cabo de dados. **25/11: a frente e a vista de mais longe já vieram** (ver "Frente e costas do
  painel", abaixo). Dos números, na manga vermelha lê-se algo como "T3886666" e na etiqueta branca
  só "884…": por ler no barco.

**Frente e costas do painel (fotos do Ivo, 25/11, 15:09).** Foto marcada, com as duas vistas e as
mesmas marcas em ambas: `docs/caixas/caixa2-painel-frente-e-costas.jpg`.

- **De frente:** à esquerda o conta-rotações (com o conta-horas: **1363,9 h** a 25/11/2026, lidas
  pelo Ivo no mostrador); ao meio o conjunto dos botões (quadrado, "EVC", quatro botões: ligar o
  painel, arranque, calar o alarme/brilho e STOP); à direita, em baixo, a temperatura da água (da
  Volvo) e, em cima, o gasóleo (à parte); no cimo, ao meio, três comandos que não são do motor (os
  interruptores das duas ventoinhas do cofre do motor, explicados pelo Ivo a 23/11, e um botão de
  pressão).
- **Por trás, a ficha dos dados** é a de 6 pinos nas costas do conta-rotações, com o cabo de manga
  amarela e depois vermelha. É aí a derivação da caixa 2 (pinos 2, 5 e 4).
- **Por trás, o conjunto dos botões** é o corpo preto redondo, preso por uma porca grande. O cabo
  **sai de dentro dele, moldado, sem ficha**: um cabo preto redondo, mais fino do que o dos dados
  (o Ivo: "é o fio mais fino, já sei qual é"). Vai para a direita, preso com abraçadeiras aos
  outros cabos, e sai da foto: **falta saber onde tem a ficha de 6 pinos** (atrás do painel, mais
  adiante, ou só na caixa do motor).
- **Consequência para a derivação:** na ponta do painel as duas ligações não se confundem. A dos
  dados encaixa no conta-rotações; a dos botões não tem ficha nenhuma no conjunto. O risco de as
  trocar fica só na caixa do motor, onde as duas fichas de 6 pinos entram lado a lado.
- **Os três fios da ficha pequena do conta-rotações** descem a uma junção preta de 3 pinos, seguem
  para o mostrador da temperatura e saem dele para a ficha com tampão (a saída livre).
- **Espaço para a caixa 2:** por baixo dos mostradores há uma cavidade aberta em fibra, com sítio
  livre a menos de 50 cm da ficha do conta-rotações. Os fios vermelhos das ventoinhas passam por
  lá: a caixa e a derivação ficam afastadas deles, como já estava escrito. Por decidir: como se
  prende a caixa (sem furar para fora).

**A ficha de 6 pinos, vista de perto (Ivo, 25/11: duas fotos com a ficha desligada, do lado onde os
fios entram).** Foto marcada: `docs/caixas/caixa2-ficha-conta-rotacoes-fios.jpg`. A ficha é uma
Deutsch (lê-se "DEUTSCH" na borracha laranja) e tem **seis fios**, não cinco: há um segundo fio
branco, que numa das fotos fica escondido atrás do vermelho.

| Pino | Fio | O que é | Derivação |
|---|---|---|---|
| 1 | amarelo com cinzento, fino | a outra linha de dados (CAN-L) | não |
| **2** | amarelo, fino | **dados do motor, CAN-L** | **sim** |
| 3 | branco, fino | a outra linha de dados (CAN-H) | não |
| **4** | preto, grosso | **massa** | **sim** |
| **5** | branco, fino | **dados do motor, CAN-H** | **sim** |
| 6 | vermelho, grosso | +12 V | não se toca |

- **Na ficha:** uma fila tem, por ordem, branco (3), amarelo (2) e amarelo com cinzento (1); a outra
  tem preto (4), branco (5) e vermelho (6). O 1 e o 6 ficam do lado da lingueta do fecho. **O 2 e o 5
  são os dois buracos do meio, um em frente ao outro**, e isso vale mesmo que a numeração das pontas
  estivesse trocada.
- **De onde vêm os números:** junto ao buraco do fio branco de canto lê-se um "3" moldado no
  plástico e junto ao do amarelo um "2" (no limite do que a foto deixa ler); o preto e o vermelho
  estão nas pontas da outra fila, que é onde as duas fontes põem a massa (4) e os +12 V (6).
- **De onde vem o que cada pino faz:** o projeto aberto num D1/D2 com MDI (2 = CAN-L, 5 = CAN-H,
  4 = massa, 6 = positivo; 1 e 3 sem uso nesse barco) e a tabela do
  [cabo adaptador da CSS Electronics para esta ficha da Volvo](https://www.csselectronics.com/products/dt06-deutsch-adapter-cable-volvo-penta-engine)
  (1 = CAN-L e 3 = CAN-H de uma linha; 2 = CAN-L e 5 = CAN-H da outra; 4 = massa; 6 = alimentação),
  lidos a 25/11. Coincidem nos pinos 2 e 5.
- **Há dois fios brancos e dois amarelos.** Ao longo do cabo não se distinguem pela cor (e os finos
  podem ser de duas cores e mostrar uma ou outra conforme o lado por onde se olha): segue-se cada fio
  desde o buraco da ficha, ou confirma-se com o multímetro em continuidade.
- **Continua por fazer antes de soldar** (já estava no plano): com tudo desligado, 60 a 120 Ω entre
  o 2 e o 5. Se a primeira escuta não mostrar nada no par 2/5, experimenta-se o par 1/3: a caixa 2
  só escuta, por isso a experiência não estraga nada.
- **O par 1/3 (pergunta do Ivo a 25/11: que dados lá vão?).** Fonte oficial, lida a 25/11: o manual
  de oficina da Volvo Penta para este motor (Grupo 30, sistema elétrico, D1-13 B, D1-20 B, D1-30 B,
  D2-40 B, de 2007, p. 27 e 43;
  [página 45 no manualslib](https://www.manualslib.com/manual/2158057/Volvo-D1-13-B.html?page=45))
  dá a ficha "Multi link" assim: 1 CAN L, 2 CAN L, 3 CAN H, 4 negativo, 5 CAN H, 6 positivo, e diz
  que o multilink tem "dois pares de fios de comunicação CAN e a alimentação". Bate com as cores da
  foto: os dois amarelos são os L e os dois brancos os H. Ou seja, o par 1/3 é outra vez a linha de
  dados. O manual não diz se os dois pares levam os mesmos dados nem se estão unidos por dentro (no
  barco do projeto aberto o 1 e o 3 nem são usados). **Tira-se a dúvida no barco, com a ficha e a
  chave desligadas:** resistência entre o 2 e o 5 e entre o 1 e o 3 (perto de 120 Ω, ou 60, numa
  linha viva; sem leitura quer dizer par vazio) e continuidade entre o 1 e o 2 e entre o 3 e o 5
  (se der, os dois pares são a mesma linha).
- **A ficha de 3 pinos** (preta, com três vedantes laranja; fios amarelo, azul e vermelho): os três
  fios vêm do conta-rotações e entram num mostrador pequeno, numa placa nas costas dele; do outro
  lado da placa sai outro chicote de três fios, que acaba numa ficha com tampão (Ivo, 25/11; ele
  não tem a certeza de que mostrador é, fica para a foto da frente do painel). Bate com a cadeia
  de mostradores extra que se liga atrás do conta-rotações: entra num mostrador e sai para o
  seguinte, e a ficha com tampão é a saída livre. A caixa 2 não lhe toca. **Visto nas fotos das
  15:09: o mostrador é o da temperatura da água**, e pelo caminho os três fios passam por uma
  junção preta de 3 pinos (ver "Frente e costas do painel", acima).

- Um módulo transcetor CAN de 3,3 V liga a derivação à placa, **só em escuta** (a placa nunca
  escreve no barramento do motor).
- Alimentação pelos 12 V do barco, com fusível e um conversor 12 → 5 V. O conversor acaba numa
  ficha USB-C que entra na placa: **a caixa 2 não leva cabo USB ao portátil** (dúvida do Ivo a
  24/11). Na bancada as duas placas estiveram no USB do portátil só para terem corrente e para se
  lhes gravar o programa. **Por decidir (apontado a 25/11): de que ponto, por trás do painel, saem
  esses 12 V.** Do pino 6 da ficha dos dados não é (não se toca). Convém um ponto que se apague
  com o corta-corrente das baterias, para a caixa não gastar bateria com o barco fechado: a placa
  tem o rádio sempre ligado (estimativa de Claude: à volta de 0,05 A tirados aos 12 V, ou seja,
  pouco mais de 1 Ah por dia; mede-se em casa, com o multímetro em série, quando o conversor
  estiver ligado).
- Manda cada trama para a caixa 1 pelo rádio das placas (ESP-NOW). Não há fio entre o motor e o
  portátil, por isso não há caminho elétrico entre a massa do motor e o USB do portátil.

A caixa 2 fica o mais simples possível (lê e reenvia), para raramente precisar de ser regravada.

## Das caixas para o portátil

A caixa 1 manda pelo USB linhas de texto, uma por leitura: impulsos do log, a frase do vento, o
sensor BNO085 numa só linha (10 por segundo, com a aceleração, a rotação, a orientação completa e
um número de ordem para se ver se faltou alguma), tramas do motor reenviadas no formato
`candump -L` (o mesmo que o plugin do motor já lê) e, de segundo a segundo, um batimento de cada
caixa (viva, contadores, força do rádio). Os campos exatos estão em
`docs/superpowers/plans/2026-11-22-sistema-no-portatil-parte1.md`, "A linguagem das linhas".

**Como ficou a 23/11, com o programa das caixas** (`software/caixas`, plano em
`docs/superpowers/plans/2026-11-23-sistema-no-portatil-parte2-caixas.md`):

- **Todas as linhas levam soma de controlo**, as do motor também: uma linha que o cabo estrague é
  deitada fora no portátil, em vez de dar um valor errado.
- **O batimento da caixa 1 diz também como está o sensor de movimento** (a medir, a arrancar, calado,
  não volta, a fingir), o motivo do último arranque da placa e as vezes que mandou o sensor
  recomeçar. O ecrã avisa quando o sensor não responde.
- **As caixas trazem sinais a fingir lá dentro** (roda, vento, movimento, motor), para se ensaiar o
  caminho inteiro em casa. Só se ligam por ordem do portátil, nunca ficam gravados, e a caixa diz
  sempre que está a fingir.
- **Medido na placa verdadeira, com o programa do barco em modo de ensaio:** a 460 800 baud, 2 329
  linhas em 3 minutos sem uma estragada (a 921 600, na bancada da véspera, estragavam-se 1,4 %); o
  portátil achou a caixa sozinho entre as portas USB; uma caixa presa recomeça sozinha em 5 segundos.
  A taxa de linhas estragadas numa hora seguida mediu-se depois, com as duas caixas (abaixo).
- **Com as duas caixas (23/11 à tarde):** o motor a fingir chega ao portátil pelo rádio (2100
  rotações, 82 °C, 14,2 V; rádio a −20/−26 dBm com as placas lado a lado, sem pacotes perdidos); com
  as duas placas ligadas por USB o portátil escolhe sozinho a caixa 1; quando a caixa 2 recomeça ou
  se cala, a caixa 1 continua sem um soluço.
- **O cabo USB tirado e posto (Ivo, 23/11, 15:22):** em menos de 5 segundos os valores passaram a
  vazio, a caixa 1 a "sem ligação" e o aviso acendeu; com o cabo de volta, o programa achou a porta
  sozinho e voltou tudo em cerca de um segundo, o motor pelo rádio incluído. A placa perdeu a
  corrente, por isso os sinais a fingir dela desligaram-se e o ecrã passou a avisar "o sensor de
  movimento não responde", que era verdade.

**A ponte USB das placas tem duas manias, vistas a 23/11 neste portátil** (a ponte é o chip CP2102 da
placa ELEGOO; a causa não se sabe, vêm e vão com o tempo, e o programa das caixas não tem culpa: os
dois defeitos têm o tamanho de um pacote USB ou chegam mais depressa do que o fio leva):

1. **Enxurrada de cópias ao abrir a porta.** Depois de a porta estar fechada uns segundos com a caixa
   a mandar poucas linhas, a abertura entregou por vezes 120 a 280 KB de cópias das últimas linhas,
   tudo no primeiro segundo. Visto com duas bibliotecas diferentes (das 14:14 às 14:30; depois deixou
   de aparecer). São linhas válidas, só que aos milhares. **Proteção:** o plugin das caixas deita fora
   uma linha igual à anterior chegada menos de 20 ms depois dela, e conta-as à parte.
2. **Um bocado de 64 bytes vazios (FF) no meio dos dados.** Das 14:57 às 15:22, com as duas caixas a
   mandar 29 linhas por segundo, apareceu um de 40 em 40 a 80 em 80 segundos: perde-se a linha que
   ele tapa e a seguinte fica colada a ele (16 linhas inválidas em 49 000). Antes e depois desse
   período, com o mesmo programa a ler e com outro, 26 000 linhas seguidas sem nenhuma. Atrasar de
   propósito a leitura até 6 segundos não o provoca. **Proteção:** a soma de controlo deita fora a
   linha colada, e o número de ordem do movimento diz quantas leituras faltaram; o plugin guarda as
   últimas 10 linhas inválidas, com a hora, para se ver o que são. Nenhum valor errado chega ao ecrã
   nem à gravação: perdem-se uma ou duas linhas por minuto nos períodos maus.

**Uma hora seguida com as duas caixas (23/11, das 16:14 às 17:14, com todos os sinais a fingir
ligados e o programa de ensaio a ler a porta):** 104 413 linhas, 29 por segundo, **nenhuma
estragada**. Das 36 005 leituras de movimento não faltou nenhuma; não houve um segundo sem batimento
nem um recomeço da placa, e o maior silêncio entre linhas foi de 107 ms. Por tipo: 3 601 batimentos,
7 201 do log, 3 600 do vento, 36 005 de movimento e 50 405 do motor (pelo rádio). Nenhuma das duas
manias apareceu nessa hora. (O programa que fez este ensaio não dava por uma caixa calada, como a
revisão apontou a seguir; o resultado vale porque as contagens por tipo batem com o ritmo certo e o
registo de minuto a minuto sobe 1 740 linhas em cada minuto, do primeiro ao último.)

**Revisão independente do programa das caixas (23/11, ao fim da tarde).** Um revisor que não tinha
visto o código leu tudo o que mudou. Nenhum defeito crítico; cinco importantes, todos corrigidos na
versão 0.2.1 das duas caixas, cada um com um ensaio que falhava antes e passa depois:

1. **O portátil podia não reconhecer a caixa 1.** A caixa 1 passa pelo cabo dela o sinal de vida da
   caixa 2, e a procura automática da porta desistia ao ler um sinal de vida que não fosse o da
   caixa 1: com as duas caixas a funcionar, ficava à sorte de qual chegava primeiro, e podia falhar
   muitas vezes seguidas. (O "escolhe sozinho a caixa 1", escrito acima, tinha sido sorte.) Agora só
   o sinal de vida da caixa 1 decide, e espera-se por ele o prazo inteiro, 3 s. Com as placas
   verdadeiras: 14 arranques seguidos, 14 à primeira, o mais lento em 0,9 s.
2. **O ensaio de resistência dava "limpo" a uma caixa calada.** Só fazia contas quando chegava uma
   linha; sem linhas, nada contava. Agora conta o silêncio pelo relógio do portátil, dá pela porta
   que se perde (e acaba logo, com falhas), segue também a caixa 2 e os pacotes perdidos no rádio, e
   diz quais foram as falhas.
3. **Uma avalanche de sinais numa entrada parava a caixa.** Com 1 MHz no pino do log ou no do vento
   (o que um fio no ar a apanhar ruído, ou um comparador a oscilar, podem dar) a caixa deixava de
   responder. Ao ensaiá-lo apareceu pior: depois de recomeçar com a avalanche ainda no pino do
   vento, a placa ficava presa a arrancar, calada, até lhe cortarem a corrente, porque um recomeço
   não apaga o que os pinos tinham. Agora cada entrada atende um número limitado de sinais por volta
   do ciclo, as interrupções das duas entradas desligam-se logo ao arrancar, e o reinício automático
   arma-se antes de tudo o resto (nas duas caixas). Na placa: 8 s de avalanche em cada entrada sem
   falhar um sinal de vida nem um comando, e um recomeço forçado a meio dela com a caixa a voltar
   sozinha e as duas entradas a funcionar. Ficam dois contadores para a instalação no barco, que
   dizem se uma entrada está a apanhar ruído.
4. **A marca "a fingir" chegava atrasada.** A caixa só o dizia no sinal de vida seguinte, até um
   segundo depois de as primeiras linhas a fingir já terem saído; e quando deixava de fingir, os
   últimos valores a fingir ainda valiam 5 s no portátil, já sem a marca. Agora a caixa di-lo no
   instante em que passa a fingir (as duas caixas), e o portátil mantém a marca 7 s depois do último
   sinal de vida a fingir.
5. **Os sinais a fingir escrevem nos próprios pinos de entrada.** Com o comparador do log ou o
   adaptador do vento ligados, ficavam dois a mandar no mesmo fio. Fica como regra de montagem (ver
   "Peças"): uma resistência de 1 kΩ em série em cada entrada, junto à placa; e no barco não se
   correm ensaios com sinais a fingir.

Regra que fica da revisão: **o rádio entre as duas caixas nunca leva ordens.** Não tem chave nem
endereços: quem estiver ao alcance com uma placa igual pode calar os dados do motor ou mandar dados
falsos. Hoje só leva dados do motor para o ecrã, e assim tem de continuar.

**Uma hora seguida com a versão 0.2.1 e o ensaio corrigido (23/11, das 19:35 às 20:35, as duas
caixas com todos os sinais a fingir):** 104 418 linhas, **nenhuma estragada**; 36 006 leituras de
movimento sem faltar nenhuma; nenhum segundo sem sinal de vida de nenhuma das duas caixas; nenhum
recomeço; **nenhum pacote perdido no rádio**; maior silêncio entre linhas, 97 ms. Por tipo: 3 601
sinais de vida da caixa 1 e 3 600 da caixa 2, 7 201 do log, 3 601 do vento, 36 006 de movimento e
50 409 do motor. Antes de a deixar a correr provou-se que o ensaio dá pelas falhas: com a caixa 2
presa de propósito a meio de um minuto, o resultado foi "com falhas".

Fica por fazer: o ensaio de três horas com o sensor verdadeiro, quando o sensor novo chegar, que
serve também para ver se as manias voltam; e, se incomodarem, experimentar o cabo a metade da
velocidade (o programa das caixas já se compila para outra velocidade:
`node compilar.js 1 --baud 230400`).

## No portátil

O sistema já corre no portátil com o simulador (`software/dev`). Falta um **perfil de bordo**, sem
simulador, e duas peças de código:

1. **Plugin novo `signalk-arlequin-caixas`.** Lê as linhas da caixa 1 pela porta série e publica:
   `environment.wind.angleApparent` e `speedApparent`, `navigation.speedThroughWater`,
   `navigation.headingMagnetic`, `navigation.attitude`, mais os valores em bruto e o estado de cada
   caixa (a receber, calada, sem ligação), com aviso no ecrã quando uma caixa se cala. As
   calibrações (fator do log, desvio do vento, desvio da proa, acelerómetro) ficam na configuração
   do plugin. Junta as leituras do movimento num bloco por segundo e publica-o num caminho próprio.
   Reenvia as tramas do motor pelo evento `arlequin-j1939`, que o plugin do motor já escuta.
2. **Plugin do motor (`signalk-arlequin-j1939`): fonte nova `caixa`.** Hoje tem `candump` (Linux) e
   `simulador`. A fonte `caixa` usa o mesmo evento do simulador, mas com as regras do barco:
   "sem ligação" quando o batimento da caixa 2 para, "calado" quando há batimento sem tramas
   (ignição desligada, conta como vela).

O resto vem como no Pi: `signalk-derived-data` (vento real, corrente, proa verdadeira, dia e noite),
o diário, a rota ativa, a caixa negra, a AI, a Melhor rota, o AIS e a energia. O B330 entra por USB
como uma ligação NMEA 0183 normal do SignalK.

Coisas só do Linux que neste perfil ficam desligadas ou por adaptar: os comandos que arrumam as
janelas do OpenCPN (plugin do ecrã), a fotografia do plugin do porto e o `nice` do treino da AI (a
confirmar no plano).

O portátil fica abrigado, de tampa fechada: configurar para não adormecer nem reiniciar para
atualizações durante uma viagem.

## Rede e ecrã

- O **Fold cria a rede** (ponto de acesso) e mantém os dados móveis. O portátil liga-se a essa rede
  e fica com internet (previsões do tempo, Claude).
- No Fold abre-se `http://<portátil>:3000/arlequin-ecra/` no browser, com ícone no ecrã inicial. É
  o mesmo ecrã da roda (Carta, Instr., AIS, Motor, Viagem, Diário, Melhor rota, Velas, Noite). Cada
  toque vai para o portátil, que executa e grava.
- As caixas não entram nesta rede.
- Sem telemóvel a bordo, o sistema continua a ler e a gravar; só não há ecrã remoto nem internet.

## Caixa negra e passagem para o sistema definitivo

A caixa negra grava como no Pi, em `~/arlequin-dados` (bruto, tabela de 10 em 10 s, saídas,
previsões). Os valores em bruto das caixas também ficam gravados. Quando houver o computador
definitivo, a pasta copia-se para lá com a ferramenta `ferramentas/sincronizar` (a direção
portátil → barco confirma-se no plano).

## Sobe e desce da onda (decidido pelo Ivo, 21/11)

A caixa negra passa a gravar também o movimento do barco na onda, desde a primeira viagem. Nesta
fase **só se grava**. A altura e o período da onda calculam-se depois, a partir do que ficou
gravado, e só vão para o ecrã quando a conta estiver confirmada com dados reais. Não é preciso
comprar nada: é o mesmo sensor BNO085 da caixa 1, lido de outra maneira.

**O que se grava, 10 vezes por segundo:**

| Leitura | Para que serve |
|---|---|
| Aceleração nos três eixos, em bruto | O sobe e desce tira-se daqui |
| Rotação nos três eixos (giroscópio) | Refazer a inclinação com mais rigor do que a do chip, e passar a medida do sítio do sensor para o meio do barco |
| Orientação completa calculada pelo chip (quaternião) | Saber para onde é "para cima" quando o barco vai adornado, e para onde aponta a proa |

**Regras, tiradas de um ensaio no computador (21/11).** Simularam-se 20 minutos de mar de cada vez:
cinco estados de mar (de 0,3 m com 3 s a 2,5 m com 11 s), o barco adornado a 18°, o sensor 3,5 m a
ré do meio do barco e 0,8 m ao lado do eixo, os erros do sensor pela ficha do fabricante e a
vibração do motor a cinco rotações diferentes. Cada caso correu três vezes.

1. **A caixa lê o sensor pelo menos 100 vezes por segundo e manda a média de cada décimo de
   segundo.** Lido só 10 vezes por segundo, sem média, a vibração do motor mistura-se com a onda e
   a conta inventa ondas de 10 a 50 m. Com a média e o acelerómetro calibrado, o erro da altura
   ficou abaixo de 6 % em todos os casos e em todas as rotações ensaiadas. Ler 50 vezes por segundo não chega: a cerca de 2 000
   rotações (o D1-20B tem 3 cilindros, que a essa rotação batem 50 vezes por segundo) a vibração
   volta a entrar. Isto tem de ficar certo na caixa, porque não se corrige depois de gravado.
2. **Gravam-se os três eixos e a inclinação, e não só o eixo "de cima" do sensor.** Com o barco
   adornado, esse eixo deixa de apontar para cima: o erro chegou a 64 % na ondulação baixa e
   comprida.
3. **Grava-se também a rotação.** O sensor fica à popa e ao lado do eixo, por isso sente o cabeceio
   e o balanço além da onda. Para passar a medida para o meio do barco, a inclinação do chip não
   chega no mar pequeno (0,37 m calculados para 0,30 m verdadeiros, e o período errado); com a
   rotação gravada deu 0,31 m e o período certo.
4. **O acelerómetro calibra-se na bancada antes de fechar a caixa:** pousa-se a caixa em cada uma
   das seis faces, uns segundos em cada. Sem isso, o erro na ondulação baixa e comprida chegou a
   45 %. Os valores ficam na configuração do plugin, como as outras calibrações.
5. **O que se pode esperar:** a altura com um erro de poucos por cento a partir de 0,4 m; abaixo
   de 0,1 a 0,2 m a medida perde-se no ruído do sensor. São resultados de simulação, por confirmar
   com o sensor verdadeiro.

**Limites que a gravação não resolve.** Mede-se o movimento do barco, não o mar. Na ondulação
comprida o barco acompanha a onda e a medida é boa; na vaga curta o barco não sobe tudo e a medida
fica por baixo. A navegar, o período medido é o do encontro com as ondas, que depende do rumo e da
velocidade (a caixa negra tem os dois, para corrigir). A direção da onda não se promete. Com o
barco fundeado ou amarrado é quando a medida fica mais limpa.

**Como chega à caixa negra.** A caixa 1 manda as 10 leituras por segundo pelo USB; o plugin das
caixas junta-as num bloco por segundo e publica-o no SignalK; a caixa negra grava-o no bruto como
tudo o resto, sem alterações ao plugin dela. Medido a 22/11 com o gravador verdadeiro da caixa negra
(`lib/bruto.js`) e o bloco verdadeiro do plugin das caixas (número de ordem, aceleração, rotação e a
orientação completa de cada leitura): 1,0 MB por hora, ou 0,30 GB em 300 horas de navegação (com a
inclinação em vez da orientação completa eram 0,8 MB por hora). A tabela de 10 em
10 s da AI não muda agora: uma coluna com o estado do mar pode juntar-se mais tarde e calcular-se
para todas as viagens já gravadas, porque o bruto fica guardado.

**Para depois:** a ferramenta que faz a conta da altura e do período sobre a gravação (entra no
plano, porque o ensaio de bancada precisa dela), os números no ecrã, a comparação com a ondulação
da previsão e o estado do mar como variável da AI.

## Acompanhamento em direto

Com o portátil ligado aos dados do Fold, o Claude instalado no portátil pode, a pedido do Ivo, ler a
caixa negra enquanto grava, verificar cada sensor, corrigir calibrações em andamento e, no fim,
confirmar a viagem antes de a AI aprender com ela. Regras: **a navegar só alterações seguras** (a
configuração do plugin das caixas); nunca mexer na gravação em bruto; regravar uma placa só com o
barco parado. Sem rede móvel o sistema continua sozinho.

**Para depois (ideia do Ivo, 20/11): um assistente local sem internet.** O portátil tem o Ollama
com um modelo de linguagem instalado. Não faz falta ao sistema (a polar e a rota são contas e
modelos numéricos, não um modelo de linguagem), mas pode vir a servir para perguntar coisas ao
barco quando não houver rede: resumos do dia, consumos, médias, o que está nos manuais. Só para
perguntas e resumos, nunca para alarmes nem para comandos. Gasta muita energia enquanto responde,
por isso só a pedido.

**Para depois (pedido do Ivo, 21/11): assistente de voz a bordo, tipo "Alexa".** Três níveis, do
mais simples ao mais pesado:

1. **Falar:** bom dia, a previsão lida em voz alta, avisos de cansaço ("estás há X horas ao leme:
   come e bebe"), alarmes ditos por voz. O sistema já tem estes dados; só falta dar-lhes voz. Corre
   em qualquer computador, incluindo um Raspberry Pi, e pode começar pela voz do próprio Fold.
2. **Ouvir comandos simples:** uma lista curta de frases ("qual é o vento?", "regista no diário…",
   "previsão"). Também corre num Raspberry Pi. O difícil é o microfone no poço, com vento.
3. **Conversa livre:** precisa de um modelo de linguagem. Com rede, o Claude; sem rede, um modelo
   local (bem no portátil; devagar num Raspberry Pi 5; a ver no chip de AI de uma Orange Pi).

Pedido do Ivo (21/11) para o nível 3: chamar o Claude pelo nome, pedir-lhe uma tarefa por voz e
ouvir a resposta nas colunas do barco. O Claude não fica à escuta por si; faz-se com um programa
pequeno no portátil: (1) fica à escuta só do nome, no próprio portátil, sem enviar nada; (2) ao
ouvir o nome, apanha a frase e passa-a a texto; (3) entrega o texto ao Claude, que trabalha com
acesso ao sistema do barco; (4) lê a resposta em voz alta pela saída de som do portátil, ligada às
colunas. Precisa de rede móvel, demora uns segundos por pedido e depende de um bom microfone. As
tarefas com risco (motor, alterações ao sistema a navegar) pedem confirmação ou ficam de fora.

## Peças

Compradas pelo Ivo a 20/11 (Amazon.es): sensor Adafruit BNO085, conjunto de 2 placas ESP32 ELEGOO,
cabos. **As duas placas e o sensor chegaram a 22/11.** As placas são o modelo "ESP32 DEVKIT V1
TYPEC": 30 pinos em duas filas, 29 × 51,7 mm e um furo em cada canto (medidas do anúncio, por
confirmar com o paquímetro antes de desenhar a caixa).

Por comprar:

| Peça | Para quê | Quando |
|---|---|---|
| 2 módulos transcetores CAN de 3,3 V (um de reserva): [ECSiNG SN65HVD230, 2 unidades](https://www.amazon.es/dp/B0F7XCC1PT), €9,45, enviado pela Amazon (visto a 22/11) | Caixa 2. Os pinos vêm por soldar. Antes de usar tira-se a resistência de 120 Ω do módulo (junto a CANH/CANL), porque a linha do motor já tem as suas duas. Só se liga a saída de leitura (CRX); a entrada de escrita (CTX) fica presa aos 3,3 V, para o módulo não poder escrever na linha do motor nem por engano | Já |
| Conversor 12 → 5 V: [Greluma estanque, 8–22 V para 5 V 3 A, com ficha USB-C](https://www.amazon.es/dp/B0BX3MQ18D), €10,16; e [5 porta-fusíveis em linha JOREST com fusíveis de 2 A e 3 A](https://www.amazon.es/dp/B0DBPQBGBQ), €10,16; os dois enviados pela Amazon (visto a 22/11) | Alimentar a caixa 2 pela ficha USB-C da placa, com fusível de 2 A. Não serve um cabo de câmara de carro: esses cortam a corrente quando a bateria desce aos 11,6–12 V, e a caixa 2 apagava-se ao dar ao arranque | Já |
| Comparador para o sinal da roda do log, **com histerese** (para não oscilar quando o sinal está no limiar), um **filtro à entrada** (deixa passar os toques da roda, que são lentos, e corta o ruído rápido do motor e do rádio; decidido a 24/11) e uma **resistência de 1 kΩ em série** entre a saída dele e o pino da placa | Caixa 1 | Depois de medir o sinal da roda |
| Adaptação de nível e ficha para a tomada do vento, com uma **resistência de 1 kΩ em série** entre a saída e o pino da placa | Caixa 1 | Depois da foto das costas do mostrador |
| Cabo USB da caixa 1 ao portátil (USB-A do lado do portátil, USB-C do lado da placa), e cabo USB do B330. **Atenção: muitos cabos de 5 m ou mais só dão corrente e não passam dados** (o CLEEFUN de 5 m di-lo no próprio anúncio; os de 8 e 10 m "para câmaras" são todos assim). Vistos a 24/11 na Amazon.es, enviados pela Amazon: até 5 m de caminho, [deleyCON 5 m USB-A para USB-C, com dados](https://www.amazon.es/dp/B0HH9K35DQ), €18,67, numa peça só; mais de 5 m, [extensão ativa USB 2.0 deleyCON de 10 m](https://www.amazon.es/dp/B073JC1M4Z), €22,60 (a de 5 m custa €17,84), com o cabo curto da placa na ponta. Um cabo simples com mais de 5 m fica fora do que o USB garante; a extensão ativa traz um amplificador que recebe e volta a mandar o sinal. Antes de ir para o barco: uma hora do ensaio de resistência com o cabo novo e a tensão medida na placa (com 10 m de fio fino a corrente pode chegar fraca). A ficha USB-C tem de caber no berço da base: foi desenhado para uma ficha até 12,4 × 7 mm | Ligações | Depois de medir o caminho no barco |
| Extensão do cabo da roda do log até à caixa 1, só se o cabo da roda não chegar ao cubículo: cabo de antena de televisão macho–fêmea. A ficha da roda é a ficha de antena de TV (IEC, ou "Belling-Lee"); a própria NASA vende a extensão de 5 m com essa ficha, para o log e para a sonda (ref. SM523-EXTCAB). Visto a 24/11: [RL Flex 5 m, condutor de cobre puro](https://www.amazon.es/dp/B0F2HLPCQJ), €11,17, enviado pela Amazon (há de 10 m). Proposta: a ponta fêmea recebe a ficha da roda, com massa de silicone e fita; a ponta macho corta-se e solda-se dentro da caixa 1, a entrar por um bucim. Cobre e não aço, por causa da bússola: confirma-se com um íman. **Ideia do Ivo (24/11):** em vez deste cabo, soldar dois fios de silicone que já tem, do sítio dos mostradores até à caixa 1. Serve se o troço for curto (um ou dois metros), com os dois fios bem torcidos um no outro e longe dos cabos de corrente; com mais metros, o cabo blindado é o seguro, porque o sinal da roda é fraco e dois fios soltos apanham ruído. A prova, num caso e no outro: motor a trabalhar e roda parada, a caixa tem de contar zero; o mesmo a emitir no VHF. **Combinado a 24/11 (13:27): o cabo da roda já está cortado** (dito pelo Ivo), por isso a ficha deixa de contar. Faz-se uma emenda soldada na ponta cortada (fio do meio com fio do meio, malha com malha, o troço sem malha com um ou dois centímetros, manga termorretrátil com cola por cima), passa-se um cabo blindado de cobre até à caixa 1, e só dentro da caixa se usam os dois fios de silicone, curtos e torcidos. Antes de passar o cabo mede-se a roda na ponta cortada: diz se a roda está viva e escolhe o comparador. Depois da emenda mede-se outra vez na ponta nova, e tem de dar o mesmo. **13:38: do sítio dos mostradores ao cubículo não é mais de 1,5 m (estimativa do Ivo).** Com essa distância o troço todo faz-se com os dois fios de silicone torcidos, e o cabo de antena deixa de ser preciso. A emenda na ponta cortada fica igual: o fio do meio a um fio, a malha ao outro, as cores apontadas, manga com cola por cima | Caixa 1 | Não é preciso comprar: 1,5 m, com os fios de silicone do Ivo |
| Caixas de plástico (impressas), bucins, fio | As duas caixas | Na montagem |

**24/11, 13h: o Ivo disse que já comprou, e avisa quando chegar.** Falta ele dizer o que veio: qual
dos dois cabos USB, e se o conversor, os porta-fusíveis e os módulos CAN foram na mesma encomenda.
Quando o cabo chegar, o ensaio de uma hora faz-se em casa antes de ele ir para o barco.

**25/11, 19:30: chegaram os módulos e o conversor** (o Ivo: "já chegou as placas para a caixa 2 e
também o transformador para alimentar a caixa 2"). Por saber: se os porta-fusíveis e o cabo USB da
caixa 1 vieram também. Pedida a foto das peças em cima da mesa, para lhe mostrar nela cada passo
antes de ele pegar no ferro. O que se segue, em casa:

1. Soldar os pinos aos **dois** módulos.
2. Tirar a resistência de 120 Ω **só a um**, o que vai para a caixa 2. Prova com o multímetro, com
   o módulo sem corrente, entre CANH e CANL: perto de 120 Ω antes, sem leitura depois.
3. Os quatro fios desse módulo à placa da caixa 2 (3V3, GND, CRX ao D4, CTX preso aos 3,3 V).
4. **Ensaio da escuta em casa (proposta de Claude, a dizer ao Ivo).** A escuta do fio verdadeiro
   nunca foi ensaiada: o motor a fingir da caixa 2 nasce dentro dela, e por isso não passa pelo
   módulo nem pelo pino D4. Com o segundo módulo, que fica com a resistência (uma linha de bancada
   precisa de uma), a placa da caixa 1 faz de motor num fio de bancada, com um programa de bancada
   à parte, e a caixa 2 diz quantas tramas ouviu (`estado`, `motor-tramas`). O programa das duas
   caixas não muda. No fim a caixa 1 volta a receber o programa dela e correm-se os ensaios das
   duas. Assim, se no barco não se ouvir nada, a dúvida fica só do lado do barco (o par de fios, a
   derivação), e não do lado da caixa.
5. O conversor: uma hora a alimentar a caixa 2 com 12 V, em casa, com a caixa 1 a ouvi-la pelo
   rádio (`node ensaio/resistencia.js COM3 60 --duas`). Por saber: que fonte de 12 V há em casa.

**25/11, 20:08: os módulos são quatro, não dois.** O Ivo não reparou que o anúncio já era de duas
unidades e pô-lo duas vezes no carrinho. Ficam assim: um para a caixa 2, um para o ensaio em casa
e dois de reserva. Pergunta dele: se os que sobram dão "para ir buscar outras informações"
("depois logo se vê"). Dão, para **escutar** qualquer outra linha do mesmo género: o segundo par
da ficha do motor (pinos 1 e 3), se as medidas mostrarem que é uma linha à parte, e a rede do
piloto automático quando ele chegar (o `NAVEGACAO.md` prevê para ela um adaptador USB–CAN). Só
escuta: mandar ordens para uma dessas linhas é outra conversa. Fica por decidir quando lá se
chegar.

**25/11, 20:42–20:51: pinos soldados em duas plaquinhas e a R2 tirada a uma** (o Ivo, em casa;
foto dele marcada em `docs/caixas/caixa2-modulos-fios.jpg`).

- As plaquinhas são as "WCMCU-230", com o chip marcado VP230. Têm letras dos dois lados. Os pinos
  entraram pelo lado do chip (plástico preto desse lado, pinos compridos para cima) e a solda
  ficou no lado liso, como no sensor.
- Na foto lê-se **121** na R2 (120 Ω, a resistência da ponta da linha, junto a CANH e CANL) e
  **103** na R1 (10 kΩ). Saiu a certa.
- **A, a do barco: sem a R2.** No sítio dela veem-se as duas ilhas separadas. **B, a do ensaio:
  com a R2.** As outras duas ficam guardadas, por mexer.
- O multímetro ficou no barco. A medida entre CANH e CANL (a A sem leitura, a B perto de 120 Ω)
  faz-se antes de a A ir para o barco.
- Ligações da A à placa da caixa 2: 3V3 ao 3V3, GND ao GND, CRX ao D4, e o CTX preso ao 3V3 da
  própria plaquinha, por uma ponte de fio com capa soldada por trás (do pino 3V3 ao pino CTX, por
  cima do GND).

**26/11, 09:33–10:45: o ensaio da escuta pelo fio correu em casa e passou.** A caixa 2 ouviu pelo
fio todas as tramas que saíram, com o programa dela (0.2.1) e a plaquinha A tal como vai para o
barco (sem a R2, com a ponte).

| Passo | Saíram | A caixa 2 ouviu |
|---|---|---|
| 3 rajadas de 1000 tramas, uma de 5 em 5 ms | 3000 | 3000 |
| 3 rajadas de 1000 tramas, uma por milissegundo | 3000 | 3000 |
| 10 s à cadência do gerador (14 tramas por segundo) | 145 | 145 |

Nenhuma ignorada, nenhuma falhada, nenhum erro na linha (`node ensaio/escuta-fio.js COM5 COM3`,
"LIMPO"). Fica provado em casa o caminho fios → plaquinha A → pino D4 → controlador em só escuta →
contagem. O que este ensaio não prova: a passagem dessas tramas pelo rádio até ao portátil (a placa
da caixa 1 estava a fazer de motor, por isso a caixa 2 deitou-as fora, `radio-deitadas-fora=6145`).
Esse bocado está provado à parte, com o motor a fingir de dentro da caixa 2; os dois bocados
juntam-se na mesma função do programa. Para os ensaiar de uma vez só fazia falta uma terceira placa.

Como foi:

- **A ponte da A** fê-la o Ivo às 10:02: fio vermelho com capa, soldado por trás, do pino CTX ao
  pino 3V3, em arco por fora da plaquinha. A B não leva ponte (nela o CTX vai por fio à placa).
  Sem multímetro em casa, a prova de que a ponte não tem curto foi a placa da caixa 2 acordar e
  falar pelo rádio com a plaquinha A ligada.
- **Ligações**, marcadas sobre as fotos dele em `docs/caixas/bancada-ensaio-fio-ligacoes.jpg`:
  A à placa da caixa 2 (3V3, GND, CRX ao D4); B à placa da caixa 1 (3V3, GND, CTX ao TX2, CRX ao
  RX2); e CANH com CANH, CANL com CANL entre as duas. A placa da caixa 1 tinha os seis fios do
  sensor; o vermelho e o cinzento (3V3 e GND) passaram do sensor para a plaquinha B durante o
  ensaio, porque a placa só tem um pino de 3V3.
- **À primeira a caixa 2 não ouviu nada** (0 em 7 passos, com a placa que fazia de motor a dizer
  que tinha saído tudo sem erros). Causa, vista nas fotos que o Ivo mandou a seguir: faltavam os
  dois fios entre as plaquinhas. Postos esses dois fios, passou à primeira. Fica a lição para o
  barco: uma caixa 2 que conta zero sem erros é o retrato de um par de fios que não chega a ela
  (ou que chega trocado: com CANH e CANL trocados também se ouve silêncio, sem erros).
- As portas USB trocaram ao desligar e voltar a ligar os cabos (a caixa 2 passou da COM6 para a
  COM3). Antes de gravar ou de mandar comandos, ouve-se cada porta sem escrever: a caixa diz quem
  é no batimento (`$AQB,1` ou `$AQB,2`), e a placa com o programa de bancada fica calada.
- No fim a placa da caixa 1 voltou a levar o programa dela (0.2.1, `npm run gravar:1 -- COM5`) e
  as duas caixas voltaram a ver-se pelo rádio.
- Desfeita a montagem, a caixa 1 volta aos seis fios do sensor, marcados em
  `docs/caixas/bancada-caixa1-seis-fios.jpg` (o fio da massa é agora cinzento; na foto de 22/11
  era preto). Antes de correr os ensaios da caixa 1 sai o fio do RX2: o vento a fingir escreve
  nesse pino e o módulo também.
- **Verificação no fim (11:45–11:50):** com a montagem desfeita, a plaquinha A na placa da
  caixa 2 e o sensor outra vez com os seis fios, `npm test` com as duas placas deu **40 em 40**,
  nenhuma falha e nenhuma saltada. Antes disso, uma volta só dos ensaios da caixa 2 tinha falhado
  num (5 em 6): uma linha chegou com 64 bytes vazios colados, a mania n.º 2 da ponte USB (acima);
  repetida logo a seguir, passou (6 em 6).

**Espaço para a caixa 2 no barco (o Ivo, 26/11, 10:24):** por baixo dos mostradores cabe uma caixa
com até **8,5 cm de largura, 20 cm de altura e 30 cm de comprimento**. Chega para a placa, a
plaquinha, os dois relés e o conversor. Falta saber como se prende e por onde entram os cabos.

**26/11, 12:35–14:10: preparar a ida ao barco das 18h** (o Ivo: "vamos testar isto tudo no sítio e
pôr o motor a trabalhar e a desligar, e ver se ligamos alguns instrumentos").

- **Cabo 1, os fios que leem o motor** (três fios, até 50 cm; foto da ponta da caixa em
  `docs/caixas/caixa2-cabo-dados-ponta-da-caixa.jpg`, a da ficha em
  `docs/caixas/caixa2-ficha-conta-rotacoes-fios.jpg`):

  | Fio | Lado do barco (ficha do conta-rotações) | Lado da caixa 2 |
  |---|---|---|
  | H | branco fino do buraco 5 | pino CANH da plaquinha A |
  | L | amarelo fino do buraco 2 | pino CANL da plaquinha A |
  | massa | preto grosso do buraco 4 | GND da placa, na fila do VIN: o 2.º pino a contar da ficha USB |

  O 1.º pino dessa fila é o VIN (5 V): um fio de massa aí é um curto. O H e o L vão torcidos um no
  outro e marcados. O Ivo vai usar fio de capa de silicone (serve; protege-se nas arestas).
- **Cabo 2, os fios de ligar e desligar:** amarelo (arranque), roxo (parar) e preto (negativo,
  comum). Parecer do Claude: pode ficar feito, mas sem relés nem programa do lado da caixa não se
  liga ainda; uma ponta solta do amarelo que toque no preto dá ao motor de arranque. Para as 18h
  prova-se à mão, depois da prova com o multímetro: amarelo ao preto arranca, roxo ao preto para.
- **Como os botões se portam (o Ivo, 13:14):** pode ficar a carregar no START, que a caixa do motor
  larga o motor de arranque sozinha quando o motor pega; no STOP, se tirar o dedo cedo demais,
  "parece que desliga mas não desliga". Para o programa: ligar é segurar o contacto até o motor
  pegar; desligar é segurá-lo uns segundos a mais. Sem mais proteções, como ele decidiu a 25/11.
- **Os relés** (pergunta dele: porque ainda não se compraram): podiam ter sido indicados na noite
  de 25/11, quando as cores dos fios ficaram lidas; falha do Claude. Encomendados pelo Ivo a 26/11:
  [ARCELI, 5 módulos de 1 relé de 3 V com optoacoplador e disparo de nível alto](https://www.amazon.es/dp/B0CLTZFWY4)
  (10,16 €, visto a 26/11). Escolhidos por serem feitos para placas de 3,3 V e por ficarem abertos
  com a caixa desligada ou a recomeçar. Na Mauser, o equivalente de 5 V com seleção de disparo
  (ref. 095-8645) estava esgotado; havia o Keyestudio KS0057 (2 relés de 5 V, disparo em alto pela
  ficha do fabricante, sem dizer se obedece a 3,3 V). A placa nunca se liga diretamente aos fios
  dos botões: têm os 12 V do barco.
- **O conversor** é um DGXBY U1205-03 (15 W; entrada 12 V, de 8 a 22 V; saída 5 V, 3 A no máximo,
  em ficha USB-C). Ensaio em casa com uma LiPo de airsoft de 11,1 V e 1450 mAh: 24 minutos limpos
  (21 605 linhas, nenhuma estragada, a caixa 2 sem um segundo de silêncio nem recomeços). Parou
  quando o Ivo desligou a bateria para meter o fusível, que não tinha posto (ficou um de 5 A; os de
  2 A compram-se). Depois disso a caixa 2 acendia a luz vermelha mas não arrancava (sem luz azul,
  sem rádio); ligada ao portátil arrancou logo. A caixa está boa; a causa do lado da bateria não se
  apurou (o Ivo suspeita de bateria fraca; não se mediu). Decisão dele: esquece-se esta bateria e o
  ensaio do conversor faz-se no barco, com a bateria do barco e o fusível à saída do ponto dos 12 V.
- **Para as 18h, por ordem:** tudo desligado; ficha do conta-rotações tirada e as duas medidas
  (2–5 e 1–3); as três derivações do cabo 1; ficha de volta; caixa 2 com corrente; portátil com a
  caixa 1; painel ligado sem arranque, e escuta (`ensaio/ouvir-motor.js`); depois o motor a
  trabalhar. Roda do log e vento: só medir e fotografar. AIS: experimentar pelo USB.
- **Cabo de rede blindado para os fios dos instrumentos** (pergunta dele): serve para sinal, se for
  de fios flexíveis e de cobre (não rígido nem de alumínio cobreado), com a blindagem à massa só na
  ponta da caixa, e sem levar corrente de alimentação a sério.
- O Ivo tem um sortido de resistências (50 valores, 1/4 W, com as de 1 kΩ): as resistências em
  série das entradas do log e do vento saem daí.

**28/11, 14:59–15:50: o Ivo quer instalar hoje, com a caixa 2; a revisão da regra da roda e a
versão 0.3.4.**

- **O Ivo (14:59):** quer também a caixa 2 já ligada, só a escutar (ligar e desligar o motor fica
  para os relés); tem 220 V a bordo, para o portátil; vai andar com o barco segunda e terça o dia
  todo e quer o máximo de dados; e quer instalar **hoje**. Recebeu a lista por ordem (em casa: a
  plaquinha da caixa 1, ligá-la, o cabo do motor da caixa 2, o cabo de 5 m e a bússola; no barco:
  portátil e AIS, as quatro uniões da caixa 1, as três derivações da caixa 2, e as provas uma a
  uma) e cinco desenhos: `caixa1-fila-montagem`, `caixa1-fila-ligacoes`,
  `caixa2-cabo-dados-ponta-da-caixa`, `caixa1-esquema-barco` (novo) e `caixa2-esquema-barco`
  (refeito: sem a parte de ligar e desligar à mão). **A corrente da caixa 2**, por agora, é um
  carregador de telemóvel numa ficha de 220 V (ou um power bank): o conversor de 12 V nunca foi
  ensaiado na bateria do barco. Com o portátil nos 220 V ele não adormece sozinho; fechar-lhe a
  tampa adormece-o, a não ser que o Ivo mude essa definição.
- **A revisão da regra nova da roda** (o mesmo revisor da manhã; só leu, e fez um modelo da lógica
  no portátil): nada de crítico. Um ponto importante e sete menores:
  - *Importante:* a fase do ressalto do ensaio pelo fio não provava nada. Aos 300 µs depois de a
    roda abrir, o condensador ainda tem o pino em cima: o ressalto nem se via, e a fase passava com
    qualquer regra. **Corrigido:** o ressalto a fingir vem 1,5 ms depois de abrir; a fase só passa
    se os ressaltos forem vistos e recusados, um por volta; e há outra fase, com um ressalto de
    1 ms, que mostra a folga dos 2 ms neste chip.
  - *Menor, corrigido:* com ruído muito rápido, a entrada cala-se ao fim de 16 mudanças; uma subida
    posta à espera nessa altura contava sem ninguém ter vigiado o pino. **Visto falhar na placa:**
    ruído de 1 MHz com o ciclo a parar 50 ms de cada vez dava uma volta que não existia. Agora essa
    subida não vale.
  - *Menor, corrigido:* acima de 16 mudanças por volta do ciclo a roda deixava de contar sem deixar
    rasto. Há agora um contador (`caladas`, no comando `tempos`).
  - *Menores, corrigidos:* a escuta da roda podia dizer 9 em 10 por não esperar pela última linha;
    a roda a fingir, parada a meio de um ressalto, podia dar uma volta a mais; um ensaio que exigia
    zero em 800 subidas de 1,25 ms passou a 1 ms e admite uma em mil; um texto do README.
  - *Menor, com ensaio novo e sem mexer no programa:* o ciclo parado dezenas de milissegundos. A
    contagem continua pela interrupção: com a roda a 100 voltas por segundo e o ciclo a parar 50 ms
    quinze vezes, a contagem é exata.
  - *Menor, por fazer:* a espera só existe para cima. Com a roda fechada, uma falha em baixo mais
    comprida do que o condensador tapa (cerca de 0,45 ms) dava uma volta a mais 2 ms depois; a
    regra antiga fazia o mesmo. Só se mexe se a prova das 10 voltas contar a mais.
- **O que o revisor não pôde julgar, e a medida que passou a haver.** Para o pino chegar a descer,
  a roda tem de ficar aberta 0,5 a 1 ms; com a roda depressa e a parte aberta da volta muito
  estreita, perdem-se voltas com qualquer regra, e nenhum ensaio o vê. A **0.3.4** mede o contacto
  (comando `tempos`): quanto tempo o pino esteve em baixo em cada volta, da descida à subida que
  ficou, e a subida recusada mais comprida. `ensaio/ouvir-roda.js` mostra-o volta a volta, com a
  parte da volta que isso foi. Na prova das 10 voltas à mão fica-se a saber se o condensador de
  100 nF serve para a roda verdadeira, antes de o barco ir para a água.
- Baterias com a 0.3.4 nas duas placas: a da caixa 1, 42 ensaios, 41 passam e 1 salta-se; a das
  duas caixas, 12 em 12; tudo de seguida com as duas ligadas, 141 ensaios, 140 passam e 1 salta-se.
  Os ensaios do portátil passam todos.
- **Por provar com a plaquinha e com a roda**, por esta ordem: os fios da roda juntos ao ligar a
  caixa (a roda parada fechada) têm de dar zero voltas; `ensaio/roda-por-fora.js` (seis fases); e,
  no barco, as 10 voltas à mão com `ensaio/ouvir-roda.js`.

**28/11, 14:30–14:56: a roda do log deixa de poder contar a dobrar (o ponto 4 da revisão final),
versão 0.3.3 nas duas caixas.**

- **O defeito.** A caixa contava uma volta por cada subida do pino da roda que viesse a mais de
  4 ms da anterior. Mas nem toda a subida é uma volta: o contacto da roda pode ressaltar ao abrir
  (fecha um instante e abre outra vez), e o condensador da entrada faz o pino descer devagar, o que
  neste chip, que não tem folga entre o "em cima" e o "em baixo", pode parecer uma subida. A roda
  está fechada quase a volta toda: a subida falsa cai logo a seguir à abertura, muito mais de 4 ms
  depois da subida verdadeira anterior, e contava.
- **Visto falhar na placa, sem a plaquinha.** O gerador de bancada da roda ganhou duas coisas
  (0.3.3-a1, com a regra antiga): mexer no próprio pino do log, sem fio ("por dentro"), e um
  ressalto ao abrir. Com um ressalto de 150 µs a 2 voltas por segundo: **12 impulsos em 6 voltas.**
  E uma onda de 400 por segundo, com o pino 1,25 ms em cima de cada vez, dava 403 voltas em 2 s.
- **A regra nova (`caixa1/log.h`): uma subida só é uma volta se o pino se aguentar em cima 2 ms
  seguidos.** A caixa passa a ver as duas mudanças do pino: a subida fica à espera, e uma descida
  antes dos 2 ms anula-a e conta em `log-recusados`. A hora da volta é a da subida, por isso o
  tempo entre voltas não muda. A regra dos 4 ms mantém-se. Para uma avalanche de ruído não parar a
  caixa, atende 16 mudanças por volta do ciclo, no máximo (como a entrada do vento), e ao deixar de
  olhar anula a subida que estivesse à espera. Ao arrancar toma nota de como o pino está: a roda
  parada costuma estar fechada, e isso não é uma volta. Os 2 ms escolhem-se pelo circuito: um
  ressalto de 150 µs, esticado pelo condensador (carrega depressa, descarrega devagar), fica em
  cima menos de 1 ms; a roda fechada, mesmo a 100 voltas por segundo, fica mais de 8 ms.
- **Depois da regra nova:** com o ressalto, 6 em 6, a 2, 26 e 60 voltas por segundo; sem ressalto,
  a contagem exata a 2, 26, 60 e 100; a onda de 400 por segundo não conta nada; duas voltas a menos
  de 4 ms contam como uma. O ensaio antigo dos "impulsos duplos" usava a onda de 400 por segundo,
  que deixou de contar: refez-se com a roda por dentro a 300 por segundo (o pino 2,8 ms em cima).
  Baterias com a 0.3.3: a da caixa 1, 39 ensaios, 38 passam e 1 salta-se; a das duas caixas, 12 em
  12; tudo de seguida com as duas ligadas, 137 ensaios, 136 passam e 1 salta-se. Os ensaios do
  portátil passam todos.
- **O que falta provar**, e não se consegue sem a plaquinha e sem a roda: o caminho verdadeiro
  (`ensaio/roda-por-fora.js`, agora com uma quinta fase, a do ressalto) e o contacto verdadeiro,
  rodado à mão com o barco em seco (`ensaio/ouvir-roda.js` mostra cada volta contada). Os programas
  compilados da 0.3.2 ficaram guardados, para se ver primeiro, pelo fio, se a regra antiga falhava
  mesmo com a descida lenta.
- Esta parte foi dada a rever ao mesmo revisor da manhã (só a leu).

**28/11, 13:45–14:30: o barco vai para a água na segunda (30/11); o que se instala, o ensaio geral
em casa e a escuta do vento (versão 0.3.2).**

- **O prazo (Ivo, 13:45):** o barco vai para a água na segunda-feira, 30/11, e faz logo a primeira
  viagem; a instalação faz-se entre 28 e 29/11. Quer, pelo menos, os dados dos instrumentos
  gravados. Os relés só chegam na segunda: ligar e desligar o motor pelo ecrã fica de fora (para
  escutar o motor não fazem falta). Já tem o cabo USB de 5 m.
- **A ordem combinada**, do mais certo para o menos certo: o AIS e o GPS pelo USB (provados a bordo
  a 26/11, e a caixa negra gravou nesse dia a posição de 10 em 10 s); a caixa 1 com o sensor, no
  cubículo; o vento; a roda do log; o motor, por último, por ser o único trabalho que mexe em fios
  do motor na véspera de o barco ir para a água. A profundidade não entra nesta viagem (a leitura
  da sonda continua por fazer). Com o barco em seco, a roda do log roda-se à mão por baixo do
  casco: é a prova de que a caixa conta as voltas uma a uma, e só se pode fazer até segunda.
- **O ensaio comprido das duas caixas com a 0.3.1**, enquanto o Ivo soldava a plaquinha: das 11:46
  às 13:53, parado aos 127 minutos para se usarem as placas. 213 392 linhas, nenhuma estragada;
  76 212 de movimento sem uma em falta; nenhum toque no sensor; nenhum pacote perdido no rádio;
  maior silêncio 110 ms. A regra nova do "calado" (faltar qualquer das três leituras) não deu
  nenhum falso alarme em duas horas. Não é o ensaio final: falta a plaquinha ligada.
- **Ensaio geral em casa, com as duas caixas verdadeiras** (`npm run ensaio-placa`, 13:56): o
  servidor achou a caixa 1 sozinho, e a tabela da caixa negra ficou com a posição (a fingir), o
  adornamento e o caimento (do sensor verdadeiro), as rotações e o consumo (do motor a fingir,
  vindos pelo rádio). **A proa ficou em branco:** a bússola do sensor ainda está sem confiança, e
  o plugin só publica a proa quando o sensor confia nela (`erroMaxProa`). Fica por fazer a prova
  da bússola à mão; no barco, a bússola acerta-se com o barco a rodar.
- **O portátil a trabalhar da bateria adormece ao fim de uma hora sem lhe mexerem** (lido com
  `powercfg`, sem mudar nada; ligado à corrente, nunca). Numa viagem a gravação parava a meio. É
  uma definição do Windows, que é o Ivo que muda, como a de fechar a tampa. A firewall já deixa
  entrar ligações ao programa do servidor (regras lidas, sem mexer): o ecrã no Fold só depende da
  rede do Fold e do endereço do portátil nela.
- **A escuta do vento.** A caixa 1 só deixa passar a frase `MWV` com a soma certa e deita fora o
  resto, as frases de outro tipo sem as contar. Na primeira vez com o mostrador verdadeiro, se o
  vento não aparecesse, não havia maneira de ver o que ele manda. A versão **0.3.2** dá à caixa 1 o
  comando `cru` (as últimas 80 letras entradas pelo pino do vento, tal e qual, e o total; só lê),
  e `ensaio/ouvir-vento.js` mostra-as linha a linha e dá o veredicto em português corrente: fio
  parado, frases boas, estragadas, sem soma, de outro tipo, ou letras que não são texto. Visto
  falhar primeiro na placa (a 0.3.1 responde "desconhecido"). Experimentado em casa nas três
  situações que se conseguem fazer sem mostrador: fio parado, o `MWV` com um `VWR` por segundo, e
  lixo. Baterias com a 0.3.2: a da caixa 1, 36 ensaios, 35 passam e 1 salta-se; a das duas caixas,
  12 em 12; tudo de seguida com as duas ligadas, 133 ensaios, 132 passam e 1 salta-se. Os ensaios
  do portátil passam todos.
- **Desenho para o barco:** as quatro uniões da caixa 1 (o amarelo e o verde da ficha do mostrador
  do vento ao azul e ao branco da plaquinha; o fio do meio e a malha do cabo da roda aos dois fios
  da roda) e a ordem dos passos. Faz-se com as cores dos fios novos quando o Ivo as disser. O do
  motor já existia (`docs/caixas/caixa2-esquema-barco.jpg`).

**28/11, 10:12–11:35: a revisão final da Tarefa 7 e a versão 0.3.1 nas duas caixas.**

- **A revisão final**, feita por um revisor de contexto novo sobre tudo o que mudou no passo 7 (só
  leu: não tocou nas placas nem correu ensaios), não achou nenhum ponto crítico e achou cinco
  importantes. Quatro ficaram corrigidos de uma só vez, cada um visto falhar primeiro; o quinto só se
  prova com a plaquinha soldada. As duas caixas têm gravada a versão **0.3.1**.
- **1. O ensaio de resistência dava "LIMPO" a uma noite com o sensor calado.** Só contava o que
  chegava: se o sensor se calasse a meio e não voltasse, deixavam de chegar linhas de movimento e não
  havia nada estragado para contar. Passou a medir o tempo sem movimento pelo relógio do portátil, a
  falhar se a noite acabar com o sensor noutro estado que não "a medir" ou com um silêncio por
  fechar, e a ler os contadores do sensor no princípio e no fim. Opção nova `--motor`: falha se as
  tramas do motor da caixa 2 não chegarem ou pararem. Sem placas: `ensaio/contador.test.js`.
- **2. O caminho de um sensor que não volta não tinha ensaio** (calado, toques no RST cada vez mais
  espaçados, "não volta", e o regresso). Comando de bancada novo, `avaria,3,<segundos>`: prende o RST
  do sensor em baixo esse tempo, como se lhe faltasse um fio. O ensaio deixa-o mudo 35 s e confere os
  estados no batimento (0, 2, 3, 0), os seis toques e os intervalos entre eles (1, 2, 5, 10 e 30 s), e
  que entretanto o batimento e o log não falham uma linha e não sai movimento nenhum. Visto falhar
  com o programa estragado de propósito (nunca dizia "não volta").
- **3. "Calado" era não chegar leitura nenhuma; passou a ser faltar qualquer das três há meio
  segundo.** O sensor manda três espécies de leitura (aceleração, rotação e atitude). Se parasse só
  a aceleração ou só a rotação, deixava de sair movimento e a caixa continuava a dizer que o sensor
  media, sem lhe dar o toque (visto na placa com o comando novo `avaria,4,<espécie>`: 0 toques). Se
  parasse só a atitude, o risco era o movimento sair com a última, parada no tempo; neste sensor a
  caixa já dava por isso, porque calar a atitude cala-o todo durante mais de meio segundo, e o
  ensaio fica como prova. Agora, nos três casos, dá o toque e o sensor volta a medir tudo em menos
  de 5 s.
- **5. O rádio da caixa 1 não voltava a tentar.** Se não ligasse ao arrancar, a caixa 1 ficava sem
  ele até lhe cortarem a corrente; sem o farol dela a caixa 2 cala-se (só manda a quem ouve), e do
  portátil só se via "caixa 2 sem ligação". Passou a tentar de 30 em 30 s, sem recomeçar a placa, e
  conta em `religado` (comando novo `radio`). Provado com as duas caixas e `avaria,1` na caixa 1:
  antes o batimento da caixa 2 não voltava em 45 s; agora volta, sem nenhuma das duas recomeçar.
- **4. Por provar: a roda do log pode contar cada volta a dobrar.** O condensador de 100 nF da
  entrada faz o pino descer devagar quando a roda abre, e as entradas deste chip não têm folga
  entre o "em cima" e o "em baixo": uma descida lenta pode passar por subida. Só se vê com a
  plaquinha soldada (`ensaio/roda-por-fora.js`), e vê-se **antes** do ensaio final de 3 horas, para
  a correção, se for precisa, ir no programa que faz esse ensaio. A correção está pensada: a
  interrupção só carimba a hora, e o ciclo só aceita a volta se o pino ainda estiver em cima cerca
  de 2 ms depois.
- **Foram com o mesmo passe duas coisas das ferramentas da roda:** o pino que faz de roda nos
  ensaios (D26) fica solto ao arrancar, e a paragem do comando `roda` espera 2 ms pelo temporizador
  (uma mudança que já ia a meio ainda podia contar mais uma volta).
- **Enquanto o Ivo soldava a plaquinha, as duas caixas correram 68 minutos com a 0.3.0**, até eu
  parar o ensaio para gravar a caixa 1: ia limpo (114 258 linhas, nenhuma estragada; 40 807 de
  movimento sem faltas; nenhum pacote perdido no rádio; maior silêncio 103 ms). Não é o ensaio
  final.
- **Baterias com a 0.3.1:** a da caixa 1, 35 ensaios, 34 passam e 1 salta-se (o que só serve sem
  sensor); a das duas caixas, 12 em 12; tudo de seguida com as duas ligadas, 114 ensaios, 113 passam
  e 1 salta-se. Os ensaios do portátil passam todos.
- **O que a revisão deixou para decidir, e ficou decidido:** o desenho elétrico da plaquinha
  prova-se com os ensaios do vento e da roda; uma apresentação estragada do sensor pode fazer a
  caixa recomeçar (recomeça sozinha e o sensor volta em menos de 5 s); o rádio perto da bússola
  continua por ver até a bússola ter confiança. E uma nota dele: se o lado da proa (`-x`) estivesse
  trocado, também o rumo ficava 180° ao contrário, por isso a prova da bússola à mão passa a ser a
  confirmação independente antes de ir para o mar.
- **Por fazer:** a plaquinha soldada e ligada à caixa 1 (o sensor alimentado por ela); os ensaios do
  vento e da roda por fora; a bateria da caixa 1 nessa montagem; o ensaio final de 3 horas com as
  duas caixas (`--duas --motor`); e as duas provas à mão (a bússola e, se se quiser, o fio do CS
  fora).

**28/11, 09:30–09:56: o último ponto adiado (o rádio da caixa 2) e a versão 0.3.0 nas duas caixas.**

- **Os seis pontos adiados da revisão (passo 7 da Tarefa 7 do plano) estão todos feitos**, cada um
  visto falhar primeiro na placa. As duas caixas têm gravada a versão **0.3.0**.
- **O sexto ponto: o rádio da caixa 2 volta a tentar sozinho.** Até aqui, se o rádio não ligasse ao
  arrancar, ou se o registo do destino (a caixa 1) falhasse, a caixa 2 ficava calada no rádio até lhe
  cortarem a corrente, com o batimento a sair pelo USB como se nada fosse: do portátil só se via
  que o motor não chegava. Passou a tentar outra vez, o rádio de 10 em 10 s e o destino de segundo a
  segundo, sem recomeçar a placa. Cada vez que repõe uma coisa que tinha falhado conta em
  `religado`, no comando `estado`.
- **Como ficou provado, com as duas caixas.** Comando de bancada novo, `avaria`: 1 deita o rádio da
  caixa 2 abaixo; 2 tira-lhe o destino. Só com a avaria gravada, o batimento da caixa 2 não voltava
  à caixa 1 (nem em 15 s, nem em 3 s). Com o rádio que volta a tentar, volta nos dois casos, sem a
  caixa recomeçar e com o motor a fingir a chegar logo a seguir.
- **Um tropeço pelo caminho, que ficou guardado.** À primeira, o programa novo mandava desfazer o
  rádio ao arrancar, antes de alguma vez o ter aberto. O chip não aguenta essa ordem: a caixa 2
  recomeçava sem parar, calada (visto na mensagem de erro dela: a função `esp_now_deinit` a ir
  buscar o que não existe). O rádio só se desfaz agora se tiver sido aberto (`aqRadioDesliga`, em
  `comum/src/arlequin_radio.h`), e um ensaio sem placas (`ensaio/radio.test.js`) falha se alguém
  voltar a desfazê-lo por outro lado.
- **Com a caixa 2 ligada, passaram também os dois ensaios que esperavam por ela:** a conta de há
  quanto tempo chegou o sinal da caixa 1 e a enxurrada de ordens pelo USB. Com o programa antigo
  dela (0.2.1) a enxurrada deixava passar só 2 batimentos em 4,5 s.
- **Baterias com a 0.3.0:** a da caixa 1, 31 ensaios, 30 passam e 1 salta-se (o que só serve sem
  sensor); a das duas caixas, 11 em 11; tudo de seguida com as duas ligadas, 103 ensaios, 102 passam
  e 1 salta-se. Os ensaios do portátil passam todos.
- **Caixa 2 na bancada:** o fio branco que estava solto é o da leitura do motor (do pino CRX da
  plaquinha do motor ao D4, o 5.º pino a contar da ficha USB). Marcado na foto do Ivo de 26/11:
  `docs/caixas/caixa2-fio-branco.jpg`.
- **Por fazer:** o ensaio final de 3 horas com as duas caixas, já com a plaquinha da caixa 1 a
  alimentar o sensor; a revisão final, de contexto fresco, da Tarefa 7; e as duas provas à mão (o
  aviso "sem sensor", com o fio do CS fora, e a bússola).

**28/11, de manhã: a fila dos 3,3 V e da massa da caixa 1, desenhada (por montar e por ensaiar).**

- **O problema.** A placa da caixa 1 só tem um pino de 3,3 V, e há três coisas a pedi-lo: o sensor
  de movimento, a plaquinha do vento (a resistência de 2,2 kΩ do RX2) e a roda do log.
- **Decisão: as duas filas fazem-se na plaquinha do vento**, que já recebe os 3,3 V (furo T3, fio
  verde com fita) e a massa da caixa 1 (furo N4, fio verde sem fita). O sensor passa a ser
  alimentado por ela, por dois fios novos soldados à placa (o vermelho e o cinzento que iam do
  sensor aos pinos 3V3 e GND da placa saem). A proposta de 27/11, dar os 3,3 V à plaquinha pelo
  pino 3Vo do sensor, fica sem efeito: punha o vento e a roda dependentes do sensor e do
  regulador dele. As três peças da roda vão para a mesma placa, e não há mais placa nenhuma.
- **Montagem** (as letras são as da placa; as filas contam-se a partir da beira das letras):

  | O quê | Furos |
  |---|---|
  | Fila dos 3,3 V (fila 3) | T3 (já lá está o verde com fita), U3 e V3, juntos com solda |
  | Fila da massa (fila 5) | N5, O5 e P5, juntos com solda; e o N4 com o N5, a única ponte de uma fila para a outra |
  | Fio do VIN do sensor | V3 |
  | Fio do GND do sensor | N5 |
  | 1 kΩ, dos 3,3 V a um fio da roda | U3 a U7; esse fio da roda em T7 |
  | 10 kΩ e 100 nF, do outro fio da roda à massa | O9 a O5 e P9 a P5; esse fio da roda em Q9 |
  | 1 kΩ em série até ao D27 | R9 a V9; o fio do D27 em W9 |

  Livres para mais tarde (a sonda): W3 e X3 para mais 3,3 V, Q5 a S5 para mais massa.
- **A entrada da roda mudou em relação à proposta de 27/11: leva uma resistência de 1 kΩ em série
  até ao pino D27.** É a regra que o `software/caixas/README.md` já tinha desde a revisão de 23/11
  (as entradas com 1 kΩ em série, junto à placa) e que a proposta de 27/11 esqueceu. Sem ela, os
  ensaios de bancada que fazem do D27 uma saída (a roda a fingir e a avalanche de 1 MHz) punham o
  pino a carregar e a descarregar o condensador de 100 nF diretamente, perto do máximo de corrente
  dele, durante segundos; e um fio da roda que tocasse nos 12 V do barco entrava no pino sem nada
  pelo meio. Com a roda fechada o pino fica a cerca de 2,9 V (o mínimo que ele lê como "em cima" é
  2,5 V), contando com a puxada para baixo de dentro do chip.
- **A entrada do vento fica como está, sem resistência em série** (o RX2 liga ao coletor do PC817).
  Quem pode puxar o pino para baixo é só o transístor do optoacoplador, que não deixa passar mais
  do que a corrente do díodo vezes o ganho dele: 4 a 8 mA na bancada (2 mA no díodo). No barco, com
  o mostrador a 12 V, podiam ser 20 a 40 mA, mas só durante os bits de uma frase e só se alguém
  corresse lá os ensaios com geradores, o que o README proíbe. Pôr a resistência obrigava a
  dessoldar o fio amarelo de uma placa que passou no ensaio.
- **O que o programa do desenho confere antes de desenhar** (`software/ferramentas/caixas/caixa1_fila.py`):
  que as pontes dão exatamente o circuito pedido; que o que já estava soldado é o do desenho de
  27/11; que nada de novo fica a menos de três colunas do lado do mostrador (o PC817 separa as duas
  massas); que os 3,3 V e a massa nunca ficam em furos vizinhos; e que tudo cabe nas primeiras
  nove filas. O único par de furos vizinhos de redes diferentes com peça nova é o N5 (massa) com o
  M5, um pino da metade vazia do suporte: um pingo de solda a mais aí não faz nada.
- **A placa tem de ser cortada para caber na base.** A base tem 43,6 mm por dentro do rebordo e a
  placa 50 mm. Por isso fica tudo nas primeiras nove filas: cortada pela fila 15 dá cerca de
  40 mm. O sítio dela na base (os 12 cm livres entre o sensor e a placa) e a maneira de a prender
  continuam por desenhar.
- **Desenhos dados ao Ivo (08:15):** `docs/caixas/caixa1-fila-montagem.jpg` (o que soldar, com a
  conferência a multímetro) e `docs/caixas/caixa1-fila-ligacoes.jpg` (onde ligam os fios na placa
  da caixa 1, marcado numa foto dele). As cores dos cinco fios novos são as que ele escolher.
  Às 10:10, a pedido dele, o mesmo desenho por cima de uma foto que tirou à plaquinha:
  `docs/caixas/caixa1-fila-na-foto.jpg`. A placa tem letras nas duas beiras compridas: a fila 1 é a
  da beira mais perto do suporte (o suporte está nas filas 3 a 6).
- **Uma dúvida que só a placa tira: a roda pode contar a dobrar.** O condensador faz o pino descer
  devagar quando a roda abre (cerca de 0,6 ms até meio), e as entradas deste chip não têm folga
  entre o "em cima" e o "em baixo": uma descida lenta pode passar por subida. Os ensaios que havia
  não o apanhavam, porque a roda a fingir mexe no próprio pino, com flancos rápidos.
- **A roda por fora (programa 0.3.0-a8, gravado na caixa 1 às 08:23).** Comando de bancada novo,
  `roda,<voltas por segundo>[,<% aberta>]`: o pino D26, que não leva fio nenhum, faz de roda (em
  cima enquanto ela estaria fechada, solto enquanto estaria aberta) e a caixa conta as voltas que
  deu. Com o fio da roda do furo Q9 no D26, o sinal chega ao pino do log pelo caminho verdadeiro.
  `node ensaio/roda-por-fora.js COM3` corre quatro fases (devagar, a meio, depressa e com a roda
  aberta quase metade da volta) e só passa se a caixa contar exatamente as voltas dadas. Sem a
  plaquinha diz, como deve, que não chega nada. Bateria da caixa 1 com a a8: 30 ensaios, 29 passam
  e 1 salta-se (o que só serve sem sensor).
- **Por fazer:** ele soldar e conferir; o ensaio em casa do sensor, do vento e da roda ao mesmo
  tempo; e correr o ensaio da roda por fora com a plaquinha. Se contar a dobrar, a subida passa a só
  contar com o pino ainda em cima passado um bocado (por escrever, depois de se ver falhar).

**Em casa, 28/11, 00:40–01:35: três dos pontos adiados feitos na caixa 1, e o sensor mexido à mão.**

- **Pontos adiados da revisão (passo 7 da Tarefa 7 do plano), cada um visto falhar primeiro na
  placa.** Com os dois de 27/11 (a verificação "só em escuta" e o texto dos contadores) são cinco
  em seis. A caixa 1 ficou com o programa 0.3.0-a7 e a bateria dela dá 28 ensaios em 28.
  1. *A conta dos pacotes perdidos no rádio* passou a ter ensaio próprio (0.3.0-a5): a placa faz
     a conta com números de ordem dados à mão (comando `perdidos`) e compara-se com uma tabela de
     15 casos. Com a conta estragada de propósito em três sítios, a tabela apanhou os quatro casos
     previstos e só esses.
  2. *O sinal da caixa 1 que chega a meio de uma volta do ciclo da caixa 2* (0.3.0-a6): a conta
     "há quanto tempo chegou" passou a ser com sinal, com 1 s de folga (comando `recente`, tabela
     de 14 casos). Com a conta antiga falhavam os três casos "a meio da volta" e só esses.
  3. *Uma enxurrada de ordens do portátil* (0.3.0-a7). Medido antes: com 3000 ordens por segundo
     durante 3 s a caixa deitava fora mais de 5000 linhas, e nesses 3 s passava um batimento e
     nenhuma linha de movimento. O limite de bytes por volta que o plano pedia não chegou (ainda
     deitava fora mais de 3000). Com uma ordem obedecida de 10 em 10 ms, no máximo: das 8960
     ordens responde a 333, os batimentos saem a 1000 ms certos, o movimento não perde uma linha e
     a caixa não deita nada fora.
- **Por fazer destes pontos:** gravar a caixa 2 (a parte dela dos pontos 2 e 3 compila, mas a caixa
  esteve desligada) e o sexto ponto, que é só dela: o rádio que falha ao arrancar e volta a tentar.
- **O sensor mexido à mão pelo Ivo (01:20–01:32), com a caixa 1 à escuta:** 10 linhas por segundo
  sem uma em falta, os gestos todos apanhados (até 52°) e o sensor de volta ao sítio certo depois
  de cada um. Ficou à vista que o lado da proa ainda não está dito ao programa: ver a nota de 28/11
  em "Base da caixa 1". A bússola continua sem confiança (0, erro de 180°): não chegou a ser rodada.
- **O ensaio de resistência passou a dizer os atrasos:** quantos intervalos de mais de 250 ms houve
  entre duas linhas e a que altura do ensaio foi o maior (o de 27/11 só dizia "501 ms").
- **Ensaio da noite:** 6 horas com a 0.3.0-a7, só a caixa 1, sem sinais a fingir, da 01:33 às
  07:33: **LIMPO.** Nenhuma leitura em falta, nenhuma linha estragada, nenhum atraso de mais de
  250 ms. Os números estão no ponto 12.

**Em casa, 27/11, 20:39–21:40: o sensor de movimento novo, ligado e a medir.**

- **Chegou o segundo BNO085** (o primeiro deixou de responder a 22/11, ponto 12). O Ivo soldou-lhe
  os pentes, fechou com solda as pontes PS0 e PS1 das costas (vistas na foto dele: boas) e ligou
  os oito fios da Tarefa 7 do plano: VIN→3V3 (vermelho), GND→GND (cinzento), SCL→D22 (castanho),
  SDA→D21 (laranja), INT→D19 (branco), RST→D18 (azul), DI→D23 (verde, novo) e CS→D5 (roxo, novo).
  Conferido nas fotos dele, nas duas pontas, antes de dar corrente. Fotos marcadas:
  `docs/caixas/sensor-novo-oito-fios.jpg` e `sensor-novo-oito-fios-placa.jpg`.
- **Primeiro contacto (21:23): o sensor responde.** Ao primeiro toque no RST abriu a conversa e deu
  o "recomeço completo".
- **O que a placa ensinou sobre esta ligação** (fica escrito em `software/caixas/README.md`, "O
  sensor de movimento", e nos comentários de `caixa1/sensor.h`):
  1. Com o P0 preso aos 3 V não há maneira de acordar o sensor: a placa só lhe consegue escrever
     enquanto ele avisa (INT em baixo). A biblioteca do fabricante, se escrever sem o aviso, fica à
     espera para sempre (a função `txProcess` repete enquanto a escrita devolve 0). Foi o que prendeu
     a primeira versão: o pedido da primeira leitura nunca saiu e a vigia recomeçou a placa.
  2. Os pedidos da biblioteca que esperam resposta não têm prazo (a identificação e a gravação das
     calibrações). O arranque deixou de fazer o da identificação.
  3. A ordem que funciona: toque no RST; abrir e ler até ao "recomeço completo"; segundo toque, o de
     acordar; ler a apresentação; pedir as três leituras; desligar a gravação periódica das
     calibrações (regra 7). Escrever logo a seguir ao segundo toque, sem ler a apresentação, não
     serve: os pedidos saem mas as leituras não vêm.
- **Medido com a caixa pousada:** 10 linhas do movimento por segundo; 128 leituras de aceleração,
  100 de rotação e 100 de atitude por segundo (o mesmo que a 4 fios); 9,61 m/s²; nenhuma leitura
  deitada fora nem ilegível; nenhum toque no RST. A bússola do sensor está sem confiança (0, erro
  estimado de 180°), como se esperava de um sensor que ainda não rodou.
- **Ensaios na placa:** os 26 da caixa 1 correram às 21:32 com o sensor a medir: 25 passaram e 1 saltou-se (o que só faz sentido sem sensor). Dos novos: 10 linhas por segundo com 9 ou mais leituras cada e o peso certo; com um toque no RST a meio, o movimento voltou sozinho em menos de 2 s, o número de ordem seguiu e o batimento e o log não falharam uma linha; depois de a placa recomeçar, o movimento voltou em menos de 5 s; e a gravação das calibrações a pedido foi confirmada pelo sensor, sem ele deixar de medir. Antes, com a 0.2.2 e o sensor só ligado, 22 em 22.
- **Quem fala com o sensor é uma tarefa à parte**, no outro núcleo do chip, que só entrega leituras
  numa fila; o ciclo principal nunca espera por ele. Se essa tarefa ficar 4 s sem dar sinal, o ciclo
  principal recomeça a placa (é a regra 5, o cão de guarda, aplicada à biblioteca).
- **O ensaio de 3 horas ao ritmo do desenho (regra 9) correu nessa noite, das 21:36 às 00:36:
  LIMPO.** Sem uma leitura em falta, sem uma linha estragada e sem o sensor se calar. Os números
  estão no ponto 12.
- **Por fazer:** os pontos adiados da revisão (passo 7 da Tarefa 7; dois dos seis ficaram feitos a
  27/11), a caixa 2 regravada com a versão nova, o ensaio de 3 horas repetido com esses pontos e com
  as duas caixas, o ensaio "sem sensor" com o fio do CS fora, e a bússola (rodar o sensor).

**Em casa, 27/11, 19:33–20:55: a plaquinha do vento montada e ensaiada. PASSA.**

- **Montagem.** Placa de furos de 5 × 7 cm com letras (A a X); suporte de 8 pinos em J3–J6 e
  M3–M6, PC817 na metade de cima, 1 kΩ em D3–H3, 2,2 kΩ em O3–S3, díodo 1N4007 em pé em I4/I3 (risca
  para cima). Desenho: `docs/caixas/vento-plaquinha-montagem.jpg`, feito e conferido por
  `software/ferramentas/caixas/vento_plaquinha.py`. O Ivo ia soldar resistências de 1 Ω e de 2,2 Ω
  (os sacos do sortido são parecidos): viu-se na foto dele a tempo. As certas têm um K no saco.
- **Fios da plaquinha do Ivo:** azul em C3 (entrada dos dados; no barco recebe o amarelo da ficha
  do mostrador), branco em H4 (massa do lado do mostrador; no barco recebe o verde da ficha),
  amarelo em N3 (RX2), verde sem fita em N4 (GND da caixa 1), verde com fita em T3 (3V3).
- **Ensaio (20:53), com a caixa 1 a fazer de mostrador** (programa 0.2.2, comando
  `vento,...,1`: a frase sai só pelo TX2, ao contrário). `node ensaio/plaquinha-vento.js COM3`:
  fase 1, 20 frases certas em 20 s; fase 2, 21 em 20 s (uma na fronteira da janela); fase 3, com
  duas frases coladas, 20 em 20 s. Nenhuma estragada, e os bytes contados batem com os mandados
  (540, 548 e 1340). Antes do ensaio, com a plaquinha ligada e sem sinal, o pino do vento não mexeu
  uma única vez. Na placa a frase sai a 3,3 V (2 mA no díodo do PC817): com o mostrador, a 5 ou
  12 V, há mais folga.
- **A gravação da 0.2.2 falhou à primeira** (a 921 600 baud a ligação caiu aos 9 %: "No more data
  to read from the serial port"). À segunda, a 115 200, ficou gravada e conferida:
  `arduino-cli upload --fqbn esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200 --input-dir <pasta> -p COM3 caixa1`.
  Causa por saber (os fios da plaquinha estavam ligados; não tocam nos pinos da gravação).
- **Por fazer:** correr os ensaios todos da caixa 1 com a 0.2.2 e sem a plaquinha; gravar a 0.2.2
  na caixa 2; decidir como a plaquinha recebe os 3,3 V dentro da caixa 1, onde o pino 3V3 da placa
  já é do sensor (proposta do Claude: o pino 3Vo do sensor, que está vazio e dá 3,3 V; decidido de
  outra maneira a 28/11: ver "a fila dos 3,3 V e da massa", acima); o cabo de
  rede blindado do mostrador até à caixa 1; e a prova com o mostrador verdadeiro, no barco.

**A bordo, 27/11, 17:27–17:41: a roda do log medida na ponta cortada do cabo (fio do meio e malha).**

- **Em ohms**, a rodar a roda à mão: o valor salta entre "OL" (aberto) e zero ou poucos ohms (o Ivo
  viu até 24 Ω). **Em volts alternados, a girar: nada.** É a assinatura de um contacto que a roda
  abre e fecha (como um interruptor de lâminas com íman), e não de uma bobina com sinal fraco, que
  era o que este desenho supunha. A roda está viva.
- **O que muda:** o comparador (e o amplificador) deixam de ser precisos; o LM393 e o LM358
  comprados ficam de reserva. O programa da caixa 1 já serve como está (`log.h`: pino D27 com
  puxada para baixo, conta as subidas e recusa duas a menos de 4 ms, que é o que apaga o ressalto
  de um contacto).
- **Ligação proposta (por montar e ensaiar):** 3,3 V → resistência de 1 kΩ → um fio da roda; o
  outro fio da roda → D27; de D27 à massa, uma resistência de 10 kΩ e um condensador de 100 nF. O
  contacto fechado leva o pino aos 3,3 V (uma subida, um impulso); aberto, o pino cai a zero.
  (A 28/11 juntou-se uma resistência de 1 kΩ em série até ao D27, e as peças foram para a plaquinha
  do vento: ver "a fila dos 3,3 V e da massa", acima.)
- **Contado pelo Ivo (17:44), com o multímetro no apito:** apita quase a volta toda e cala-se uma
  vez em cada volta completa. O contacto está fechado quase sempre e abre uma vez por volta: **um
  impulso por volta** (o desenho supunha cerca de dois). Com a ligação proposta o pino fica em cima
  quase sempre, cai quando o contacto abre e volta a subir: uma subida por volta, que é o que o
  programa conta. Com o contacto fechado passam 0,3 mA, mesmo com o barco parado. Os nós por
  impulso acertam-se depois, a navegar, contra o GPS.

**A bordo, 26/11, 18:50–20:00: o programa do AIS, o registo das viagens e o mostrador do vento.**

- **Programa do AIS (proAIS2 2.0.0, do fabricante).** Descarregado do site da em-trak (página de
  apoio do B330), 66 MB, assinado pela SRT Marine Systems. A instalação normal falha no passo do
  controlador USB (erro 1722). Instala-se sem esse passo, só com o programa e as bibliotecas:
  `msiexec /i proAIS2_x64.msi ADDLOCAL=ProductFeature,DP_F_Redist`. O Windows 11 já vê o AIS como
  porta série sem esse controlador.
- **O programa e o ecrã de bordo não usam o cabo ao mesmo tempo**: a porta é só de um. Para abrir o
  proAIS2 para-se o servidor; no fim, "Disconnect" e volta-se a arrancar o servidor.
- **Frases de GPS ligadas no AIS.** No separador da configuração ligaram-se a GGA e a RMC e
  gravou-se ("Write Configuration"; antes de gravar o programa mostra um aviso para clientes dos
  EUA, que se aceita). Desde então o AIS manda também `$GPRMC` e `$GPGGA` pelo USB, e o servidor tem
  posição, rumo, velocidade e hora do GPS (fonte `b330.GP`; 9 satélites nesse dia). Passa a haver
  duas fontes para a posição própria, `b330.GP` e `b330.AI`: se o ecrã saltar entre as duas, dá-se
  prioridade à do GPS em `priorities.json`. O `baseDeltas.json` continua a ser preciso.
- **Saúde do aparelho (separador Diagnostics):** todas as verificações certas, antena com VSWR
  1,1:1, alimentação a 13,5 V, software 040200.02.02.00.
- **O que está gravado no aparelho:** tipo 36 (veleiro), dimensões 7/3/1/2 m (da antena do GPS à
  proa, à popa, a bombordo e a estibordo), saída NMEA1 a 38400. O número (MMSI) está bloqueado: só
  um revendedor autorizado da em-trak o muda.
- **Wi-Fi do AIS:** já vinha configurado pelo dono anterior, como ponto de acesso (o AIS cria a
  rede dele; não entra na de terra), canal 3, endereço 192.168.0.1, porta 2000. Só se configura
  pelo proAIS2 e com o AIS alimentado a 12 V. O nome e a palavra-passe da rede não se escrevem
  aqui. O Ivo mudou a palavra-passe nesse dia (20:00). Por fazer: o ensaio com um aparelho que não seja o
  telemóvel que dá Internet ao portátil.
- **Separador Anti-tamper:** fica sem palavra-passe (não se tranca o aparelho com uma palavra-passe
  que se pode perder).
- **Registo das viagens (separador VDR).** O AIS guarda as posições do próprio barco desde 1 de
  outubro de 2021. O proAIS2 descarrega-as ("Get data", cerca de dez minutos) para um ficheiro de
  texto, `vdrrmc.log`, no Ambiente de Trabalho: 234 mil linhas `$GPRMC`, uma por posição, muitas
  quando o barco anda e quase nenhumas quando está parado. **Os dados ficam só no portátil, fora
  deste repositório** (`Documents\Veleiro\ais-registo-viagens`, com os dois programas que os leem e
  os mapas). Duas armadilhas do ficheiro: a longitude 9°10,00' W vem escrita `009010` (um zero a
  mais e sem ponto; 2 linhas em 234 mil), e os minutos certos vêm sem casas decimais (`3846`,
  `00902`). O leitor só conta caminho quando o barco se afasta 100 m do último ponto contado, para
  o tremer do GPS no cais não dar milhas. Por fazer: passar o leitor para este repositório, com
  testes e sem dados.
- **Navtex:** nada recebido na emissão das 18:50. O ecrã cheio de símbolos era uma mensagem antiga
  guardada, não ruído; o Ivo apagou as mensagens todas (UP e DOWN ao mesmo tempo). O manual diz que
  o carregador das baterias e a corrente da doca fazem interferência, que a antena é ativa
  (alimentada pelo cabo) e que cada mensagem acaba com a contagem de erros; o ecrã das opções tem
  um espetro do sinal. Próxima prova: a emissão das 22:50, com tudo em "All". Se nada vier:
  experimentar com o carregador e a doca desligados, depois a ficha e o cabo da antena. No fim,
  voltar a "Some" só com a R.
- **Mostrador do vento (NASA Clipper Wind, modelo antigo).** Por trás tem os dois fios da
  alimentação (vermelho e preto), o cabo do mastro (cinzento, preso ao mostrador) e uma tomada
  redonda DIN. O cabo do mastro (malha, preto, azul, branco e vermelho) passa por uma placa de
  junção marcada "WINCON", cor com cor: aí só andam os sinais em bruto do mastro, não servem. Os
  dados do vento já feitos saem pela tomada redonda: 12 V, massa e dados NMEA (visto num caso igual
  no fórum da YBW, onde as cores dadas pela própria NASA estavam trocadas: só vale a medida). O Ivo
  encontrou a ficha DIN de 3 pinos que entra nessa tomada, com um cabo cinzento que não se sabe
  onde acaba e dois fios acrescentados aos pinos por dentro da ficha, um amarelo e um verde, de
  pontas soltas (a fita preta só os segurava). Por medir, por esta ordem: pino com pino não pode
  dar continuidade (o cabo cinzento pode estar cortado com os fios a tocarem-se); a que pino vai
  cada fio; e os volts do amarelo e do verde com a ficha metida. A entrada do vento da caixa 1
  (RX2) só aguenta 3,3 V: a adaptação escolhe-se depois da medida.
- **Medido pelo Ivo (19:55), com a ficha metida e os instrumentos ligados:** o **verde é a massa**
  (dá continuidade com o pino de cima da ficha, o "B" da foto marcada, e com a chapa; verde contra
  a chapa: zero). O **amarelo é o fio dos dados**: contra o verde ou contra a chapa dá um valor
  pequeno que não para quieto, entre uns 20 e uns 100 e poucos milivolts, às vezes negativo, a
  mexer com o vento no mostrador. É a média de um fio que descansa no zero e salta para cima
  quando manda a frase: o sentido normal da linha "A" do NMEA 0183, ao contrário do que a porta
  série da placa espera (repouso em cima; em `vento.h` o pino está com puxada para cima e sem
  inversão). Por saber: o pino do amarelo e a altura dos saltos (5 ou 12 V).
- **Adaptação escolhida (por montar e por ensaiar em casa):** um optoacoplador PC817 entre o
  amarelo e o RX2. Limita a tensão, põe o sinal no sentido certo sem mexer no programa, e separa a
  massa do barco da do portátil (que está nos 220 V), como a norma manda a quem ouve. Lado do
  mostrador: amarelo, resistência de 1 kΩ, díodo do optoacoplador, verde (serve para 5 e para
  12 V: 4 a 11 mA). Lado da caixa 1: coletor ao RX2 com uma resistência de cerca de 2,2 kΩ aos
  3,3 V (com a puxada interna, de dezenas de kΩ, o PC817 fica lento de mais para 4 800 baud),
  emissor à massa da placa. Plano B, se o mostrador não tiver força para o díodo: um transístor
  BC547 com 10 kΩ na base (sem separação das massas). A comprar pelo Ivo: 2 PC817 e 2 BC547.
  Ensaio em casa antes de ir ao barco: a placa de bancada a fazer de mostrador, com o sinal
  invertido, a acender o díodo. Enquanto não houver cabo novo, a ficha fica fora da tomada do
  mostrador (o cabo cinzento pode levar os 12 V a um sítio desconhecido) e as duas pontas isoladas.
- **Onde fica a adaptação (decisão do Ivo, 26/11, 20:04):** dentro da caixa 1, no seco, e não
  atrás do mostrador, onde há humidade. Da ficha do mostrador até lá vão só dois fios do mesmo par
  de um cabo de rede blindado: um leva o amarelo (dados), o outro o verde (massa). A malha liga-se
  só do lado do mostrador, ao verde; do lado da caixa 1 corta-se e isola-se, para as duas massas
  não ficarem unidas pela malha.
- **Peças vistas na Amazon a 26/11 (21:12), para ele encomendar:**
  [PC817C, 50 unidades, BOJACK](https://www.amazon.es/dp/B08CXKZ98W), 9,14 €, e
  [BC547C, 25 unidades](https://www.amazon.es/dp/B09JNTVBX3), 6,00 €. Na loja de eletrónica, duas
  de cada ficam por menos de 2 €. Por saber: se tem em casa uma placa perfurada para as soldar.
- **Na Mauser (visto a 26/11, 21:17; preços com IVA): fica muito mais barato.**
  [PC817 Everlight, ref. 001-0558](https://mauser.pt/001-0558/everlight-pc817-ci-optoacoplador-saida-transistor-5kv),
  0,21 € cada (Lisboa 10, Corroios 28, Freixeira 273), e
  [BC547C, ref. 002-0243](https://mauser.pt/002-0243/bc547c-dio-transistor-npn-45v-0-1a-hfe-400-to-92),
  0,05 € cada, vendido de 5 em 5 (Lisboa 55, Corroios 15, Freixeira 1549). Na Portela, esgotadas.
  Proposta: 4 PC817 e 5 BC547C, 1,09 €. Placa de furos de 5 × 7 cm, se fizer falta:
  [ref. 096-6400](https://mauser.pt/096-6400/placa-protoboard-50x70mm-432-furos), 0,95 €. A pesquisa
  do site novo é `https://mauser.pt/search?q=...`; o aviso dos cookies recusa-se em "Personalizar".
- **Servem estas peças para a roda do log e para a sonda? (pergunta do Ivo, 26/11, 21:20.)** Para a
  roda, não: o sinal dela é fraco e pede o comparador da tabela das peças, que só se escolhe depois
  da medida na ponta cortada (candidato provável: LM393 em DIP, na Mauser
  [ref. 001-2380](https://mauser.pt/001-2380/texas-instruments-lm393p-ci-comparador-de-tensao-duplo-baixa-potencia),
  0,47 €). Para a sonda, depende das costas do mostrador (foto por tirar): se tiver uma saída como a
  do vento, é mais um PC817; se tiver só a saída antiga para o segundo mostrador (dois fios de
  dados, sinal rápido), o PC817 é lento de mais e bastam resistências para baixar o nível. O Claude
  aposta no segundo caso (estimativa, sem prova).
- **Lista completa da Mauser dada ao Ivo (26/11, 21:30; preços com IVA; Lisboa e Freixeira tinham
  tudo).** Para o vento: PC817 `001-0558` ×4, BC547C `002-0243` ×5, díodo 1N4007 `007-0209` ×10
  (o 1N4148 `007-0205` só havia em Corroios) e placa de furos `096-6400`: 3,02 €. Para a roda do
  log, como aposta: LM393P `001-2380` ×2, LM358P `001-0538` ×2 (se o sinal tiver de ser aumentado
  antes do comparador), condensador cerâmico de 100 nF `004-0632` ×5 e suportes de 8 pinos
  `012-0002` ×10: 3,72 €. Para a sonda, nada. As páginas abrem só com a referência:
  `https://mauser.pt/<referência>`.
- **Acrescento à adaptação do vento: um díodo em paralelo com o díodo do optoacoplador, virado ao
  contrário** (cátodo do lado do amarelo, depois da resistência de 1 kΩ; ânodo no verde). O PC817
  só aguenta 6 V ao contrário, e o Ivo viu valores negativos no multímetro.

**A bordo, 26/11, 17:55–18:50 (as caixas não se ensaiaram: o Ivo deixou-as para outro dia).**

- **AIS pelo USB.** O em-trak B330 aparece no portátil como uma porta série USB própria (nesse dia,
  COM7; não é a ponte das placas). Em 30 segundos ouviu 36 barcos diferentes e mandou a posição do
  próprio barco de segundo a segundo. **Pelo USB só manda as mensagens de AIS (`!AIVDM`, `!AIVDO`) e
  um texto de estado (`$AITXT`): não manda as frases de GPS** em que o perfil de bordo contava
  (RMC e GGA, as que a caixa a fingir manda). Por isso o ecrã tinha os alvos mas não tinha posição,
  rumo nem velocidade próprios, nem distâncias aos alvos.
- **Como ficou resolvido:** o servidor passa a saber qual é o número AIS (MMSI) do próprio barco,
  num ficheiro `baseDeltas.json` na pasta de configuração do barco (`software/bordo/config/`, fora
  do git). Com isso, as mensagens `!AIVDO` contam como o próprio barco. Depois de reiniciar: posição,
  rumo e velocidade no ecrã (fonte `b330.AI`), e distância e aproximação a cada alvo. A entrada
  `b330` ficou ligada nessa porta. **O número e o indicativo do barco não se escrevem neste
  repositório**, que é público.
- **O que o AIS diz do barco:** o nome gravado é o antigo e o número é do Reino Unido (os três
  primeiros algarismos dão a bandeira nas aplicações; os portugueses começam por 263). Para mudar a
  bandeira é preciso um número português (ANACOM, licença de estação) e regravar o aparelho; nestes
  aparelhos o número costuma ficar bloqueado depois de gravado (fabricante ou revendedor). O
  procedimento do B330 está por confirmar no manual. A foto que as aplicações mostram carrega-se no
  site de cada uma, não vai pelo AIS.
- Os alvos aparecem primeiro só com o número: a posição vem de poucos em poucos segundos e o nome
  de 6 em 6 minutos.
- **Navtex:** é um NASA Target Navtex Pro. Estava a gravar só as estações R e Z; a R é Lisboa
  (Monsanto), em inglês, nos 518 kHz, com emissões às 02:50, 06:50, 10:50, 14:50, 18:50 e 22:50 UTC.
  O Ivo pôs estações e mensagens em "All" e o ecrã encheu-se de símbolos sem sentido (o mais
  provável é ruído e estações fracas; por provar na emissão das 18:50). Recomendado: voltar a
  "Some" só com a R.
- **Luzes de bordo fracas e a piscar (defeito que o barco tem desde a compra):** o amperímetro do
  serviço oscilava entre cerca de 3 e 9 A de dois em dois segundos e meio (vídeo do Ivo), e as
  luzes ao mesmo ritmo. Com o termóstato do frigorífico no 0, parou tudo. É o compressor do frio a
  tentar arrancar e a desistir, vezes seguidas. Por ver, no compressor: a caixa eletrónica dele, as
  piscadelas da luz de diagnóstico e a tensão nos fios durante o arranque; e a tensão da bateria de
  serviço (há pequenas quebras ao ligar outras coisas, com o barco ligado à doca).

**Decisão do Ivo sobre a base (26/11, 15:02–15:28): fica tudo na mesma base**, a placa, a plaquinha, o
conversor e os dois relés ("vamos meter tudo na base, o conversor e os relés também"). A versão 1, abaixo,
não se imprime. A base completa desenha-se quando os relés chegarem ("quando chegar os relés fazemos
isso"), com as medidas das peças na mão: dos relés, e do conversor o corpo, o comprimento com as orelhas e o
comprimento do cabo até à ficha USB-C, que fica enrolado dentro da base.

**Corrente da caixa 2 no ensaio das 18h (26/11, 15:32–15:36):** o Ivo queria dá-la pelo cabo USB do
portátil, e o portátil vai estar nos 220 V do barco. Assim a terra da tomada ficava unida à massa do motor
por um fio fino e pela porta USB, com o motor de arranque a trabalhar: não. A caixa 2 leva um power bank ao
pé dela (se ele se desligar sozinho por a caixa gastar pouco, passa-se para a tomada USB da mesa de
navegação, com um cabo mais comprido, ou para um carregador de telemóvel). A caixa 1 fica no portátil.
Esquema das ligações e ordem dos passos numa folha: `docs/caixas/caixa2-esquema-barco.jpg`.

**Água doce (26/11, 14:59):** o medidor só entra quando houver o Pi. Até lá, o plugin da água fica
desligado no perfil de bordo e o erro que ele dá no separador Motor ("HTTP 500") não se corrige.

**Base da caixa 2, versão 1 (26/11, 14:45; desenhada; NÃO se imprime, ver a decisão acima).** Pedido
dele: "desenha a base da caixa 2 para pormos as placas no sítio"; as medidas do espaço (8,5 × 20 ×
30 cm) são o máximo, e pode ser mais pequena. Gera-se com `software/ferramentas/caixas/caixa2_base.py`
(imagens com `caixa2_imagens.py`); ficheiros em `docs/caixas/caixa2-base.stl`, `.step` e `.jpg`.

- 128 × 60 × 13 mm com as orelhas (a base em si tem 104 × 60), fundo de 3 mm e o mesmo rebordo da
  caixa 1 para a tampa.
- Leva a placa ESP32 e a plaquinha do barramento, as duas de pinos para cima e enfiadas em espigões
  (gota de cola em cima). As torres do ESP32 são as da caixa 1, sem mudar medida nenhuma.
- A plaquinha fica ao lado da ficha USB, com os pinos virados para a ponta dos cabos: a ponte de fio
  dela sai para esse lado e tem 10 mm livres. As medidas da plaquinha vêm das fotos do Ivo (régua: o
  passo dos pinos), com ±0,3 mm: por isso os espigões dela têm 2,4 mm (furos de 3,0) e a distância
  entre eles é de 11,2 mm, que serve para furos entre 10,6 e 11,8 mm.
- Os cabos saem todos pela mesma ponta, por duas passagens no rebordo. O cabo USB prende-se a um
  berço com abraçadeira, como na caixa 1; os fios do motor prendem-se ao fundo, também com
  abraçadeira.
- Prende-se por uma orelha em cada ponta (furo de 4,3 mm), para não alargar a base; por baixo é lisa.
- **De fora, de propósito:** o conversor (bloco fechado com orelhas próprias: prende-se ao lado e só
  a ficha USB-C entra na base) e os dois relés (entram na versão 2, com as medidas das peças
  verdadeiras e com a tampa).
- A verificação do programa dá tudo livre: nada bate em nada, o ESP32 pousa em 10 mm² e a plaquinha
  em 25 mm².

**25/11, 20:30: quatro fotos da ficha dos botões** (uma de frente, com a cunha verde, e três do
lado dos fios; é uma Deutsch de 6 pinos, como a dos dados). Nas três vê-se a mesma arrumação: do
lado do fecho ficam o roxo e o tampão; ao meio, frente a frente, o vermelho e o amarelo; na ponta
oposta, frente a frente, o branco e o preto. Bate com os números que o Ivo leu na ficha (1 roxo,
2 vermelho, 3 branco, 4 preto, 5 amarelo, 6 tampão). Os números moldados não se conseguem ler nas
fotos. A ficha pequena de 3 pinos da caixa do motor ficou por ver (ele já tinha saído). A foto
marcada dos três fios (amarelo, roxo e preto) ficou feita a 26/11, com a pele das mãos desfocada:
`docs/caixas/caixa2-ficha-botoes-fios.jpg`.

As duas resistências de 1 kΩ são regra da revisão de 23/11: os sinais a fingir da caixa 1 escrevem
nos próprios pinos de entrada, e sem a resistência um ensaio corrido por engano com o barco ligado
punha a placa e o comparador (ou o adaptador) a mandar no mesmo fio. Com ela passam 3 mA e não se
estraga nada.

O adaptador USB–CAN da lista de 29/09 não é preciso nesta fase. Fica como opção para o computador
definitivo, ou a caixa 2 fica de vez.

## Ensaios

1. **Bancada, em casa.** A caixa 1 com o BNO085, impulsos a fingir a roda e uma frase de vento a
   fingir o mostrador; a caixa 2 com tramas a fingir o motor. O ecrã do portátil e do Fold mostram
   os valores e a caixa negra grava. Os plugins levam testes automáticos, como os outros.
   **Sobe e desce:** calibrar o acelerómetro nas seis faces; depois mexer a caixa para cima e para
   baixo cerca de 30 cm, num ritmo certo, durante dois minutos, e confirmar que a conta feita sobre
   a gravação devolve esses 30 cm e esse ritmo.
2. **Barco em seco.** Montar as caixas; rodar a roda do log à mão; ligar o mostrador do vento;
   ignição ligada com o motor parado (teste de escuta do J1939); confirmar o B330 por USB.
3. **Primeiras viagens (Tejo, Oeiras, Cascais, com rede).** Verificação em direto de cada sensor;
   calibrar o log contra o GPS com ida e volta, por causa da corrente; calibrar a proa.
   **Sobe e desce:** com o barco amarrado em água parada, levar o motor devagar do ralenti ao
   máximo; a conta feita sobre essa gravação não pode inventar ondas. Se inventar, a caixa tem de
   ler o sensor mais depressa.

## Pontos em aberto

1. **Versão do mostrador do vento** (foto das costas): NMEA ou linguagem do repetidor.
2. **Sinal da roda do log** (medir com o multímetro): escolhe o comparador. **Visto pelo Ivo
   (24/11, foto das costas do mostrador do log, que ele tem na bancada):** a tomada onde
   entra o cabo é a de antena de televisão (IEC), e a do cabo do transdutor da sonda é igual.
   O cabo da roda já está cortado (Ivo, 24/11): a medida faz-se na ponta cortada, entre o fio do
   meio e a malha, antes de se fazer a emenda. Não está provado que a roda funcione (o que o
   desenho regista é o mostrador avariado; a roda nunca foi medida): a medida também tira essa
   dúvida. **O cabo da sonda não se
   liga à caixa 1:** é por ele que o mostrador manda o impulso forte para o transdutor e ouve o eco;
   a profundidade lê-se na outra tomada do mostrador, por 2 ou 3 fios conforme a versão. No cabo do
   transdutor não se corta nem se emenda nada (dito outra vez ao Ivo a 24/11, quando falou em soldar
   fios para o log e para a profundidade), e a leitura da sonda pela caixa 1 ainda está por fazer (ver "Para que servem os caminhos guardados").
3. **A carta náutica no Fold: decidido pelo Ivo (20/11), carta no browser, servida pelo
   portátil.** A Navionics fica de fora (não recebe a nossa rota e gasta a bateria do Fold). Parte-se
   do `software/dev/carta-demo.html`, que já mostra, com o Leaflet, o barco, o rasto, a rota ativa
   da Melhor rota e os alvos AIS, ao lado do painel. Falta: passar a ser uma página do ecrã servida
   pelo SignalK (sem `localhost` nem bibliotecas da internet), arrumação para o Fold, uma camada de
   profundidades e mosaicos guardados no portátil para funcionar sem rede (fonte a escolher no
   plano, respeitando as regras de cada fornecedor). **Não é carta oficial:** para entradas de
   porto e baixios mantém-se uma carta oficial à mão (o OpenCPN com as o-charts no portátil).
   **Pedido do Ivo (20/11, noite): a carta original do projeto no PC.** Não é preciso emular: o
   OpenCPN tem versão para Windows, com as mesmas cartas oficiais o-charts (com a chave USB, a
   licença passa depois para o computador definitivo) e a ler o SignalK como no Pi (rota ativa,
   rasto, AIS). Para a ver no Fold, espelha-se a janela do OpenCPN do portátil para dentro da
   página Carta, ao lado do painel, pela rede do barco. Fica como carta principal; a carta livre
   no browser fica de reserva. Por ensaiar em casa: a fluidez do toque no Fold e o que gasta.
4. **O endereço do portátil na rede do Fold** (nome fixo ou endereço fixo) e a firewall do Windows.
5. **O B330 por USB**: confirmar que entrega os dados por esse cabo. **Visto pelo Ivo no barco
   (23/11):** o AIS está montado e ligado, e o cabo dele já traz uma saída USB para ligar direto ao
   portátil. No telemóvel não apareceu nenhuma rede Wi-Fi com o nome do AIS (das quatro redes que se
   viam, nenhuma era dele): o Wi-Fi do B330 fica por esclarecer, e não faz falta, porque o plano é o
   cabo USB. A etiqueta confirma o modelo (em-trak B330, 12/24 V, 200 mA no máximo, 20 cm de
   distância à bússola).
6. **O VHF: resolvido (Ivo, 22/11).** Tem GPS próprio, já ligado. Não se liga ao sistema.
   Confirmado no barco a 23/11: a antena de GPS dele está lá.
7. **O sítio do sensor BNO085.** A meio do barco e em baixo não pode ser: a quilha é de ferro
   fundido e o pé do mastro tem reforço de metal. Por cima do motor também não (ferro e o
   alternador). Proposta: junto à bússola do piloto velho, ao lado da roda, em baixo, na cabine de
   popa, que já foi escolhido como sítio sossegado. Confirma-se com o sensor na mão, a ver a proa em
   direto enquanto se muda de sítio e se liga o motor.
8. **O comprimento do cabo do sensor: resolvido** com a caixa 1 no cubículo da bússola e o sensor
   lá dentro. Fica por saber onde vai estar o portátil, para escolher entre o cabo USB e o rádio.
9. **Tabela de desvios da proa.** Além do desvio fixo, o plugin das caixas leva uma tabela de
   desvios por rumo, tirada numa volta completa do barco. Não corrige o que muda com o tempo (motor
   a trabalhar, ferro que se mexe de sítio).
10. **Mostrador da Volvo ilegível de dia.** Avaria conhecida destes mostradores (o LCD perde o
    contraste). As horas leem-se à noite e ficam registadas; depois vêm pelo J1939 (a confirmar na
    primeira escuta). Há LCD de substituição; falta a foto do instrumento para saber o modelo.
11. **Posição do sensor, para o sobe e desce.** Medir com a fita três distâncias: do sensor ao meio
    do barco (para vante ou para ré), ao eixo do barco (para o lado) e à linha de água (em altura).
    Servem para passar a medida para o meio do barco. A gravação não depende delas: podem medir-se
    em qualquer altura.
12. **Ligação e cadência de leitura do BNO085.** Confirmar na bancada a cadência mais alta que a
    ligação aguenta sem falhas, com a aceleração, a rotação e a atitude ao mesmo tempo (100 por
    segundo no mínimo; mais é melhor), e se o chip já entrega as leituras filtradas. O ensaio no
    computador só levou vibrações até 90 por segundo; a 2 000 rotações o motor também vibra a 100.
    **Aviso do fabricante (visto a 22/11):** o
    [guia da Adafruit](https://learn.adafruit.com/adafruit-9-dof-orientation-imu-fusion-breakout-bno085/arduino)
    diz que a ligação de 4 fios (I²C) deste sensor não funciona bem com as placas ESP32, e que a de
    10 fios (SPI) precisa dos fios INT e RST para ser estável. Por isso a ligação não se escolhe
    pelo que é mais simples de ligar, escolhe-se pelo ensaio:
    1. Placa viva e sensor a responder, a 4 fios, com o cabo de ficha pequena (sem solda).
    2. Ensaio de resistência a 4 fios, ao ritmo do desenho e acima dele, durante horas: contar as
       leituras que faltam, os erros e as vezes que o sensor se reinicia.
    3. Se falhar, passa à ligação de 10 fios (SPI), que o fabricante dá como fiável. Obriga a
       soldar a régua de pinos ao sensor e a levar os pinos P0 e P1 a 3 V. A ligação série (UART)
       fica como terceira via.

    Os programas de ensaio estão em `software/ferramentas/bancada/`. O resultado regista-se aqui.

    **Bancada de 22/11/2026 (primeira noite).** Placa ELEGOO (ESP32-D0WD-V3, 4 MB, chip de USB
    CP2102) e sensor com o programa 3.2.13 (peça 10004148), no endereço 4A. O Ivo soldou os dois
    pentes de pinos ao sensor (pinos para cima, do lado do chip) e ligou 4 fios de encaixe de
    cerca de 20 cm: VIN→3V3, GND→GND, SDA→D21, SCL→D22
    ([as fotos dele, marcadas](../../caixas/bancada-ligacao-4-fios.jpg)).

    - **Passo 1, passou:** placa viva, as duas linhas puxadas para cima, sensor a responder.
    - **A ligação de 4 fios funciona a 400 kHz nos dois sentidos:** pedidos e respostas certos,
      leituras de 128 bytes de uma vez sem erro, e as três leituras a chegar ao ritmo pedido.
    - **Achado que conta para o firmware: o sensor pode ficar num estado anormal sem perder a
      corrente.** Nesse estado responde a pedidos (identificação, apresentação) mas ignora a ordem
      de recomeçar e os pedidos de leituras, e a biblioteca da Adafruit não consegue abrir a
      conversa. Pô-lo lá foi o meu primeiro programa de ensaio, que de 2 em 2 s, com a apresentação
      de arranque do sensor ainda por ler, lhe fazia uma escrita vazia (a "procura de endereços") e
      lhe lia só os 4 primeiros bytes. A lista de erros do sensor mostrava nove vezes o erro 2 e o
      12 (lista cheia). Saiu de lá quando recomeçou por si: uma escrita mal formada (23 bytes com um
      cabeçalho a anunciar 21) fê-lo recomeçar em menos de 1 s (a identificação dava "causa do
      último recomeço: 3", que é o cão de guarda dele). A partir daí obedeceu sempre.
    - **Outro achado:** quando a placa recomeça a meio de uma leitura, o sensor pode ficar a
      segurar a linha dos dados e a primeira conversa a seguir falha ("endereço não encontrado").
      Resolve-se com nove impulsos de relógio dados à mão antes de abrir o barramento.

    **Ensaio rápido (1 minuto por ritmo), 22/11 às 20:37.** Sem uma falha nos fios em 695 000
    conversas, sem o sensor se reiniciar nem se calar:

    | Barramento | Pedido por segundo (aceleração / rotação / atitude) | Chegou por segundo | Em falta | Conversa mais demorada |
    |---|---|---|---|---|
    | 100 kHz | 100 / 100 / 100 | 128 / 100 / 100 | 0 | 4,9 ms |
    | 400 kHz | 100 / 100 / 100 | 128 / 100 / 100 | 0 | 1,5 ms |
    | 400 kHz | 200 / 200 / 100 | 255 / 200 / 100 | 0 | 2,1 ms |
    | 400 kHz | 400 / 400 / 100 | 83 / 311 / 78 | 0 | 1,2 ms |
    | 400 kHz | 500 / 400 / 100 | 82 / 312 / 78 | 0 | 1,3 ms |

    - A aceleração vem a 125 por segundo quando se pedem 100 (o degrau do sensor é de 8 ms).
    - **O teto desta ligação é à volta de 200 / 200 / 100.** Acima disso o sensor não dá vazão: não
      há erros nem saltos no número de ordem, mas chegam menos leituras do que as pedidas (serve
      primeiro a rotação). O desenho precisa de 100 de cada, por isso chega com folga.
    - Ruído com o sensor parado (desvio-padrão): 0,02 m/s² nos eixos deitados, 0,03 a 0,07 no
      vertical. A proa ainda não vale ("erro estimado 180°"): o sensor só a acerta depois de rodado
      em várias direções, o que fica para o ensaio da bússola.

    **Ensaio de resistência, 22/11 das 20:45 às 23:11: não passou.** A 400 kHz e 200 / 200 / 100
    (o dobro do desenho; chegaram 256 / 200 / 100). Era para durar 3 horas e acabou às 2 h 26 min,
    porque o sensor bloqueou sozinho e não voltou. O registo completo ficou no portátil, em
    `Documents\Veleiro\bancada\bno085\2026-11-22_204510_resistencia.log`.

    - **Enquanto correu, correu limpo.** 8 484 segundos de leituras sem uma falha nos fios
      (23,4 milhões de conversas), nenhuma leitura em falta pelo número de ordem, e a conversa mais
      demorada 4,4 ms. O troço mais comprido foi de 2 h 09 min seguidas (das 21:01:51 às 23:11:04),
      com uma única conversa falhada, às 21:02:13, sem consequência.
    - **Primeiro episódio, das 20:57:43 às 21:01:51.** O sensor deixou de responder sete vezes em
      4 minutos ("endereço não encontrado"). De cada vez o programa de bancada reiniciou a placa e o
      sensor voltou a responder sem lhe cortarem a corrente. Mas arranque sim, arranque não, abria a
      conversa e não mandava leituras; mais um reinício resolvia. Ao fim de 14 reinícios estabilizou.
    - **Segundo episódio, às 23:11:04: bloqueou de vez.** Reiniciada a placa à mão, o sensor continua
      mudo. Tem corrente (a luz dele está acesa e as duas linhas estão puxadas para cima), não segura
      nenhuma linha e não responde em nenhum endereço do barramento: nem no 4A/4B, nem no 28/29 do
      programa de arranque dele (varrimento feito à 01:31). À 01:32, 2 h 21 min depois, estava
      igual, e às 08:41 de 23/11 também, sempre com corrente (o portátil regista a placa ligada sem
      interrupção desde as 19:57 de 22/11): não recupera sozinho. Cortar-lhe a corrente também não
      o recuperou (ver "23/11 de manhã", abaixo).
    - **A placa estava parada nos dois episódios.** Vê-se na aceleração gravada: o Ivo mudou-a de
      sítio às 20:54–20:55 e deu-lhe dois toques, às 21:08 e às 22:29. O primeiro episódio começou
      2 min 40 s depois de a pousar e o segundo 42 minutos depois do último toque.
    - **Os oito bloqueios começaram todos a um múltiplo exato de 5 segundos depois de a conversa
      abrir** (aos 10, 20, 25, 35, 750 e 7 750 s). Por acaso seria 1 hipótese em 5 de cada vez. O
      programa de bancada não faz nada de 5 em 5 segundos; fica a suspeita de uma tarefa periódica do
      próprio sensor (a gravação das calibrações na memória dele), **por confirmar** na documentação
      do sensor e num ensaio com essa gravação desligada.
    - **O programa de bancada também ficou preso** no segundo episódio: deixou de mandar linhas às
      23:11:05 e só voltou com um reinício à mão. Não tem cão de guarda. Das sete vezes anteriores
      tinha recuperado sozinho.
    - **Linhas estragadas no cabo USB a 921 600 baud:** das 7 641 linhas de um segundo do troço
      comprido, 110 (1,4 %) chegaram ilegíveis, cada uma por inteiro e sem relação com as falhas do
      sensor. O desenho usa 460 800 baud; falta medir aí.
    - **A bússola do sensor esteve as três horas com confiança 0 e erro estimado de 180°** (a placa
      quase não rodou). Nesse estado o plugin das caixas deixou de publicar a proa (correção feita na
      mesma noite; o adornamento e o caimento saem na mesma).

    **23/11 de manhã: o sensor continua sem responder, mesmo depois de lhe cortarem a corrente.** O Ivo ligou os
    dois fios novos, INT→D19 e RST→D18
    ([marcados nas fotos dele](../../caixas/bancada-ligacao-6-fios.jpg)), com o cabo USB fora durante
    10 minutos (09:16–09:26), e mais tarde outras duas vezes, uns 3 minutos de cada, para mexer nos
    fios. Com o programa `bancada/fios6`:

    - Depois de cada um dos três cortes de corrente o sensor continuou sem responder em nenhum
      endereço do barramento (varrimento de 08 a 77).
    - A linha do RST obedece à placa: está puxada para cima pela resistência do sensor e desce
      quando a placa a puxa. Seis toques no RST, de 20 ms a 2 s: o sensor não acordou, e o INT nunca
      desceu (um sensor vivo baixa-o mal arranca, para se apresentar).
    - A linha do INT está solta: nada a segura, nem em cima nem em baixo.
    - Prova do programa de arranque do sensor, com o fio do D19 mudado do INT para o BT e o BT em
      baixo durante o toque no RST: ninguém responde, nem no endereço 28/29 nem no 4A/4B. Repetida
      com os papéis dos dois fios trocados, para o caso de estarem trocados no sensor: igual.
    - O sensor tem corrente: a luz verde dele está acesa, e as duas linhas do barramento, a do RST e
      a do BT estão puxadas para cima.

    **O que isto prova e o que não prova.** Prova que nada do que a placa faz pelos fios de sinal
    acorda o sensor. **Não prova que o sensor avariou** (o Claude chegou a dizê-lo; o Ivo respondeu
    "isso não morre assim", e com razão): falta ver se a corrente chega bem ao chip. A luz verde
    acende com 1 ou 2 mA e o chip precisa de dez vezes mais; um fio de encaixe com mau contacto, ou
    uma solda fria num dos pinos soldados à mão, dá exatamente este quadro (luz acesa, chip parado).
    Dava também os bloqueios da véspera, se for de 5 em 5 segundos que o sensor puxa mais corrente.
    A placa ESP32 está boa: fez estas provas todas, e os 3,3 V dela, medidos por ela própria, estão no
    teto do medidor (3,1 V ou mais).

    O Ivo contou entretanto que tinha passado as duas placas para a peça nova e emendado os fios, que
    ficavam a fazer força. O que se fez a seguir, por esta ordem, sempre com o mesmo resultado (o
    sensor sem responder):

    1. Fios diretos, sem emendas.
    2. A tensão dentro do sensor medida pela própria placa (o pino 3Vo levado por um fio ao D4;
       comando `v` do `fios6`): no teto do medidor (3,1 V ou mais), sem uma queda em 12 000 leituras
       seguidas, nem durante um toque no RST, e firme contra a resistência interna da placa (é
       mesmo a saída do regulador, não uma linha só puxada para cima).
    3. As soldas dos pinos retocadas pelo Ivo e o fio preto (a massa) trocado por um novo.
    4. O lado da placa conferido (comando `i`): os pinos D21 e D22 puxam as linhas para baixo e
       largam-nas como devem; e o princípio de uma conversa com os endereços 4A, 4B, 28 e 29, feito
       à mão pela placa, a 5 kHz, sem o circuito de barramento do chip nem a biblioteca, não teve
       resposta de ninguém.

    Ao todo: quatro cortes de corrente e onze toques no RST. **O que fica: com fios bons, corrente
    boa e a placa a falar bem, a plaquinha do sensor nem responde nem dá sinal no INT.** O que
    sobra está dentro dela (o chip, o cristal, uma das peças pequenas), e de fora não há mais nada
    a fazer-lhe. A massa do sensor não chegou a ser medida (fio novo e solda retocada). A causa não
    se sabe; uma hipótese sem prova é eletricidade estática: o registo da véspera mostra a placa
    mexida às 21:08 e às 22:29, e o sensor parou às 23:11. A decisão de o trocar é do Ivo (comprado
    a 20/11).

    **O que já fica decidido para o firmware, seja qual for o desfecho:**

    - **Os fios RST e INT ficam, seja qual for a ligação.** O RST porque os sete bloqueios do
      primeiro episódio passaram com um reinício, e no mar ninguém vai tirar o cabo; o INT porque é
      como o fabricante manda ler o sensor (ele avisa quando tem dados), em vez de lhe perguntar
      milhares de vezes por segundo.
    - **As primeiras horas de um sensor correm ao ritmo do desenho** (100 / 100 / 100), com as
      regras abaixo já a trabalhar. O ensaio ao dobro do ritmo só depois de 3 horas limpas.

    Regras que isto dá ao firmware da caixa 1:

    1. Ao arrancar: soltar o barramento (os nove impulsos), ler até ao fim tudo o que o sensor
       tiver para dizer, só depois escrever. Nunca escritas vazias para "ver se está lá", nunca
       pacotes lidos a meio.
    2. Confirmar que o sensor respondeu "recomeço completo" à ordem de recomeçar e que as
       leituras chegam mesmo; "a conversa abriu" não chega como prova.
    3. A placa recomeça sem o sensor perder a corrente sempre que o portátil reabre a porta USB:
       esse caminho tem de ficar ensaiado (na bancada correu bem três vezes em três).
    4. **Levar um quinto fio, do pino RST do sensor a um pino da placa.** Deixou de ser só um
       parecer: o bloqueio das 23:11 mostrou que sem ele o sensor não volta. É o recomeço garantido,
       por fio, para quando o sensor não obedece à ordem ou nem sequer responde. Por combinar com o
       Ivo, com os pinos marcados na foto dele.
    5. **Cão de guarda na caixa.** Se o programa da caixa ficar preso, como o de bancada ficou, a
       placa recomeça sozinha em poucos segundos. Uma caixa calada sem ninguém a reiniciar não pode
       acontecer.
    6. **Não martelar o sensor.** Ler só quando ele avisa (um sexto fio, do pino INT a um pino da
       placa) ou, sem esse fio, a um ritmo pouco acima do das leituras; nunca milhares de perguntas
       por segundo.
    7. **Experimentar desligar a gravação periódica das calibrações do sensor** e repetir o ensaio
       de resistência. Se os bloqueios desaparecerem, fica desligada e a calibração grava-se só a
       pedido, com o barco parado.
    8. **Todas as linhas que a caixa manda levam soma de controlo**, as do motor também (hoje não
       levam): o cabo estraga linhas inteiras, e uma linha do motor estragada não pode passar por boa.
    9. **O ensaio de resistência repete-se com o RST e o cão de guarda a trabalhar** e só passa com
       3 horas seguidas em que qualquer bloqueio se resolva sozinho, com o tempo sem leituras contado.
    10. **Um sensor que não volta com o RST diz-se ao portátil.** A caixa tenta o RST, conta as
        tentativas e, se o sensor continuar calado, manda essa informação nas linhas dela, para o
        ecrã dizer que o sensor de movimento não responde, em vez de ficar só sem proa.

    **Ensaio de resistência do sensor novo, 27/11 das 21:36 às 00:36: LIMPO (regra 9).** O segundo
    BNO085, pela ligação de 10 ligações (SPI) com o INT e o RST, na caixa 1 com o programa 0.3.0-a3,
    ao ritmo do desenho (100 / 100 / 100), sem sinais a fingir, com a caixa pousada na mesa do Ivo.
    Contado pelo `software/caixas/ensaio/resistencia.js` (`COM3 180 --sem-geradores`), com o leitor
    que lê as linhas no barco. O registo, de minuto a minuto, ficou no portátil, em
    `Documents\Veleiro\bancada\caixas\2026-11-27_2137_resistencia-sensor-novo-3h.log`.

    | O que se contou em 10 801 s | Resultado |
    |---|---|
    | Tempo total sem leituras do movimento | **0 s.** 108 021 linhas de movimento (10 por segundo), nenhuma em falta pelo número de ordem |
    | Linhas estragadas a 460 800 baud | **0 em 140 427** (0,0000 %) |
    | Segundos sem batimento da caixa 1 | 0 (10 802 batimentos) |
    | Recomeços da placa | 0 |
    | Mudanças do estado do sensor e toques no RST | 0 e 0: o sensor nunca se calou |
    | Linhas que a caixa não conseguiu mandar | 0 |
    | Maior intervalo entre duas linhas, no relógio do portátil | 501 ms, uma vez, logo no primeiro minuto |

    - **O sensor não teve um único episódio em 3 horas.** O primeiro tinha bloqueado sozinho às
      2 h 26 min (22/11, a 4 fios e ao dobro do ritmo). Por isso a parte da regra 9 que diz "qualquer
      bloqueio se resolva sozinho" não chegou a ser posta à prova neste ensaio: não houve bloqueio. O
      recomeço pelo RST está ensaiado à parte, com um toque dado de propósito (ensaio "Review Focus 3"
      da caixa 1: o movimento volta em menos de 2 s).
    - **O intervalo de 501 ms não foi uma perda:** nesse minuto os números de ordem seguem-se e a
      contagem está completa (604 linhas de movimento). Foi um atraso na entrega, uma vez; a causa
      não se viu (o contador só guarda o maior intervalo, não a hora dele). Nos quatro ensaios de
      23/11, com os sinais a fingir, o maior intervalo andou pelos 100 ms. Fica para o ensaio
      seguinte dizer se se repete e quando. (Não se repetiu: ver o ensaio da noite de 28/11, abaixo.)
    - **Falta repetir** com os pontos adiados do passo 7 da Tarefa 7 do plano e com as duas caixas,
      como o plano manda: este correu só com a caixa 1 e antes deles.
    - A partir daqui o ensaio ao dobro do ritmo (200 / 200 / 100) deixa de estar vedado ("só depois
      de 3 horas limpas"). O desenho não precisa dele.

    **Ensaio da noite, 28/11 da 01:33 às 07:33: LIMPO, 6 horas.** A mesma caixa 1 e o mesmo sensor,
    já com o programa 0.3.0-a7 (cinco dos seis pontos adiados do passo 7 da Tarefa 7 do plano), ao
    ritmo do desenho, sem sinais a fingir, pousada na mesa do Ivo. O mesmo contador
    (`COM3 360 --sem-geradores`), que desde 28/11 também conta os atrasos na entrega. O registo, de
    minuto a minuto, ficou no portátil, em
    `Documents\Veleiro\bancada\caixas\2026-11-28_0137_resistencia-0.3.0-a7-noite-6h.log`.

    | O que se contou em 21 603 s | Resultado |
    |---|---|
    | Tempo total sem leituras do movimento | **0 s.** 216 036 linhas de movimento (10 por segundo), nenhuma em falta pelo número de ordem |
    | Linhas estragadas a 460 800 baud | **0 em 280 847** (0,0000 %) |
    | Segundos sem batimento da caixa 1 | 0 (21 604 batimentos) |
    | Recomeços da placa | 0 |
    | Mudanças do estado do sensor e toques no RST | 0 e 0: o sensor nunca se calou |
    | Linhas que a caixa não conseguiu mandar | 0 |
    | Maior intervalo entre duas linhas, no relógio do portátil | 200 ms, uma vez, às 2 h 18 min 41 s de ensaio (03:52:35) |
    | Intervalos de mais de 250 ms entre duas linhas | 0 |

    - **O atraso de 501 ms de 27/11 não se repetiu em 6 horas.** O maior intervalo foi subindo
      devagar (102 ms aos 13 s, 110 ms aos 2 min, 114 ms aos 37 min, 200 ms às 2 h 18 min) e nas
      3 h 41 min seguintes não houve outro maior. O de 27/11 fica como caso único, de causa não vista.
    - **Regular de ponta a ponta:** em cada um dos 360 minutos do registo chegaram entre 780 e 782
      linhas, e 600 ou 601 de movimento.
    - **Com o de 27/11 são 9 horas de ensaio de resistência (3 + 6) sem um único episódio do sensor
      novo.** A parte da regra 9 que diz "qualquer bloqueio se resolva sozinho" continua por isso sem
      ser posta à prova num ensaio comprido; o recomeço pelo RST está ensaiado à parte.
    - **Não é o ensaio final do passo 7:** correu só com a caixa 1 e sem o sexto ponto adiado (o
      rádio da caixa 2 que volta a tentar). Esse repete-se com as duas caixas, 3 horas.

    **O atraso de 501 ms ficou explicado e corrigido (28/11, 08:38–09:10; programa 0.3.0-a9).** Um
    ensaio de resistência arrancado às 08:38 deu, logo no primeiro minuto, 117 intervalos de mais
    de 250 ms entre linhas, sem uma em falta. Medido linha a linha (a que horas chega cada uma ao
    portátil): das 201 linhas de movimento de 20 s, 190 tinham exatamente 64 bytes, e essas chegavam
    todas tarde (100 ms a mediana, 401 ms a pior), coladas à linha seguinte; as outras 11 chegavam
    em 1 ms. Nenhum monte de linhas entregue de uma vez somava um múltiplo de 64 bytes.

    - **A causa é a ponte USB da placa** (o chip CP210x, entre a porta série do ESP32 e o cabo).
      Entrega os bytes ao portátil em pacotes de 64. Quando o fio para, manda o resto num pacote
      mais pequeno, e é esse que faz o portátil entregar tudo ao programa. Se o fio parar mesmo no
      fim de um pacote cheio não há resto, e o portátil fica com os bytes à espera de mais.
    - **Porque aparecia e desaparecia:** depende dos algarismos de cada número da linha. Com a
      caixa parada em cima da mesa, a linha do movimento tem 64 bytes enquanto o número de ordem
      tiver quatro algarismos: dos 100 aos 1000 s depois de a caixa arrancar. O ensaio de 27/11
      apanhou uma no primeiro minuto (os 501 ms: a linha esperou pela do log seguinte); o da noite
      começou com a caixa ligada há mais tempo e não apanhou nenhuma. No mar os números mexem
      sempre: seria uma linha em cada 64, mais ou menos, a chegar 100 ms atrasada.
    - **A correção (regra `AqPonte`, em `software/caixas/comum/src/arlequin_linhas.h`):** depois de
      cada linha, se o fio pudesse parar num múltiplo de 64 bytes, a caixa junta-lhe um fim de
      linha a mais. São linhas vazias, que o plugin das caixas e os ensaios já deitavam fora. Uma
      pausa curta entre duas linhas tanto pode ter chegado para a ponte despachar como não: a conta
      faz-se pelas duas hipóteses, e às vezes são precisos dois fins de linha. Gasta menos de um
      byte em mil.
    - **Como ficou provado.** Num modelo da ponte, sem placas (`ensaio/ponte.js`, 6 ensaios):
      milhares de sequências ao acaso, com a ponte a despachar ao fim de 0,1 a 9 ms, e nenhuma
      linha retida. Na placa, com o comando de bancada novo `surto` (linhas com um número certo de
      bytes): antes da correção ficavam retidas, as três vezes em três, as linhas de 64, 128 e 192
      bytes e duas de seguida que somassem 64 ou 128; os pares com uma pausa do fio de 0,15 ms ou
      mais já não ficavam (a ponte despacha ao fim de menos de 0,15 ms de fio parado). Com a
      correção não fica nenhuma. Medido outra vez durante 30 s, com as 300 linhas de movimento
      todas de 64 bytes: chegam de 100 em 100 ms (101 ms o maior intervalo) e 1 ms depois de
      escritas (2,4 ms a pior).
    - **Um ensaio da bateria falhava ao acaso e ficou acertado.** "Ao ligar o movimento a fingir, a
      caixa diz que finge antes de sair a primeira linha a fingir" contava como fingida uma medição
      verdadeira que a caixa tivesse escrito uns ms antes de receber a ordem. Passou a contar só o
      que chega depois da resposta à ordem; corrido 12 vezes seguidas, passou as 12. O programa da
      caixa estava certo.

## Pedido novo: carta com toque e caminhos guardados (por desenhar com o Ivo)

O Ivo quer, no Fold: mexer na carta com os dedos, marcar uma rota, ver as batimétricas, ver sempre
o caminho feito e escolher no fim se o guarda ou se o tira do ecrã, para a carta não ficar cheia
nas zonas de passagem. Só ficam à vista os caminhos que ele escolher (os habituais).

Proposta do Claude, duas cartas, cada uma para o que faz bem, com um botão para trocar:

1. **A nossa carta, com toque** (a página Carta, a partir do `carta-demo.html`): mexer e ampliar,
   tocar para marcar pontos e fazer uma rota, que fica guardada no SignalK (e por isso serve à
   Melhor rota, ao Leme e, mais tarde, ao piloto); o caminho da viagem; os caminhos guardados; o
   AIS; e as linhas de profundidade da fonte europeia gratuita EMODnet (o serviço tem as camadas
   `emodnet:contours` e `emodnet:mean_multicolour`, confirmado a 20/11). Não é carta oficial, e o
   pormenor destas linhas na nossa zona está por ver.
2. **A carta oficial** (OpenCPN espelhado): para ver os fundos com pormenor em baixios e entradas
   de porto. Mostra a rota marcada na nossa carta. Não serve para marcar rotas com o dedo, e as
   rotas feitas lá dentro não chegavam ao nosso sistema.

**Cartas pagas para dentro da nossa carta (o Ivo aceita pagar licença; visto a 20/11):**

| Fonte | O que dá | Limites |
|---|---|---|
| o-charts no OpenCPN (cerca de €20 + €23 da chave, preços de 28/09) | Cartas oficiais de Portugal | Só abrem dentro do OpenCPN; no Fold, por espelho |
| [Navionics Web API](https://developer.garmin.com/marine-charts/web/), plano "Enhanced" | Cartas Navionics com batimetria HD **dentro da nossa página**, com o barco, a rota e o AIS por cima | Pago por ano, preço só a pedido; pensado para empresas; precisa de internet. O plano grátis não deixa pôr nada por cima da carta |
| [GeoGarage](https://www.geogarage.com/pro/), serviço para empresas | Cartas do Instituto Hidrográfico em mosaicos para qualquer mapa web | Só para empresas e marcado "não usar para navegação". A assinatura de particulares só funciona nas aplicações parceiras |

Caminho proposto: começar pelas o-charts no OpenCPN e, em paralelo, pedir à Garmin o preço do plano
"Enhanced". Se for razoável, a Navionics passa a ser a carta de fundo da nossa carta com toque.

**Parecer final de 20/11, a pedido do Ivo ("qual é a melhor opção para a carta?"):** nesta fase, a
carta é o **OpenCPN no portátil com as o-charts de Portugal**, espelhado no Fold ao lado do painel.
É oficial, tem as batimétricas, funciona sem internet e é o que dá menos trabalho antes das
primeiras viagens. Preços vistos a 20/11 em o-charts.org, sem IVA: cartas "Portugal 2026" €16,00 e
chave USB €19,00 (em stock). As rotas vêm da Melhor rota ou marcam-se no portátil. A carta com
toque, os caminhos guardados com o fundo e a Navionics ficam para depois.

**Melhor do que o espelho, a ensaiar (20/11, noite): o AvNav.** O Ivo não queria o espelho e pediu
"uma maneira". O [AvNav](https://www.wellenvogel.net/software/avnav/docs/install.html?lang=en) é
um programa de cartas feito para se usar pelo browser, com toque, rotas e caminhos, que lê os
dados do SignalK. Tem um acordo com a o-charts: o seu módulo abre as **mesmas cartas oficiais** e
serve-as ao browser, só dentro da rede do barco e para 5 aparelhos no máximo
([documentação](https://www.wellenvogel.net/software/avnav/docs/hints/ocharts.html?lang=en)).
Esse módulo corre em Linux (Raspberry Pi) e em Android, não em Windows. Por isso:

- **No portátil:** ensaiar o AvNav com o módulo das o-charts numa camada Linux dentro do Windows.
  Se funcionar, o Fold abre a carta oficial como página, com toque, sem espelho.
- **No computador definitivo** (Raspberry ou Orange Pi, que são Linux): corre diretamente.
- **Se o ensaio falhar:** fica o espelho do OpenCPN, como reserva.

**Ensaio de 21/11/2026 no portátil: funciona.** O Ivo ligou a camada Linux do Windows (WSL 2) e
instalou-se o Ubuntu 24.04. Lá dentro, pelo repositório oficial do AvNav (free-x.de, Ubuntu Noble):
`avnav` 20261102 e `avnav-ochartsng` 20260703. Resultado:

- A página do AvNav abre no portátil em `http://localhost:8080`.
- O módulo das o-charts só arrancou depois de uma correção: o descodificador da o-charts
  (`oexserverd` 1.0.29) rebentava por o WSL não ter nenhum barramento USB. Resolve-se carregando o
  módulo `vhci_hcd` (USB virtual), que ficou permanente em
  `/etc/modules-load.d/arlequin-usb-virtual.conf`. Com isso o módulo fica estável (estado
  "Running") e gera a impressão digital do sistema que a loja pede para a licença.
- Por provar: uma carta comprada a abrir de facto; a chave USB a chegar ao WSL (precisa de mais
  uma peça no Windows, o `usbipd`); o acesso a partir do Fold (a porta do WSL tem de ser aberta
  para a rede, o que mexe nas definições do Windows); o arranque automático; a ligação ao SignalK.

**Ensaio de reinício (21/11, 13:53): a licença tem de ir na chave USB, não no "sistema".**

- Depois de desligar a camada Linux por completo (`wsl --shutdown`) e de a voltar a ligar, tudo
  arranca sozinho: o USB virtual, o AvNav e o descodificador (à primeira tentativa).
- A "impressão digital" que a loja pede para prender a licença a um sistema leva o endereço da
  placa de rede da camada Linux, o nome do utilizador e da máquina, o nome do sistema operativo e
  o identificador do disco. O endereço da placa de rede **muda a cada arranque** da camada Linux
  (medido: mudou de um arranque para o seguinte); o resto ficou igual. A documentação da
  Microsoft não tem nenhuma definição para o fixar.
- As condições da loja dizem que, se um destes elementos mudar, o aparelho passa a contar como
  novo e perde-se uma das instalações. Logo: **nunca atribuir as cartas ao "sistema" da camada
  Linux**. Atribuem-se à chave USB, que conta como um aparelho portátil e serve em todos os
  computadores (este portátil e o computador definitivo).
- A camada Linux já está pronta para a chave: o pacote do AvNav traz a regra que lhe dá acesso e
  o núcleo tem as peças do USB por rede (`vhci-hcd`, `usbip-core`). Falta o `usbipd` do lado do
  Windows, quando a chave chegar (é o Ivo que corre o comando).
- A camada Linux adormece logo que fecha a última sessão, mesmo com o AvNav a correr. Para o
  arranque automático há uma definição própria do WSL (`instanceIdleTimeout=-1`, secção
  `[general]` do `.wslconfig`); até lá mantém-se uma sessão aberta.

**Loja o-charts, visto a 21/11:**
[Portugal 2026](https://o-charts.org/shop/en/oesenc/79-portugal.html) (ref. PT2, edição 2026/1-3
de 05/10/2026) €16,00 sem IVA, **5 instalações permitidas**;
[chave USB](https://o-charts.org/shop/en/hardware/38-usb-key-dongle.html) €19,00 sem IVA, em
stock, enviada em 1 a 2 dias úteis (correio normal 5 a 10 dias úteis na UE; DHL Express 3 a 5).
As cartas caducam um ano depois da compra: deixam de ter atualizações e deixa de se poder
atribuí-las a aparelhos novos, mas as já pedidas continuam a abrir. Uma atribuição não se desfaz
depois de pedidas as cartas. O módulo do AvNav só abre as cartas vetoriais (as de Portugal são);
as de imagem (oeRNC) não.

Plano das instalações: uma para a chave USB (AvNav no portátil e no computador definitivo) e, se
o Ivo quiser ver as cartas antes de a chave chegar, uma para o OpenCPN no Windows, que fica como
reserva. Por ver no ensaio: como a rota da Melhor rota aparece no AvNav e como as rotas marcadas
no AvNav chegam ao SignalK.

O cartão de cartas que está no plotter Garmin da mesa de navegação não serve para isto: essas
cartas só abrem em aparelhos Garmin. Continua a servir no próprio plotter, como reserva.

**Para que servem os caminhos guardados (explicado pelo Ivo):** deixar marcados na carta os sítios
por onde já passou, para ter cuidado com o fundo e o calado (1,90 m) e passar sempre pelos sítios
melhores. Proposta do Claude: ligar também a **sonda de profundidade** (NASA Clipper Depth) à
caixa 1, se o mostrador tiver saída de dados, para cada ponto do caminho levar o fundo medido e a
hora (a maré dessa hora permite comparar passagens). O caminho guardado pode então mostrar a cor
conforme a água que havia debaixo da quilha. Falta a foto das costas do mostrador da sonda.

**Ligação da sonda à caixa 1 (ideia do Ivo, 24/11): dois fios de silicone, com a caixa só a
escutar; do sítio dos mostradores ao cubículo são 1,5 m no máximo.** Os fios saem da tomada de
dados do mostrador (a do segundo mostrador, ou repetidor), nunca da tomada do cabo do transdutor.
Conforme a versão do mostrador são 2 ou 3 fios; se ele não tiver essa tomada, a sonda não se lê
por fios. Entre os fios e a placa vai uma adaptação, como no vento (a tomada antiga trabalha
provavelmente a 5 V e a placa a 3,3 V, e um dos pinos pode trazer os 12 V do barco). Por fazer: a
foto das costas do mostrador, para marcar nela a tomada e os pinos; a adaptação; e a parte do
programa da caixa 1 e do portátil que lê a sonda.

O caminho: a caixa negra já grava a posição de 10 em 10 s, sempre. Falta mostrar no ecrã o caminho
da viagem em curso (mesmo depois de fechar e abrir a página, ou de trocar de aparelho) e, no fim,
dois botões: **Guardar caminho** (com nome; fica na lista e na carta, noutra cor) e **Tirar do
ecrã** (sai da carta e continua na caixa negra). Uma lista dos caminhos guardados, para mostrar,
esconder ou apagar cada um.

## Pedido novo: ligar e desligar o motor da roda do leme (por decidir)

O Ivo quer ligar e desligar o motor sem ir ao painel da Volvo, sobretudo numa emergência. A
sequência de hoje no painel: ON até os manómetros mexerem; quando o apito para, START; para
desligar, OFF.

Tecnicamente dá: um relé em paralelo com cada botão faz o mesmo que o dedo, e a caixa 2 está junto
ao motor. Mas é a única função do sistema em que um erro é perigoso (arranque sem ninguém querer,
paragem na pior altura, motor de arranque preso). Parecer do Claude:

1. **Para a emergência, botões verdadeiros na roda, ligados por fio** aos mesmos contactos do
   painel, sem telemóvel, Wi-Fi nem portátil pelo meio.
2. **No sistema, os mesmos comandos como comodidade**, com proteções: interruptor físico de
   "armar" que corta a alimentação dos relés; toque demorado no ecrã; não dá ao arranque se o motor
   já trabalha (lê as rotações); larga o arranque quando o motor pega ou ao fim de cerca de 10 s,
   com um corte no próprio circuito; o sistema nunca liga o motor sozinho.
3. **Antes de mexer:** fotos do painel (frente, costas e ficha) e o esquema elétrico do motor
   (grupo 30 do manual de oficina). Nada de testar fios às cegas: a caixa eletrónica do motor (MDI)
   é sensível e cara.

**Decidido pelo Ivo (20/11, noite): só dois botões, ligar e desligar, e a chave faz de "armar".**
No barco dele a ordem é: chave, o painel acende e faz a verificação (apita), e só depois o botão de
ligar; o de desligar para o motor, e enquanto a chave e o painel ficarem ligados pode voltar a
ligar a qualquer momento. Os botões do painel são de pressão e mandam um impulso à caixa do motor.
Os nossos dois comandos ficam **em paralelo com esses dois botões**: com a chave desligada o painel
não tem corrente e os comandos não fazem nada. No ecrã, os botões só ficam ativos quando o sistema
vê o motor "acordado" (chegam tramas do J1939). Mantêm-se as proteções: toque demorado, não dar ao
arranque com o motor a trabalhar, e largar o arranque sozinho. Por confirmar: se o botão de ligar é
de toque ou de manter carregado, e onde se apanham os dois fios (no painel ou na cablagem junto à
caixa do motor), com fotos e o esquema.

**Correção do Ivo (20/11): não há chave.** No painel do motor há um botão que liga o sistema todo
(liga e desliga); passados uns segundos o painel apita, feita a verificação, e só então o botão de
ligar o motor funciona. É esse **botão de ligar o painel que faz de "armar"**: com o painel
desligado, os nossos comandos não fazem nada. **Sem botões físicos na roda** (decisão do Ivo: o
painel está a 2 m; o pedido é só para não largar o leme enquanto não há piloto). Consequência: para
ligar o motor da roda a meio de uma manobra, o painel tem de ter ficado ligado. O comando de ligar
segura o contacto até o motor pegar (lê as rotações) ou até cerca de 10 s, o que serve quer o botão
do painel seja de toque quer seja de manter carregado.

Fica fora das duas caixas desta fase até haver as fotos e o esquema.

**25/11 (pergunta do Ivo: por onde vai a ordem de ligar o motor dada no ecrã? Pela linha que se
escuta?).** Não. A linha de dados (pinos 2 e 5 da ficha do conta-rotações) só se escuta: a caixa 2
nunca escreve nela. A ordem vai pelos botões do painel, como já estava decidido: ecrã → portátil →
caixa 1 → rádio → caixa 2 → um relé em paralelo com o botão → caixa do motor. A linha de dados
serve no sentido contrário, para o sistema saber se o painel está ligado e se o motor já pegou. O
Ivo repetiu o pedido: no ecrã, um botão de carregar um bocadinho (toque demorado) para ligar e
desligar. O que isto muda nas caixas, quando se fizer: a caixa 2 passa a ter dois relés e a receber
ordens da caixa 1 (hoje só lê e reenvia). Continua a faltar: a foto da frente do painel, as costas
dos botões de perto e o esquema elétrico do motor.

**Onde aparece o botão (Ivo, 25/11): "um botão no tablet e no portátil, nos dispositivos que eu
tiver acesso".** O ecrã é uma página servida pelo portátil, por isso o botão aparece igual em todos
os aparelhos que a abrirem (portátil, tablet, telemóvel), sem instalar nada em cada um. Só comanda
quem tiver sessão iniciada com uma conta que possa escrever (`NAVEGACAO.md`, "Permissões"): uma
conta só de leitura vê o motor mas o botão não faz nada. Proposta do Claude para o "um botão": um
só, que muda de nome com o estado do motor ("Ligar motor" com ele parado, "Desligar motor" com ele
a trabalhar), de toque demorado, e que fica apagado quando o sistema não sabe o estado (painel
desligado ou sem dados): aí usa-se o painel. Por confirmar com o Ivo.

**Decidido pelo Ivo (25/11, 13:44): sem conta para o motor, e sem complicar.** No separador Motor
do ecrã: carregar uns segundos liga, carregar uns segundos desliga, em qualquer aparelho que abra o
ecrã, sem iniciar sessão ("esquece o acidental"). Isto substitui, para o motor, a parte da conta de
escrita do parágrafo acima: os comandos de ligar e desligar o motor ficam como exceção à regra das
permissões (`NAVEGACAO.md`, "Permissões"). Consequência dita ao Ivo: qualquer aparelho que esteja
na rede do barco consegue ligar e desligar o motor; a proteção passa a ser a palavra-passe da rede
e o botão ON do painel (com o painel desligado, o botão do ecrã não faz nada). Vale dentro da rede
do barco: o comando não fica aberto à Internet.

**Os botões, pelo manual da Volvo (25/11).** O Ivo não chega às costas dos botões: estão num
conjunto fechado. Não é preciso lá chegar. O manual de oficina do sistema elétrico deste motor
(Volvo Penta, Grupo 30, D1-13 B, D1-20 B, D1-30 B, D2-40 B, de 2007, p. 27, 33–34, 37 e 43;
[manualslib](https://www.manualslib.com/manual/2158057/Volvo-D1-13-B.html?page=35)) diz:

- O painel tem quatro botões (parar, ligar/desligar o sistema, reconhecer alarme/brilho,
  arranque/pré-aquecimento), que "funcionam como interruptores e fecham ao negativo da bateria".
- O painel vai à caixa do motor por uma **ficha própria de 6 pinos, separada da dos dados**:
  1 parar, 2 ligar/desligar, 3 alarme/brilho, 4 negativo da bateria, 5 arranque/pré-aquecimento,
  6 besouro. Com a linha de dados avariada, "o painel de botões funciona normalmente".
- Logo, **a ordem de ligar não vai pela linha de dados.** Um relé que una o fio do pino 5 ao do
  pino 4 faz de dedo no arranque; um que una o 1 ao 4 faz de dedo no parar. Os relés entram nos
  fios desse cabo, atrás do painel ou junto à caixa do motor, e não nos botões.
- ⚠️ **As duas fichas de 6 pinos (dados e botões) são iguais por fora.** O manual dá como causa
  possível de avaria estarem trocadas na caixa do motor. Antes de soldar seja o que for,
  identifica-se cada uma pelas medidas, com tudo desligado: na dos dados, 60 a 120 Ω entre o 2 e o
  5; na dos botões, sem leitura entre o 4 e cada um dos outros com os botões soltos, e continuidade
  ao carregar (4–5 arranque, 4–1 parar, 4–2 ligar/desligar, 4–3 alarme). A ficha fotografada a
  25/11 tem tudo da dos dados (alimentação em fio grosso vermelho e preto, dois amarelos e dois
  brancos, manga amarela, ligada ao conta-rotações), mas é a medida que fecha a questão. Ligar a
  caixa 2 à ficha dos botões por engano podia ser lido pela caixa do motor como um botão carregado.
- **Como o Ivo liga hoje (25/11):** ON; quando acaba o apito da verificação, START carregado até o
  motor pegar, e larga; para parar, STOP carregado uns segundos. Bate com o manual: o botão de
  arranque faz o pré-aquecimento (se a água estiver abaixo de 50 °C) e fecha o relé do motor de
  arranque, que está dentro da caixa do motor. Fica respondido o "toque ou manter": é manter, e o
  comando de ligar já estava desenhado para segurar o contacto até o motor pegar ou até 10 s.
- O manual diz que o interruptor de ponto-morto tem de estar fechado para o motor arrancar: por
  ver se o Arlequin o tem ligado. O sistema não vê a manete; sem esse interruptor, um arranque dado
  do ecrã com a manete engatada põe o barco a andar.
- **A caixa do motor, pela etiqueta dela (fotos do Ivo, 25/11, 15:09; foto marcada em
  `docs/caixas/caixa2-caixa-motor-etiqueta-e-fichas.jpg`).** A etiqueta tem a referência
  **21120710** e um desenho com o nome de cada ligação: uma ficha pequena ("Fuel level / Aux
  switch"), **"Panel"**, **"Multilink"**, "Engine interface" e três bornes de parafuso. São os
  nomes do manual, o que confirma que o manual é o desta caixa: "Panel" é a ficha dos botões e
  "Multilink" a dos dados. No desenho, a "Panel" fica entre a ficha pequena e a "Multilink". Na
  foto das fichas por baixo da caixa, o cabo de manga amarela leva os fios dos dados (vermelho
  grosso, amarelos e brancos, os mesmos da ficha do conta-rotações). A ficha dos botões não se
  consegue apontar com certeza nessa foto; o Ivo identificou o cabo no barco ("é o fio mais fino").
- **O que é a 21120710, pelo catálogo oficial** (volvopenta.com/shop, secção "Sistema Elétrico EVC
  D1-D2", [referência 54157915](https://www.volvopenta.com/shop/0/part-sections/54157915), lido a
  25/11): é a "unidade de comando", e a Volvo foi-a substituindo por versões novas, por esta ordem:
  21120710 → 21261871 → 21511215 → 21558939 → 22594274. A do Arlequin é das primeiras. Fica só o
  registo, para o dia em que a referência for precisa.
- **Onde entram os relés, a avaliar quando se achar a ficha dos botões (proposta do Claude):** em
  vez de cortar o cabo dos botões, um "T" feito com um par de fichas iguais às da Volvo (uma macho
  e uma fêmea de 6 pinos), metido entre a ficha dos botões e a tomada dela (a mesma ideia do "cabo
  em Y" que o `NAVEGACAO.md` já tinha para os dados). Não se corta nada do motor e tira-se em
  segundos se alguma coisa correr mal. Depende de onde está essa ficha: se só
  existir na caixa do motor, ou os relés ficam junto ao motor ou leva-se um cabo de três fios até
  ao painel.
- A ficha pequena da caixa do motor ("Fuel level / Aux switch") é a entrada do nível do gasóleo e
  de um interruptor extra. O manual fala de um interruptor de ponto-morto e a legenda do esquema de
  um "interruptor auxiliar" (n.º 11), sem dizer se são o mesmo: por ver no barco o que está ligado
  a essa ficha.
- **Falta:** seguir o cabo dos botões até à ficha dele e fotografá-la do lado dos fios; o teste dos
  botões do manual (sem leitura entre o negativo e cada botão solto, continuidade ao carregar); as
  duas medidas na ficha dos dados (entre o 2 e o 5 e entre o 1 e o 3).

**Ideia do Ivo (25/11, 16:26): tirar os fios das ordens lá em cima, com a caixa 2 logo por baixo.**
Em vez de ir à ficha, abrir a capa do cabo dos botões junto ao conjunto dos botões ("é fácil") e
tirar daí os fios das ordens; a caixa 2 fica mesmo por baixo, onde há espaço (ele já viu), e
desenha-se para esse sítio. Parecer do Claude: o sítio é bom. É o mesmo da derivação dos dados (a
ficha do conta-rotações fica a um palmo), é seco e chega-se lá bem, e assim uma só caixa escuta os
dados e, mais tarde, dá as ordens. Condições:

- Abre-se a capa de fora sem ferir os fios de dentro, e só se mexe em três (arranque, parar e
  negativo): uma derivação soldada a cada um, sem os cortar. Os outros três ficam como estão.
- Antes de descarnar qualquer fio de dentro sabe-se que fio é qual. Uma derivação no fio errado
  pode ser lida pela caixa do motor como um botão carregado.
- Painel desligado e corta-corrente da bateria desligado enquanto se mexe.
- **As cores desses fios não se sabem** (pergunta do Ivo). O manual dá o que faz cada pino pelo
  número, não pela cor; o desenho do esquema elétrico (p. 42,
  [página 44 no manualslib](https://www.manualslib.com/manual/2158057/Volvo-D1-13-B.html?page=44),
  visto a 25/11) só mostra o lado do motor e não traz o cabo dos botões; uma pesquisa a 25/11 não
  achou nenhuma tabela de cores. Leem-se no barco: a ficha desse cabo (na caixa do motor, se lá em
  cima não houver nenhuma) fotografada do lado dos fios, como se fez à dos dados. O número de cada
  buraco dá a função pelo manual, e a cor fica conhecida; confirma-se com o teste do manual nessa
  ficha desligada.
- **As cores, lidas pelo Ivo na ficha do lado do motor (25/11, 20:14; por foto ainda não):**

  | Buraco | Fio | O que faz (pelo manual) | Derivação para os relés |
  |---|---|---|---|
  | 1 | roxo ("roxo ou lilás, mas acho que é roxo") | parar (STOP) | **sim** |
  | 2 | vermelho | ligar/desligar o painel | não |
  | 3 | branco | calar o alarme / brilho | não |
  | 4 | preto | negativo da bateria | **sim** |
  | 5 | amarelo | arranque e pré-aquecimento (START) | **sim** |
  | 6 | sem fio, com tampão | o manual põe aqui o besouro | não |

  O preto no 4 bate com o manual (o 4 é o negativo), o que dá confiança de que os números lidos
  na ficha são os do manual. O roxo no parar também é o que o Claude se lembra de ver nos esquemas
  dos Volvo Penta mais antigos (de memória, sem fonte lida a 25/11: não conta como prova). São
  cinco fios, e não seis. Na foto das fichas de 25/11 (15:09), a ficha
  com o fio roxo e o tampão branco é então esta, a dos botões. **Continua a valer a prova antes de
  soldar:** com a ficha desligada e tudo sem corrente, o multímetro em continuidade entre o preto
  (4) e o amarelo (5) só apita com o START carregado, e entre o preto (4) e o roxo (1) só com o
  STOP carregado. Para ligar e desligar do ecrã são precisos três fios: amarelo, roxo e preto.
- **A caixa 2 desenha-se para esse sítio**, já com lugar para os dois relés, mesmo que eles só
  entrem depois. Faltam as medidas do espaço (largura, altura e fundo) e onde se pode prender.

## Decisões de 20/11

- Sistema completo no portátil, e não só um gravador (Ivo).
- O motor entra desde o primeiro dia (Ivo).
- Proa e adornamento pelo BNO085; a bússola do piloto velho fica de fora (Ivo).
- O log lê-se diretamente da roda; não se compra outro mostrador (Ivo).
- O ecrã das placas não fica à vista; caixas seladas; compras com entrega rápida (Ivo).
- O Fold faz a rede e mantém os dados móveis (Ivo).
- Caixa 2 por rádio até à caixa 1, e caixa 1 por USB, para não depender do telemóvel (Claude).
- Calibrações no portátil, valores em bruto gravados (Claude).

## Decisões de 21/11

- A caixa negra grava também o sobe e desce do barco na onda (Ivo).
- Grava-se o movimento completo em bruto (aceleração, rotação e inclinação), 10 vezes por segundo,
  com a média feita na caixa; a conta da altura e do período fica para depois (Claude).

## Decisões de 22/11

- A maneira de ligar o sensor à placa escolhe-se pelo ensaio de bancada. Se a de 4 fios falhar ao
  ritmo do desenho, fica a de 10 fios, mesmo dando mais trabalho a montar (Claude).
- Os dados do motor vão buscar-se primeiro por trás do painel; o chicote junto ao motor fica como
  alternativa (Ivo).
- O VHF não se liga ao sistema: tem GPS próprio (Ivo).
- **O que conta agora é o portátil (Ivo).** O Raspberry Pi, a MacArthur, o disco e a alimentação do
  computador definitivo ficam em espera até o piloto automático chegar; nada disso se compra nem se
  desenha entretanto. O que já se apurou fica anotado no `NAVEGACAO.md`, §4.
