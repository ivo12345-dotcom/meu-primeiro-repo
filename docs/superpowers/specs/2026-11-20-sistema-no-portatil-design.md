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
- **sem parafusos (ideia do Ivo):** a base da caixa leva furos nas posições dos furos de cada
  placa; a placa pousa em cima e quatro estacas impressas, com cabeça, atravessam os furos da placa
  e entram à pressão nos furos da base. Nada de metal dentro da caixa. As estacas imprimem-se
  deitadas, para não partirem pelas camadas, e a base leva um ressalto à volta de cada furo para os
  pinos de baixo da placa não tocarem no fundo. O aperto afina-se com uma peça de ensaio;
- fita isoladora líquida só nos fios, nas soldaduras e nas fichas, para não se soltarem com a
  vibração; as placas têm de poder sair. Testar primeiro num resto do mesmo plástico, porque o
  solvente pode atacá-lo;
- caixa em PETG ou ASA (o PLA amolece com o calor do verão);
- a 20–30 cm, pelo menos, da bússola do piloto velho.

**Base da caixa 1 (desenhada a 22/11, a pedido do Ivo; por imprimir).** Gera-se com
`software/ferramentas/caixas/caixa1_base.py`; os ficheiros para imprimir e as imagens estão em
`docs/caixas/`.

- Base de 280 × 52 mm (76 mm nas orelhas), com o fundo de 3 mm e um rebordo de 5 mm onde vai
  encaixar a tampa.
- O sensor fica numa ponta, a 6 mm do fundo. O ESP32 fica 15 cm adiante, levantado 24 mm e com o
  lado das peças para cima: os nomes dos pinos, os botões e a ficha USB ficam à vista, e os fios
  encaixam nos pinos por baixo. Cada parede de apoio tem um túnel para os fios passarem.
- Cada placa pousa em quatro apoios com o furo fendido: o furo abre um nada quando a estaca entra
  e aperta-a. As estacas imprimem-se deitadas. Têm uma aba que segura a placa pelo bordo de fora e
  um dente que desce por fora da placa e não as deixa rodar. Cabeça redonda não dava: no ESP32 há
  peças encostadas aos furos (os botões e o módulo).
- Um apoio com rasgo para prender o cabo USB com uma abraçadeira de plástico, para a ficha não
  trabalhar na tomada com o balanço.
- Quatro orelhas com furo de 4,3 mm para fixar a caixa com parafusos de latão ou de nylon; a tampa
  prende pelos mesmos parafusos.
- Uma seta em relevo com a palavra PROA. Diz só para que lado a caixa aponta; o sítio da caixa não
  muda, é o cubículo da cabine de popa. A seta aponta para a ponta dos cabos, para o sensor ficar
  do lado da popa, mais longe do motor. Se no cubículo a caixa tiver de ficar virada de outra
  maneira, monta-se como couber e acerta-se no programa. (A primeira versão dizia "eixo do barco" e
  o Ivo leu, com razão, que a caixa ia para o meio do barco; corrigido a 22/11.)
- Marcas nas pontas e nos lados (o sítio do sensor), para as medidas do ponto em aberto 11.
- Peça de ensaio (`caixa1-ensaio.stl`): os oito apoios nas posições certas, numa armação fina, com
  as suas oito estacas. Imprime-se primeiro, para confirmar com as placas verdadeiras a distância
  entre furos e o aperto das estacas.

Verificado no modelo: nada bate em nada (as duas placas, os pinos, as 30 fichas dos fios, os botões,
o módulo e a ficha do cabo USB), e o programa diz com quantos centímetros se corta cada fio do sensor (19 a 22 cm). Por confirmar: as medidas da placa ESP32, que vieram da fotografia do anúncio com o passo
dos pinos a servir de régua (erro de cerca de 0,2 mm); e o espaço no cubículo (fechada, a caixa fica com cerca de
280 × 76 × 40 mm). Fica para depois: a tampa, as saídas dos cabos e o sítio do pequeno circuito do
log e do vento (há 12 cm livres entre o sensor e o ESP32).

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
tudo o resto, sem alterações ao plugin dela. Medido com o gravador verdadeiro da caixa negra
(`lib/bruto.js`): cerca de 0,8 MB por hora, ou 0,25 GB em 300 horas de navegação. A tabela de 10 em
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
| Comparador para o sinal da roda do log | Caixa 1 | Depois de medir o sinal da roda |
| Adaptação de nível e ficha para a tomada do vento | Caixa 1 | Depois da foto das costas do mostrador |
| Cabo USB com o comprimento caixa 1 → portátil, e cabo USB do B330 | Ligações | Depois de medir no barco |
| Caixas de plástico (impressas), bucins, fio | As duas caixas | Na montagem |

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
5. **O B330 por USB**: confirmar que entrega os dados por esse cabo.
6. **O VHF: resolvido (Ivo, 22/11).** Tem GPS próprio, já ligado. Não se liga ao sistema.
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
