# As duas caixas (o programa das placas ESP32)

O que corre dentro das duas placas ELEGOO "ESP32 DEVKIT V1 TYPEC" do Arlequin. O desenho está em
`docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md` e o plano em
`docs/superpowers/plans/2026-11-23-sistema-no-portatil-parte2-caixas.md`.

| Caixa | Onde | O que faz |
|---|---|---|
| **1, instrumentos** (`caixa1/`) | cubículo da bússola do piloto velho, cabine de popa | Lê a roda do log, a frase do mostrador do vento e o sensor de movimento, recebe pelo rádio o que a caixa 2 manda, e passa tudo ao portátil pelo cabo USB, em linhas de texto |
| **2, motor** (`caixa2/`) | junto à derivação do barramento do motor | Escuta o barramento do motor (J1939), **só em escuta**, e reenvia cada trama à caixa 1 pelo rádio das placas. Não há fio entre o motor e o portátil |

As caixas não fazem contas nem guardam calibrações: mandam o que leem, em bruto. As contas são do
portátil (`software/signalk-arlequin-caixas`). O que as duas têm em comum (as linhas com soma, os
comandos, os pacotes do rádio) está em `comum/`.

## Estado (28/11/2026)

| Parte | Estado |
|---|---|
| Caixa 1: sinal de vida, reinício automático, roda do log, vento, movimento a fingir | feito e ensaiado na placa |
| Caixa 1: rádio | feito; a placa passa os ensaios dela com o rádio ligado |
| Caixa 2: escuta do motor, rádio, motor a fingir | feito e ensaiado com as duas placas ligadas (a escuta do motor verdadeiro só no barco). Desde a 0.3.0, se o rádio não ligar ou perder o destino, volta a tentar sozinho (ver "O rádio da caixa 2 volta a tentar") |
| Caixa 2: escuta pelo fio, na bancada, com os módulos do barramento | **passou a 26/11**: 6145 tramas saídas, 6145 ouvidas, nenhum erro (rajadas de 1000 a 200 e a 1000 por segundo, e 10 s à cadência do motor). Desfeita a montagem, os ensaios das duas placas passaram todos (40 em 40, `npm test`) |
| Escuta do motor no barco (`ensaio/ouvir-motor.js`) | escrita e experimentada em casa a 26/11 com o motor a fingir; **a primeira escuta do motor verdadeiro está por fazer** |
| Revisão independente do programa (23/11) | feita; os cinco pontos importantes estão corrigidos na versão **0.2.1**, e os seis pontos que tinham ficado adiados na versão **0.3.0** (28/11). A 0.3.0 traz também o sensor de movimento, a regra da ponte USB e os comandos de bancada novos (`roda`, `surto`, `avaria`) |
| Revisão final, com olhos novos (28/11) | feita: nenhum ponto crítico e cinco importantes. Quatro estão corrigidos na versão **0.3.1**, que é a que as duas placas têm gravada: o ensaio de resistência já não dá por limpa uma noite com o sensor calado; "calado" passou a ser faltar qualquer das três leituras; o caminho do sensor que não volta tem ensaio na placa (`avaria,3,35`); e o rádio da caixa 1 volta a tentar sozinho. O quinto (a roda do log poder contar a dobrar com a descida lenta) só se prova com a plaquinha soldada: `ensaio/roda-por-fora.js` |
| Sensor de movimento verdadeiro (BNO085) | **a medir desde 27/11**, com o sensor novo, pela ligação de 10 ligações (ver "O sensor de movimento"). Ensaios de resistência só com a caixa 1: 3 horas a 27/11 e 6 horas na noite de 28/11, os dois limpos. Falta o ensaio final de 3 horas com as duas caixas e a 0.3.1, e duas provas à mão: a da bússola (rodar o sensor devagar em todos os sentidos; a confiança tem de subir; é também a confirmação independente do lado da proa) e, se se quiser, a de tirar o fio CS com a caixa ligada (o mesmo caminho já tem ensaio sem mexer em fios: `avaria,3,35`) |
| Entrada do vento | **plaquinha do optoacoplador montada e ensaiada em casa a 27/11: passa** (três fases de 20 s, nenhuma frase estragada). Falta o cabo no barco e a prova com o mostrador verdadeiro |
| Entrada do log | a roda é um contacto que abre uma vez por volta (medido a 27/11): dispensa o comparador. Ligação por montar, na plaquinha do vento (ver "A fila dos 3,3 V e da massa"): 3,3 V, 1 kΩ, roda; do outro fio da roda, 10 kΩ e 100 nF à massa e 1 kΩ em série até ao D27 |

## Os pinos

