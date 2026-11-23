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
| Caixa 2: escuta do motor, rádio, motor a fingir | escrito e a compilar; **por gravar e ensaiar** (falta ligar a segunda placa) |
| Sensor de movimento verdadeiro (BNO085) | **por fazer**: o primeiro sensor deixou de responder a 22/11; espera-se o segundo. Até lá a caixa 1 diz ao portátil que o sensor não responde |

## Os pinos

| Caixa 1 | Pino | Nota |
|---|---|---|
| Sensor: os dois fios de dados | D21, D22 | como está em `docs/caixas/bancada-ligacao-6-fios.jpg`; a ligação do sensor novo decide-se quando ele chegar |
| Sensor: aviso (INT) e recomeço (RST) | D19, D18 | |
| Roda do log | D27 | entrada; duas subidas a menos de 4 ms contam como uma |
| Vento | RX2 (D16) | 4 800 baud, só leitura |
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
movimento a 10 linhas por segundo; e, com as duas, o motor pelo rádio e o que acontece quando a
caixa 2 recomeça ou se cala.

Para o caminho inteiro, até ao ecrã e à gravação, há o ensaio do `software/bordo` com a placa
verdadeira (`npm run caixa-a-fingir` numa janela, para o GPS a fingir, e `npm run ensaio-placa` noutra).
Escreve só nas pastas do ensaio e sai tudo marcado como simulado.

## Sinais a fingir (comandos de ensaio)

Cada caixa traz geradores de bancada: sinais feitos por ela própria, que entram pelo caminho
verdadeiro. Só se ligam por um comando com a soma certa (`$AQC,<comando>[,<valores>]*HH`), nunca ficam
gravados (um recomeço desliga-os todos), e enquanto houver algum ligado a caixa diz no batimento que
finge: o portátil marca tudo como simulado e a AI não aprende com isso.

| Comando | Caixa | O que faz |
|---|---|---|
| `log,<Hz>` | 1 | Impulsos da roda a fingir (0 para; 26 dá 5,2 nós) |
| `vento,<décimos de grau>,<décimos de nó>` | 1 | Uma frase de vento por segundo (`0,0` para; `-1,0` manda lixo, para ensaiar a entrada) |
| `movimento,<0\|1>` | 1 | 100 leituras por segundo com 12° de adornamento e a proa a 245° |
| `motor,<rpm>` | 2 | Tramas do motor a fingir (0 para) |
| `parar` | as duas | Desliga todos os geradores |
| `estado` | as duas | Os contadores da caixa (o que entrou em cada entrada, o que se perdeu) |
| `prender` | as duas | Prende a caixa de propósito, para ensaiar o reinício automático |

A caixa responde a cada comando com `$AQR,<comando>,<resultado>*HH`. O programa do portátil nunca manda
comandos: só os ensaios o fazem.

## O batimento

De segundo a segundo, cada caixa diz que está viva:
`$AQB,<caixa>,<ms desde o arranque>,<versão>,<a fingir>,<força do rádio>,<perdidos>` e, na caixa 1, mais
três campos: o estado do sensor (0 a medir, 1 a arrancar, 2 calado e a tentar o recomeço, 3 não volta,
4 a fingir), o motivo do último arranque da placa e os toques no recomeço do sensor.

Motivos de arranque mais vistos: 1 ligou-se à corrente; 3 recomeço pedido pelo programa; 4 o programa
caiu; 6 o reinício automático (a caixa ficou presa mais de 5 s); 9 a corrente desceu de mais.
