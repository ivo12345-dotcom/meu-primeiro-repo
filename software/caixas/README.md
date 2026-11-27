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

## Estado (23/11/2026)

| Parte | Estado |
|---|---|
| Caixa 1: sinal de vida, reinício automático, roda do log, vento, movimento a fingir | feito e ensaiado na placa |
| Caixa 1: rádio | feito; a placa passa os ensaios dela com o rádio ligado |
| Caixa 2: escuta do motor, rádio, motor a fingir | feito e ensaiado com as duas placas ligadas (a escuta do motor verdadeiro só no barco) |
| Caixa 2: escuta pelo fio, na bancada, com os módulos do barramento | **passou a 26/11**: 6145 tramas saídas, 6145 ouvidas, nenhum erro (rajadas de 1000 a 200 e a 1000 por segundo, e 10 s à cadência do motor). Desfeita a montagem, os ensaios das duas placas passaram todos (40 em 40, `npm test`) |
| Escuta do motor no barco (`ensaio/ouvir-motor.js`) | escrita e experimentada em casa a 26/11 com o motor a fingir; **a primeira escuta do motor verdadeiro está por fazer** |
| Revisão independente do programa (23/11) | feita; os cinco pontos importantes estão corrigidos na versão **0.2.1**. A **0.2.2** (27/11) só acrescenta à caixa 1 o vento "por fora", para ensaiar a plaquinha do vento; a caixa 2 não muda, mas diz a versão e tem de ser gravada outra vez para os ensaios dela passarem |
| Sensor de movimento verdadeiro (BNO085) | **por fazer**: o primeiro sensor deixou de responder a 22/11; espera-se o segundo. Até lá a caixa 1 diz ao portátil que o sensor não responde |
| Entradas do log e do vento no barco | **por fazer**: falta escolher o comparador e o adaptador (medidas do Ivo). Cada entrada leva uma **resistência de 1 kΩ em série** junto à placa (ver "Sinais a fingir") |

## Os pinos

| Caixa 1 | Pino | Nota |
|---|---|---|
| Sensor: os dois fios de dados | D21, D22 | como está em `docs/caixas/bancada-ligacao-6-fios.jpg`; a ligação do sensor novo decide-se quando ele chegar |
| Sensor: aviso (INT) e recomeço (RST) | D19, D18 | |
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
recomeçar, e que, se recomeçar a meio dela, volta a arrancar; e, com as duas, o motor pelo rádio e o
que acontece quando a caixa 2 recomeça ou se cala.

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
| `--sem-geradores` | Não liga sinal a fingir nenhum: ouve o que a caixa tiver de verdade. **É a única maneira de o correr no barco** |
| `--registo <ficheiro>` | Guarda também o que escreve |

Conta como falha: linhas que o portátil não lê; leituras de movimento em falta; segundos sem sinal de
vida (os que o relógio da caixa mostra e, pelo relógio do portátil, o silêncio que estiver a decorrer);
a caixa que recomeça; linhas que a caixa diz que não conseguiu mandar; a porta que se perde (acaba
logo); e, com a caixa 2, o silêncio dela, os recomeços e os pacotes perdidos no rádio. As cópias que a
ponte USB repete só se mostram: são linhas boas.

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
> ensaios com geradores (`npm test` usa-os sempre; o de resistência só com `--sem-geradores`), e cada
> uma das duas entradas leva uma **resistência de 1 kΩ em série**, junto à placa, que torna o engano
> inofensivo. O movimento e o motor a fingir não mexem em pinos.