| Caixa 1 | Pino | Nota |
|---|---|---|
| Sensor: relógio (SCL do sensor) | D22 | os oito fios estão marcados em `docs/caixas/sensor-novo-oito-fios.jpg` (lado do sensor) e `sensor-novo-oito-fios-placa.jpg` (lado da placa) |
| Sensor: dados do sensor para a placa (SDA) | D21 | |
| Sensor: dados da placa para o sensor (DI) | D23 | |
| Sensor: a placa escolhe o sensor (CS) | D5 | |
| Sensor: aviso (INT) e recomeço (RST) | D19, D18 | o RST só se puxa para baixo |
| Roda do log | D27 | entrada; duas subidas a menos de 4 ms contam como uma; no máximo uma interrupção por volta do ciclo |
| Vento | RX2 (D16) | 4 800 baud, só leitura; as mudanças de nível contam-se com limite por volta do ciclo |
| Luz | D2 | acesa com tudo a sair; apaga-se um instante quando a caixa deita uma linha fora |

| Caixa 2 | Pino | Nota |
|---|---|---|
| Motor: leitura (CRX do módulo) | D4 | o único fio de dados entre o módulo e a placa |
| Motor: escrita | D25, **sem fio** | o chip exige um pino; não se liga a nada. O CTX do módulo fica preso aos 3,3 V |
| Luz | D2 | acesa enquanto a caixa 1 estiver a ouvir |

## Compilar e gravar

Precisa do arduino-cli com o núcleo `esp32:esp32` (versão 3.3.12). Na pasta `software/caixas`:

```powershell
npm run gravar:1 -- COM3
```

```powershell
npm run gravar:2 -- COM5
```

- `COM3` e `COM5` são as portas que o Windows der a cada placa.
- A primeira vez de cada caixa demora uns minutos; depois, menos de um.
- **Antes de gravar, confirmar que a placa é uma das ELEGOO novas.** Há outras placas ESP32 de outros
  projetos em casa, e gravar apaga o programa que lá estiver.
- Gravar reinicia a placa mas não lhe corta a corrente.
- No barco: regravar uma placa só com o barco parado.

## Ensaiar com as placas ligadas

Os ensaios correm nas placas verdadeiras, ligadas ao portátil por USB, e cada linha que elas mandam é
lida pelo mesmo leitor que as vai ler no barco. Sem placa ligada saltam-se e dizem porquê.

```powershell
$env:ARLEQUIN_CAIXA1 = 'COM3'; npm test
```

Com as duas (a segunda só precisa do cabo para ter corrente e receber comandos):

```powershell
$env:ARLEQUIN_CAIXA1 = 'COM3'; $env:ARLEQUIN_CAIXA2 = 'COM5'; npm test
```

O que fica provado: o sinal de vida de segundo a segundo; que abrir e fechar a porta não reinicia a
caixa; que lixo e comandos sem soma não fazem nada; que uma caixa presa recomeça sozinha em 5 s; a
contagem e o período do log; o vento tal e qual, e que lixo na entrada do vento nunca dá uma frase; o
movimento a 10 linhas por segundo; que a caixa diz que finge antes de sair a primeira linha a fingir;
que uma avalanche de sinais numa entrada (1 MHz no pino do log ou no do vento) não a para nem a faz
recomeçar, e que, se recomeçar a meio dela, volta a arrancar; a conta dos pacotes perdidos no rádio,
caso a caso (a volta do número de ordem, repetidos, atrasados e recomeços da caixa 2); a conta de há
quanto tempo chegou o sinal da outra caixa, também caso a caso (o sinal que chega a meio de uma volta do
ciclo, e o relógio da placa a dar a volta); que uma enxurrada de ordens do portátil (3000 por segundo,
3 s) não lhe atrasa o batimento nem a faz deitar fora uma linha; que a ponte USB não retém nenhuma
linha; e, com as duas, o motor pelo rádio, o que acontece quando a caixa 2 recomeça ou se cala, e que
ela repõe o rádio sozinha quando ele vai abaixo ou perde o destino.

Os ensaios `contador.test.js` e `placa.test.js` não precisam de placas: correm sempre.

Para o caminho inteiro, até ao ecrã e à gravação, há o ensaio do `software/bordo` com a placa
verdadeira (`npm run caixa-a-fingir` numa janela, para o GPS a fingir, e `npm run ensaio-placa` noutra).
Escreve só nas pastas do ensaio e sai tudo marcado como simulado.

## Ensaio de resistência

Fica a ouvir a caixa 1 o tempo que se pedir e conta o que correu mal no caminho até ao portátil. De
minuto a minuto diz como vai; no fim escreve `LIMPO` ou `COM FALHAS` (com a lista delas).

