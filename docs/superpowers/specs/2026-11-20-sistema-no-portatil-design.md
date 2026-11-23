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
  amarelos, um branco, um preto e um vermelho, mas ainda não que fio entra em cada número da ficha:
  **falta uma foto parada e de perto, do lado onde os fios entram.**
- A outra ficha do conta-rotações, pequena, de 3 fios (vermelho, azul, amarelo), é a saída para os
  mostradores extra da Volvo. O mostrador branco pequeno ligado a ela (ficha vermelha, do lado
  esquerdo visto por trás) é o do **nível do combustível** (Ivo, 23/11). **Pista a confirmar na
  primeira escuta:** se o nível aparece num mostrador da Volvo alimentado pelo conta-rotações, é
  provável que o valor também vá no cabo de dados, e nesse caso a caixa 2 lê-o sem sonda nossa. (O
  `NAVEGACAO.md` §2b dava o nível do gasóleo como fora da caixa do motor, por se julgar que o medidor
  era só analógico.)
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
- As etiquetas dos fios são de dois tipos (Ivo, 23/11): umas têm números (referências), outras têm
  a descrição escrita à mão.
- O Ivo tem um vídeo das costas do painel inteiro, que não cabe no envio pelo telemóvel (limite de
  30 MB): passa-se para o portátil e tiram-se de lá as imagens.
- Faltam: a frente do painel inteiro (não está nas notas nem nas fotos guardadas), uma vista de
  mais longe das costas (espaço e folga do cabo) e os números da etiqueta branca e da manga vermelha
  do cabo de dados.

- Um módulo transcetor CAN de 3,3 V liga a derivação à placa, **só em escuta** (a placa nunca
  escreve no barramento do motor).
- Alimentação pelos 12 V do barco, com fusível e um conversor 12 → 5 V.
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
| Comparador para o sinal da roda do log, **com histerese** (para não oscilar quando o sinal está no limiar) e uma **resistência de 1 kΩ em série** entre a saída dele e o pino da placa | Caixa 1 | Depois de medir o sinal da roda |
| Adaptação de nível e ficha para a tomada do vento, com uma **resistência de 1 kΩ em série** entre a saída e o pino da placa | Caixa 1 | Depois da foto das costas do mostrador |
| Cabo USB com o comprimento caixa 1 → portátil, e cabo USB do B330 | Ligações | Depois de medir no barco |
| Caixas de plástico (impressas), bucins, fio | As duas caixas | Na montagem |

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
2. **Sinal da roda do log** (medir com o multímetro): escolhe o comparador.
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