| Comando | Caixa | O que faz |
|---|---|---|
| `log,<Hz>` | 1 | Impulsos da roda a fingir (0 para; 26 dá 5,2 nós) |
| `vento,<décimos de grau>,<décimos de nó>[,<0\|1>[,<0\|1>]]` | 1 | Uma frase de vento por segundo (`0,0` para; `-1,0` manda lixo, para ensaiar a entrada). O terceiro valor a 1 junta uma segunda frase, que não é o MWV. O quarto valor a 1 manda a frase **por fora**: só pelo pino TX2 e ao contrário, como o mostrador a manda (ver "Ensaio da plaquinha do vento") |
| `movimento,<0\|1>` | 1 | 100 leituras por segundo com 12° de adornamento e a proa a 245° |
| `avalanche,<1\|2>,<kHz>` | 1 | Uma onda rápida no pino do log (1) ou do vento (2), para ensaiar que um fio no ar ou um comparador a oscilar não param a caixa (0 para; 2000 no máximo) |
| `motor,<rpm>` | 2 | Tramas do motor a fingir (0 para) |
| `parar` | as duas | Desliga todos os geradores |
| `estado` | as duas | Os contadores da caixa (o que entrou em cada entrada, o que se perdeu) |
| `prender` | as duas | Prende a caixa de propósito, para ensaiar o reinício automático |

## Ensaio da plaquinha do vento

A plaquinha é o optoacoplador PC817 que fica entre a ficha do mostrador NASA e o RX2 da caixa 1
(montagem: `docs/caixas/vento-plaquinha-montagem.jpg`, feita por
`software/ferramentas/caixas/vento_plaquinha.py`). O mostrador manda a frase com o repouso em baixo e
com uma tensão que a placa não aguenta; a plaquinha baixa a tensão, põe o sinal direito e separa as
duas massas.

Ensaia-se em casa só com a caixa 1 e o portátil: a caixa faz de mostrador. Com o quarto valor do
comando `vento` a 1, a frase sai só pelo pino TX2, ao contrário (repouso em baixo), e não é levada por
dentro ao pino do vento. Quem a tem de trazer ao RX2 é a plaquinha.

Ligações, com o cabo USB fora (`docs/caixas/vento-plaquinha-ensaio-ligacoes.jpg`): TX2 ao fio
AMARELO, um GND ao fio VERDE, RX2 ao fio RX2, o outro GND ao fio GND, 3V3 ao fio 3V3. O 3V3 e um dos
GND são os do sensor: o vermelho e o cinzento dele saem durante o ensaio e voltam no fim.

```
node ensaio/plaquinha-vento.js COM3        (três fases de 20 s; outro número de segundos a seguir à porta)
```

Três ventos diferentes, o último com uma segunda frase colada. Cada fase passa se chegar uma frase
por segundo, igual à mandada, e nenhuma for deitada fora. Se falhar, diz por onde procurar. Na placa a
frase sai a 3,3 V e passam 2 mA no díodo do optoacoplador: menos do que com o mostrador (5 ou 12 V),
por isso quem passa aqui passa lá com folga.

`npm test` corre-se **sem** a plaquinha ligada: os outros ensaios do vento escrevem no próprio RX2.

A caixa responde a cada comando com `$AQR,<comando>,<resultado>*HH`. O programa do portátil nunca manda
comandos: só os ensaios o fazem.

Dois contadores do `estado` da caixa 1 servem para a instalação no barco: `avalanches` (vezes que as
mudanças de nível na entrada do vento passaram do limite: fio no ar ou ruído) e `log-recusados`
(impulsos a menos de 4 ms do anterior: ruído do comparador). Com as entradas boas, não sobem.

**A avalanche e os recomeços.** A onda da avalanche é feita por um temporizador do chip e, como um
sinal de fora, não para quando a placa recomeça sozinha (um recomeço não apaga o que os pinos tinham);
só para com o `parar`, ou quando a placa arranca e volta a pôr os pinos como entradas. É de propósito:
serve para ensaiar que a caixa arranca com a avalanche a decorrer.

## O batimento

De segundo a segundo, cada caixa diz que está viva:
`$AQB,<caixa>,<ms desde o arranque>,<versão>,<a fingir>,<força do rádio>,<perdidos>` e, na caixa 1, mais
três campos: o estado do sensor (0 a medir, 1 a arrancar, 2 calado e a tentar o recomeço, 3 não volta,
4 a fingir), o motivo do último arranque da placa e os toques no recomeço do sensor.

Motivos de arranque mais vistos: 1 ligou-se à corrente; 3 recomeço pedido pelo programa; 4 o programa
caiu; 6 o reinício automático (a caixa ficou presa mais de 5 s); 9 a corrente desceu de mais.