```powershell
node ensaio/resistencia.js COM3 60 --caixa2 COM5 --registo C:\caminho\registo.log
```

| Opção | Para quê |
|---|---|
| (nenhuma) | Liga os sinais a fingir da caixa 1 (log, vento, movimento). **Só na bancada** |
| `--caixa2 COM5` | Liga também o motor a fingir da caixa 2 e exige o sinal dela pelo rádio |
| `--duas` | Exige o sinal da caixa 2, sem lhe mexer |
| `--motor` | Exige tramas do motor, e que cheguem até ao fim. Com `--sem-geradores`, o motor a fingir liga-se antes, à mão (`motor,2100` na porta da caixa 2) |
| `--sem-geradores` | Não liga sinal a fingir nenhum: ouve o que a caixa tiver de verdade. **É a única maneira de o correr no barco** |
| `--registo <ficheiro>` | Guarda também o que escreve |

Conta como falha: linhas que o portátil não lê; leituras de movimento em falta; segundos sem sinal de
vida (os que o relógio da caixa mostra e, pelo relógio do portátil, o silêncio que estiver a decorrer);
a caixa que recomeça; linhas que a caixa diz que não conseguiu mandar; a porta que se perde (acaba
logo); e, com a caixa 2, o silêncio dela, os recomeços e os pacotes perdidos no rádio. As cópias que a
ponte USB repete só se mostram: são linhas boas.

**O sensor de movimento calado também conta** (desde a revisão de 28/11; antes, um sensor que se
calasse a meio e não voltasse saía `LIMPO`, porque o número de ordem das linhas não avança enquanto
ele está calado). O ensaio conta o tempo sem linhas de movimento pelo relógio do portátil e mostra-o.
Falha se acabar com o sensor sem medir (o estado dele no batimento) ou com um silêncio a decorrer; um
silêncio que se resolveu sozinho passa, com os segundos à vista, como pede a regra 9 do desenho. No
princípio e no fim pergunta à caixa os contadores do sensor (comando `sensor`, que só lê) e diz o que
mudou: um sensor que recomeça sozinho e volta logo não se vê de outra maneira.

O ensaio final, com o sensor verdadeiro, a caixa 2 e as tramas do motor a chegar (o motor a fingir
liga-se antes, com `motor,2100` na porta da caixa 2):
`node ensaio/resistencia.js COM3 180 --sem-geradores --duas --motor`

Mostra também o maior intervalo entre duas linhas seguidas, a que altura do ensaio foi ("aos 12 min
05 s"), e quantos intervalos passaram dos 250 ms (com o sensor a medir chega uma linha de 100 em 100 ms).
Não contam como falha: são linhas que chegaram, mas tarde.

## Ensaio da escuta pelo fio (só na bancada)

O motor a fingir da caixa 2 nasce dentro dela, e por isso não passa pelo módulo do barramento nem
pelo pino D4. Para ensaiar esse bocado em casa, outra placa faz de motor num par de fios:

- **A placa da caixa 1, emprestada**, leva o programa `software/ferramentas/bancada/motor_no_fio` e o
  módulo B (o que fica com a resistência R2, de 120 Ω): 3V3 ao 3V3, GND ao GND, CTX ao TX2, CRX ao RX2.
- **A caixa 2** fica com o programa dela e o módulo A (sem a R2): 3V3 ao 3V3, GND ao GND, CRX ao D4,
  CTX preso ao 3V3 do próprio módulo.
- CANH com CANH e CANL com CANL, entre os dois módulos. As duas placas no USB do portátil.

```powershell
node ensaio/escuta-fio.js COM3 COM5
```

`COM3` é a placa que faz de motor e `COM5` a caixa 2. Saem rajadas de 1000 tramas e dez segundos à
cadência do motor, e compara-se o que saiu com o que a caixa 2 diz que ouviu (`estado`,
`motor-tramas`). No fim escreve `LIMPO` ou `COM FALHAS`.

As ligações estão marcadas em `docs/caixas/bancada-ensaio-fio-ligacoes.jpg`. Quatro avisos de 26/11:

- **Os números das portas trocam** quando se desligam e voltam a ligar os cabos USB. Para saber qual é
  qual ouve-se cada porta sem escrever nada: a caixa 2 diz quem é no batimento (`$AQB,2,...`) e a placa
  com o programa de bancada fica calada.
- **À placa com o programa de bancada não se mandam comandos `$AQC`.** Ela lê letra a letra, e as letras
  `a`, `n` e `r` de um comando punham-na a mandar tramas.
- **Se a caixa 2 contar zero sem erros**, veja-se primeiro se CANH e CANL estão ligados entre os dois
  módulos (e não trocados): foi o que faltou à primeira.
- Antes de correr os ensaios da caixa 1 tira-se o fio do RX2: o vento a fingir escreve nesse pino, e o
  módulo também.

O programa de bancada compila-se e grava-se na pasta `software/ferramentas/bancada`:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 --build-path $env:TEMP\arlequin-caixas\motor_no_fio motor_no_fio
```

```powershell
arduino-cli upload --fqbn esp32:esp32:esp32doit-devkit-v1 --input-dir $env:TEMP\arlequin-caixas\motor_no_fio -p COM3 motor_no_fio
```

No fim, a placa da caixa 1 volta a levar o programa dela (`npm run gravar:1 -- COM3`) e correm-se os
ensaios das duas.

> **A placa que faz de motor escreve na linha. Nunca se liga à linha do motor do barco.**

## Escuta do motor no barco

Mostra no portátil o que a caixa 2 ouve na linha do motor. As tramas chegam pelo caminho de sempre
(caixa 2, rádio, caixa 1, USB), por isso a porta é a da caixa 1:

```powershell
node ensaio/ouvir-motor.js COM5 300 --registo escuta.txt
```

De 5 em 5 segundos diz o sinal da caixa 2, quantas tramas chegaram e os valores que já sabemos ler
(rotações, água, tensão, horas). No fim escreve uma linha por tipo de trama e por aparelho, com os
últimos bytes, incluindo os tipos que ainda não conhecemos. Com `--registo` guarda todas as linhas tal
como chegam. O tempo é em segundos (60 se não se disser; 0 fica até se carregar em Ctrl+C).

**Não manda nada a nenhuma caixa: só ouve.** Pode correr com o motor a trabalhar. O ecrã do barco não
pode estar a usar a mesma porta ao mesmo tempo. As contas estão em `ensaio/censo.js`, com ensaios sem
placas (`ensaio/censo.test.js`). Experimentado a 26/11 com o motor a fingir da caixa 2: 14 tramas por
segundo, cinco tipos, 2100 rotações, 82 °C, 14,2 V.

## Sinais a fingir (comandos de ensaio)

Cada caixa traz geradores de bancada: sinais feitos por ela própria, que entram pelo caminho
verdadeiro. Só se ligam por um comando com a soma certa (`$AQC,<comando>[,<valores>]*HH`), nunca ficam
gravados (um recomeço desliga-os todos), e enquanto houver algum ligado a caixa diz no batimento que
finge: o portátil marca tudo como simulado e a AI não aprende com isso. A caixa di-lo logo no instante
em que passa a fingir, antes da primeira linha a fingir, e o portátil mantém a marca mais 7 s depois de
ela deixar de o dizer, enquanto os últimos valores a fingir ainda valem.

> **Só na bancada, com os fios do log e do vento soltos.** Os geradores do log, do vento e da avalanche
> fazem a caixa **escrever nos próprios pinos de entrada**. Com a roda do log (o comparador) ou o
> mostrador do vento ligados, ficam dois a mandar no mesmo fio. Por isso: no barco não se correm os
> ensaios com geradores (`npm test` usa-os sempre; o de resistência só com `--sem-geradores`). A
> entrada do log leva uma **resistência de 1 kΩ em série**, na plaquinha, que torna o engano
> inofensivo: sem ela o pino, feito saída, carregava e descarregava diretamente o condensador de
> 100 nF da roda. A entrada do vento não a leva (o RX2 liga ao coletor do optoacoplador): aí quem
> limita a corrente é o próprio optoacoplador, a poucos mA na bancada; no barco, com o mostrador a
> mandar, podia chegar a dezenas de mA durante os bits de uma frase. O movimento e o motor a fingir
> não mexem em pinos.

**As ordens têm conta e medida.** Cada caixa lê no máximo 96 bytes de ordens em cada volta do ciclo e,
depois de obedecer a uma, só volta a ler passados 10 ms: no máximo 100 respostas por segundo. Ordens
mandadas de seguida (até uma dúzia) esperam na memória da porta e são todas obedecidas, uma de cada vez.
Uma enxurrada (um programa avariado, ou outro programa na porta errada) perde-se quase toda, e a caixa
continua a dar o batimento e as medições sem falhar uma linha.

| Comando | Caixa | O que faz |
|---|---|---|
| `log,<Hz>` | 1 | Impulsos da roda a fingir (0 para; 26 dá 5,2 nós) |
| `roda,<voltas por segundo>[,<% aberta>]` | 1 | A roda **por fora**: o pino D26 faz de roda (em cima enquanto estaria fechada, solto enquanto estaria aberta; 15 % da volta aberta, por omissão). Só chega ao pino do log com um fio do D26 à plaquinha (ver "Ensaio da entrada da roda do log"). `roda,0` para e responde com as voltas que deu |
| `vento,<décimos de grau>,<décimos de nó>[,<0\|1>[,<0\|1>]]` | 1 | Uma frase de vento por segundo (`0,0` para; `-1,0` manda lixo, para ensaiar a entrada). O terceiro valor a 1 junta uma segunda frase, que não é o MWV. O quarto valor a 1 manda a frase **por fora**: só pelo pino TX2 e ao contrário, como o mostrador a manda (ver "Ensaio da plaquinha do vento") |
| `movimento,<0\|1>` | 1 | 100 leituras por segundo com 12° de adornamento e a proa a 245° |
| `surto,<bytes>,<pausa em µs>,<bytes>,<calado em ms>` | 1 | Linhas com um número certo de bytes, para pôr à prova a ponte USB (ver "A ponte USB e as linhas de 64 bytes"): sossega o fio, escreve uma linha `$AQR,x,...` com os primeiros bytes e, se os segundos não forem 0, outra depois da pausa; fica calada e só então responde. Não põe a caixa a fingir |
| `avalanche,<1\|2>,<kHz>` | 1 | Uma onda rápida no pino do log (1) ou do vento (2), para ensaiar que um fio no ar ou um comparador a oscilar não param a caixa (0 para; 2000 no máximo) |
| `motor,<rpm>` | 2 | Tramas do motor a fingir (0 para) |
| `avaria,<qual>[,<valor>]` | as duas | Uma avaria feita de propósito, para ensaiar que a caixa dá por ela e a resolve sozinha. Não põe a caixa a fingir. **Rádio:** `avaria,1` deita o rádio abaixo, como se não tivesse ligado ao arrancar (nas duas caixas); `avaria,2` tira à caixa 2 o destino, como se o registo da caixa 1 tivesse falhado. **Sensor (caixa 1):** `avaria,3,<segundos>` deixa-o mudo esse tempo (1 a 120 s), com o RST preso em baixo, como se lhe faltasse um fio; `avaria,4,<1\|2\|3>` manda-o deixar de enviar uma das três leituras (a aceleração, a rotação ou a atitude) |
| `radio` | 1 | O estado do rádio da caixa 1: `ligado`, `religado` (vezes que teve de ser ligado outra vez), a fila cheia e os pacotes perdidos |
| `parar` | as duas | Desliga todos os geradores |
| `estado` | as duas | Os contadores da caixa (o que entrou em cada entrada, o que se perdeu) |
| `sensor` | 1 | O estado e os contadores do sensor: `estado` (0 a medir, 1 a arrancar, 2 calado, 3 não volta), `fase` (até onde chegou o último arranque; 7 é a medir), `toques` no RST, vezes que recomeçou sozinho, leituras deitadas fora ou ilegíveis, gravações das calibrações |
| `leituras` | 1 | Quantas leituras de cada espécie chegaram do sensor desde o arranque da placa, e o nível do INT |
| `rst` | 1 | Um toque no RST do sensor, para ensaiar que a caixa o volta a pôr a medir sozinha |
| `guardar` | 1 | **De uso, com o barco parado:** o sensor grava as calibrações dele (a gravação automática está desligada). Responde `sem-sensor` se ele não estiver a medir |
| `prender` | as duas | Prende a caixa de propósito, para ensaiar o reinício automático |
| `perdidos,<até 4 valores>` | 1 | Põe à prova a conta dos pacotes perdidos no rádio, com números de ordem dados à mão: 0 a 65535 é um pacote que chega, -1 começa uma conta nova, -2 é a caixa 2 a recomeçar. Responde com o total de perdidos (ou `fora-dos-limites`, sem contar nada). Não é um gerador: a caixa não passa a fingir, e a conta do rádio verdadeiro é outra e não mexe |
| `recente,<agora>,<quando>,<prazo>` | as duas | Põe à prova a conta "há quanto tempo chegou o sinal da outra caixa" (a que diz à caixa 2 se a caixa 1 a está a ouvir), com horas dadas à mão, em milissegundos; as negativas são as do fim da volta do relógio da placa. Responde `1` (foi há `prazo` ou menos) ou `0`; `fora-dos-limites` se o prazo não estiver entre 0 e 60000. Também não é um gerador |

## O sensor de movimento

É o Adafruit BNO085 (ref. 4754), pela ligação de 10 ligações (SPI) e com a biblioteca do fabricante
(Adafruit BNO08x 1.2.7). Oito fios e duas gotas de solda nas costas do sensor (pontes PS0 e PS1):

| Sensor | Placa | | Sensor | Placa |
|---|---|---|---|---|
| VIN | 3V3 | | INT | D19 |
| GND | GND | | RST | D18 |
| SCL | D22 | | DI | D23 |
| SDA | D21 | | CS | D5 |

Quem fala com o sensor é uma tarefa à parte (`caixa1/sensor.h`), que só entrega leituras numa fila: o
ciclo principal nunca espera por ele, e é só o ciclo principal que escreve na porta USB. Três coisas
que a placa ensinou a 27/11 e que mandam no programa:

- **Com o P0 do sensor preso aos 3 V, a placa só lhe consegue escrever enquanto ele está a avisar**
  (o INT em baixo). A biblioteca, se escrever sem o aviso, fica à espera dele para sempre. Por isso
  nunca se lhe pede para escrever sem o aviso já lá estar.
- **A ordem que funciona ao arrancar:** um toque no RST; abrir a conversa e ler até ao "recomeço
  completo" (a prova de que o sensor está vivo); um segundo toque, o de acordar, que não se conta;
  ler a apresentação; pedir as três leituras; desligar a gravação periódica das calibrações.
- **Há pedidos da biblioteca que esperam pela resposta sem prazo.** Os do arranque e das leituras
  não são desses; o de gravar as calibrações (`guardar`) é. Se a tarefa do sensor ficar 4 s sem dar
  sinal, o ciclo principal recomeça a placa (o motivo do arranque no batimento passa a 3).

Sem leituras durante 500 ms o estado passa a 2 (calado): toque no RST e novo arranque, com as
tentativas espaçadas (1, 2, 5, 10 s e depois de 30 em 30 s). Ao fim de 5 seguidas sem leituras passa
a 3 (não volta) e continua a tentar de 30 em 30 s. O estado e os toques vão no batimento.

Os ensaios do sensor (`ensaio/caixa1.test.js`) só correm com ele a medir e com a caixa pousada e
parada; sem sensor saltam-se e dizem porquê.

**"Calado" é faltar qualquer das três leituras há meio segundo** (desde a 0.3.1; antes era não chegar
nenhuma). Se parasse só a atitude, o movimento continuava a sair com a última, parada no tempo, como se
fosse de agora; se parasse só a aceleração, deixava de sair movimento e a caixa dizia que o sensor
media. Prova-se com `avaria,4,<espécie>`: a caixa dá um toque no RST e põe-no a medir tudo outra vez em
menos de 5 s.

**O caminho inteiro de um sensor que não volta** prova-se com `avaria,3,35`: o batimento diz "calado"
(2), os toques no RST vão-se espaçando (1, 2, 5, 10 e 30 s), ao quinto sem resposta diz "não volta" (3),
e quando o sensor volta a poder falar a caixa apanha-o no toque seguinte (0). Entretanto o batimento e o
log não falham uma linha, não sai movimento nenhum, e o número de ordem do movimento segue de onde ia.

## Ensaio da plaquinha do vento

A plaquinha é o optoacoplador PC817 que fica entre a ficha do mostrador NASA e o RX2 da caixa 1
(montagem: `docs/caixas/vento-plaquinha-montagem.jpg`, feita por
`software/ferramentas/caixas/vento_plaquinha.py`). O mostrador manda a frase com o repouso em baixo e
com uma tensão que a placa não aguenta; a plaquinha baixa a tensão, põe o sinal direito e separa as
duas massas.

Ensaia-se em casa só com a caixa 1 e o portátil: a caixa faz de mostrador. Com o quarto valor do
comando `vento` a 1, a frase sai só pelo pino TX2, ao contrário (repouso em baixo), e não é levada por
dentro ao pino do vento. Quem a tem de trazer ao RX2 é a plaquinha.

Ligações, com o cabo USB fora (`docs/caixas/vento-plaquinha-ensaio-ligacoes.jpg`): TX2 à entrada dos
dados da plaquinha (furo C3), um GND à massa do lado do mostrador (H4), RX2 ao furo N3, o outro GND ao
N4, 3V3 ao T3. O 3V3 e um dos GND são os do sensor: o vermelho e o cinzento dele saem durante o
ensaio e voltam no fim. Na plaquinha do Ivo os fios ficaram: azul em C3, claro em H4, amarelo em N3,
verde sem fita em N4 e verde com fita em T3 (no desenho de montagem, "AMARELO" e "VERDE" são as
cores dos fios da ficha do mostrador, que ligam ao C3 e ao H4).

```
node ensaio/plaquinha-vento.js COM3        (três fases de 20 s; outro número de segundos a seguir à porta)
```

Três ventos diferentes, o último com uma segunda frase colada. Cada fase passa se chegar uma frase
por segundo, igual à mandada, e nenhuma for deitada fora. Se falhar, diz por onde procurar. Na placa a
frase sai a 3,3 V e passam 2 mA no díodo do optoacoplador: menos do que com o mostrador (5 ou 12 V),
por isso quem passa aqui passa lá com folga.

`npm test` corre-se com os dois fios do lado do mostrador (azul e branco) **soltos**: os outros
ensaios do vento escrevem no próprio RX2, e um deles conta que nada entre por fora. O lado da caixa 1
da plaquinha (RX2, 3V3 e GND) pode ficar ligado.

A caixa responde a cada comando com `$AQR,<comando>,<resultado>*HH`. O programa do portátil nunca manda
comandos: só os ensaios o fazem.

Dois contadores do `estado` da caixa 1 servem para a instalação no barco: `avalanches` (vezes que as
mudanças de nível na entrada do vento passaram do limite: fio no ar ou ruído) e `log-recusados`
(impulsos a menos de 4 ms do anterior: ruído do comparador). Com as entradas boas, não sobem.

**A avalanche e os recomeços.** A onda da avalanche é feita por um temporizador do chip e, como um
sinal de fora, não para quando a placa recomeça sozinha (um recomeço não apaga o que os pinos tinham);
só para com o `parar`, ou quando a placa arranca e volta a pôr os pinos como entradas. É de propósito:
serve para ensaiar que a caixa arranca com a avalanche a decorrer.

## A fila dos 3,3 V e da massa

A placa da caixa 1 só tem um pino de 3,3 V, e o sensor de movimento, a plaquinha do vento e a roda do
log precisam todos dele. A plaquinha do vento já o recebe (furo T3) e à massa (N4): as duas filas
fazem-se nela, e as peças da roda do log ficam na mesma placa. Desenho de montagem, com a conferência
a multímetro: `docs/caixas/caixa1-fila-montagem.jpg`, feito por
`software/ferramentas/caixas/caixa1_fila.py` (que só desenha se as pontes derem o circuito). Onde os
fios ligam na placa da caixa 1: `docs/caixas/caixa1-fila-ligacoes.jpg`.

| Fio da plaquinha | Furo | Para onde vai |
|---|---|---|
| verde com fita | T3 | pino 3V3 da placa (1.º da fila do botão BOOT, a contar da ficha USB) |
| verde sem fita | N4 | pino GND ao lado (2.º) |
| amarelo | N3 | RX2 (6.º) |
| do D27 | W9 | D27: na outra fila, o 6.º a contar da ficha USB (o 1.º dessa fila é o VIN, 5 V) |
| do VIN do sensor | V3 | pino VIN do sensor |
| do GND do sensor | N5 | pino GND do sensor |
| os dois da roda | T7 e Q9 | os dois fios da roda do log, por qualquer ordem |
| azul e branco | C3 e H4 | no barco, o amarelo e o verde da ficha do mostrador do vento |

## Ensaio da entrada da roda do log

A roda é um contacto que está fechado quase a volta toda e abre uma vez por volta. Na plaquinha, um
dos fios dela recebe os 3,3 V por 1 kΩ; o outro tem 10 kΩ e 100 nF à massa e vai ao D27 por 1 kΩ. O
condensador tira o ruído do cabo comprido, mas faz o pino **descer devagar** quando a roda abre (cerca
de 0,6 ms até meio). As entradas deste chip não têm folga entre o "em cima" e o "em baixo": uma
descida lenta pode passar por subida, e a caixa contava duas vezes a mesma volta.

Ensaia-se em casa, sem roda: a caixa faz de roda pelo pino D26 (comando `roda`). Com o cabo USB fora,
o fio da roda do furo **Q9** vai ao pino **D26** (na fila do VIN, o 7.º a contar da ficha USB, colado
ao do D27); o outro fio da roda (T7) fica solto.

```
node ensaio/roda-por-fora.js COM3        (quatro fases de 20 s; outro número de segundos a seguir à porta)
```

Devagar, a meio, depressa, e com a roda aberta quase metade da volta. Cada fase passa se a caixa
contar **exatamente** as voltas que a roda a fingir deu. Se contar o dobro, é a subida falsa da
descida lenta. O `npm test` corre-se **sem** este fio (um dos ensaios conta que nada entre por fora).

## O rádio da caixa 2 volta a tentar

Até à 0.2.2, se o rádio da caixa 2 não ligasse ao arrancar, ou se o registo do destino (a caixa 1)
falhasse, ela ficava calada no rádio até lhe cortarem a corrente, com o batimento a sair pelo USB como
se nada fosse: do portátil só se via que o motor não chegava. Desde a 0.3.0 volta a tentar sozinha, o
rádio de 10 em 10 s e o destino de segundo a segundo, sem recomeçar a placa (o motor continua a ser
lido). Cada vez que repõe uma coisa que tinha falhado conta em `religado`, no comando `estado`.

Prova-se com as duas placas e o comando `avaria`: com o rádio deitado abaixo, o batimento da caixa 2
deixa de chegar à caixa 1 e volta em menos de 15 s; sem destino, volta em menos de 3 s. Sem a caixa
recomeçar, e com o motor a fingir a chegar logo a seguir.

**A caixa 1 faz o mesmo desde a 0.3.1** (revisão final de 28/11): sem o rádio dela não sai o farol, a
caixa 2 cala-se (só manda a quem ouve) e do portátil só se via "caixa 2 sem ligação". Tenta outra vez de
30 em 30 s, e conta em `religado` no comando `radio`. Prova-se com `avaria,1` na caixa 1: o batimento
da caixa 2 deixa de chegar e volta em menos de 45 s, sem nenhuma das duas recomeçar.

Um cuidado que ficou escrito no programa (`aqRadioDesliga`, em `comum/src/arlequin_radio.h`) e num
ensaio sem placas (`ensaio/radio.test.js`): o rádio só se desfaz se tiver sido aberto. Pedir ao chip
que o desfaça sem nunca o ter aberto fá-lo recomeçar sem parar, calado (visto na caixa 2 a 28/11).

## A ponte USB e as linhas de 64 bytes

Entre a porta série do ESP32 e o cabo USB há um chip, a ponte (nestas placas, um CP210x). Entrega os
bytes ao portátil em pacotes de 64. Enquanto houver bytes a chegar manda pacotes cheios; quando o fio
para, manda o resto num pacote mais pequeno, e é esse pacote pequeno que faz o portátil entregar tudo
ao programa. **Se o fio parar mesmo no fim de um pacote cheio não há resto, e o portátil fica com os
bytes à espera de mais.** Nada se perde: chega tarde.

Visto a 28/11/2026 com a caixa 1 parada em cima da mesa: as linhas do movimento tinham 64 bytes certos
(depende dos algarismos de cada número), e cada uma só chegava com a seguinte (100 ms depois) ou com a
do log (até 400 ms). Foi o contador dos intervalos compridos do ensaio de resistência que deu por isso.

**A regra (`AqPonte`, em `comum/src/arlequin_linhas.h`):** depois de cada linha, se o fio pudesse parar
num múltiplo de 64 bytes, a caixa junta-lhe um fim de linha a mais. São **linhas vazias, que quem lê
não conta** (o plugin das caixas e os ensaios já as deitavam fora). Uma pausa curta entre duas linhas
tanto pode ter chegado para a ponte despachar como não; por isso a conta faz-se a partir de todos os
sítios onde ela pode ter despachado desde a última pausa de 10 ms, e às vezes são precisos dois fins
de linha em vez de um. Gasta menos de um byte em mil.

| Onde se prova | O quê |
|---|---|
| `ensaio/ponte.js` e `ponte.test.js` (sem placas) | A regra contra um modelo da ponte: milhares de sequências ao acaso, com a ponte a despachar ao fim de 0,1 a 9 ms, e nenhuma linha retida |
| `ensaio/caixa1.test.js`, com o comando `surto` | Na placa: linhas de 64, 128 e 192 bytes, duas de seguida que somam 64, e pares com pausas de 0,15 a 4 ms. Passa se a última linha chegar cerca de 20 ms antes da resposta, e não colada a ela |
| `ensaio/resistencia.js` | Conta os intervalos de mais de 250 ms entre duas linhas. Com o sensor a medir não deve haver nenhum; antes da regra eram mais de cem por minuto |

## O batimento

De segundo a segundo, cada caixa diz que está viva:
`$AQB,<caixa>,<ms desde o arranque>,<versão>,<a fingir>,<força do rádio>,<perdidos>` e, na caixa 1, mais
três campos: o estado do sensor (0 a medir, 1 a arrancar, 2 calado e a tentar o recomeço, 3 não volta,
4 a fingir), o motivo do último arranque da placa e os toques no recomeço do sensor.

Motivos de arranque mais vistos: 1 ligou-se à corrente; 3 recomeço pedido pelo programa; 4 o programa
caiu; 6 o reinício automático (a caixa ficou presa mais de 5 s); 9 a corrente desceu de mais.
