# Sistema no portátil, parte 2 (o programa das duas caixas): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** as duas placas ESP32 falam a linguagem das linhas que o portátil já lê: a caixa 1 manda o batimento, a roda do log, o vento, o movimento do sensor e o que a caixa 2 lhe passa pelo rádio; a caixa 2 escuta o motor e reenvia. Tudo ensaiado com as placas verdadeiras ligadas ao portátil, sem depender do sensor nem do barco.

**Architecture:**
- **Uma biblioteca partilhada** (`software/caixas/comum`): as linhas `$AQ` com a soma, os comandos de ensaio e o formato dos pacotes do rádio. As duas caixas usam o mesmo código para o que têm em comum.
- **Caixa 1** (`software/caixas/caixa1`): um ciclo principal só, sem tarefas paralelas a escrever na porta. Módulos pequenos, um por entrada: `log.h`, `vento.h`, `movimento.h` (a média de cada décimo de segundo), `sensor.h` (o BNO085), `radio1.h` (o que chega da caixa 2), `ensaio.h` (os geradores de bancada).
- **Caixa 2** (`software/caixas/caixa2`): `motor.h` (o barramento do motor, só em escuta), `radio2.h`, `ensaio2.h`.
- **Ensaios com as placas ligadas** (`software/caixas/ensaio`): `node:test`, a ler a porta com a `serialport` do servidor e a validar cada linha com o `ler()` do plugin das caixas, que é quem as vai ler no barco. Sem placa ligada os ensaios saltam-se e dizem porquê.
- **Geradores de bancada dentro do mesmo programa:** impulsos do log, frase do vento, movimento e tramas do motor a fingir. Só se ligam por um comando com soma certa, nunca ficam gravados, e enquanto estiverem ligados a caixa diz que finge (`sim` 1), por isso nada disto ensina a AI.
- **No portátil** muda pouco: a linha do motor passa a levar soma, o batimento da caixa 1 ganha o estado do sensor, e o perfil de bordo ganha um ensaio com a placa verdadeira.

**Tech Stack:** arduino-cli 1.6.0 com o núcleo `esp32:esp32` 3.3.12, placa `esp32:esp32:esp32doit-devkit-v1`; só bibliotecas que vêm com o núcleo, mais a SH-2 da CEVA que vem dentro da "Adafruit BNO08x" 1.2.7 (já instalada). Node ≥ 22, `node:test`, a `serialport` 11.0.1 do servidor. Neste portátil não há compilador de C++ para o próprio portátil: o que é das placas ensaia-se nas placas.

**Spec:** `docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md` (as caixas, "Das caixas para o portátil", "Sobe e desce da onda" e o ponto em aberto 12, com as regras 1 a 10). O contrato das linhas está em `docs/superpowers/plans/2026-11-22-sistema-no-portatil-parte1.md`, "A linguagem das linhas".

## Global Constraints

- "As caixas só leem e mandam os valores em bruto": nenhuma conta nem calibração nas placas.
- Porta USB a **460 800 baud**, 8N1; uma linha por leitura, `\n` no fim, **200 caracteres no máximo**; números inteiros decimais.
- **Todas as linhas que a caixa manda levam soma de controlo, as do motor também** (regra 8 do ponto 12).
- **O batimento da caixa 1 sai de segundo a segundo desde o primeiro segundo**, mesmo sem sensor, sem vento e sem caixa 2.
- A caixa aguenta arrancar com o portátil já à escuta, o portátil ligar-se a meio, e o portátil não estar a ler durante horas.
- Movimento: o sensor lido **pelo menos 100 vezes por segundo**, a média de cada décimo de segundo, 10 linhas por segundo, com número de ordem.
- Caixa 2: "só em escuta (a placa nunca escreve no barramento do motor)"; "o mais simples possível (lê e reenvia)". Cada trama vai "no formato `candump -L`", com o tempo da caixa 2.
- "Não há fio entre o motor e o portátil": a caixa 2 fala com a caixa 1 só pelo rádio das placas (ESP-NOW), sem rede Wi-Fi.
- Sensor BNO085: as regras 1 a 10 do ponto 12 do desenho, por inteiro.
- **Dados a fingir nunca ensinam a AI:** um gerador ligado obriga o `sim` a 1 no batimento dessa caixa.
- **Cão de guarda:** uma caixa presa recomeça sozinha em poucos segundos.
- Repositório público: sem endereços das placas, sem números de série. O emparelhamento do rádio não pode precisar de um endereço escrito no código.
- Não se descarrega nada sem o OK do Ivo. Definições do Windows não se mexem.
- Antes de gravar uma placa, confirmar que é uma ELEGOO nova (o programa de bancada diz `chip=ESP32-D0WD-V3`); o Ivo tem outras placas ESP32 de outros projetos. Compilar uma caixa de cada vez.
- "Regravar uma placa só com o barco parado."
- Textos e comentários em pt-PT. Git: ramo `claude/piloto-automatico-cwnr0f`; cada commit termina com uma linha em branco e `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **O portátil deixa de ler durante horas** (porta fechada, portátil a dormir) e volta: a caixa não encrava, não enche a memória, e a primeira linha depois de voltar é uma linha inteira ou deita-se fora (Tarefa 1).
2. **A caixa 2 desaparece e volta, ou recomeça:** o batimento dela para e volta, e o contador de perdidos não salta aos milhares nem anda para trás (Tarefa 5).
3. **O sensor cala-se a meio, como a 22/11:** a caixa tenta o RST, diz ao portátil em que estado o sensor está, e o log, o vento e o motor continuam sem um soluço (Tarefas 6 e 7).
4. **Lixo na entrada do vento** (mostrador desligado, fio no ar): nunca sai uma frase que o mostrador não mandou inteira e com a soma certa (Tarefa 3).
5. **Roda do log parada, ou com impulsos duplos:** a contagem não salta, e o período fica a 0 enquanto não houver dois impulsos (Tarefa 2).

## Os pinos

| Caixa 1 | Pino | Nota |
|---|---|---|
| Sensor: SDA, SCL | D21, D22 | os dois fios de dados |
| Sensor: INT | D19 | entrada com resistência para cima |
| Sensor: RST | D18 | só se puxa para baixo (dreno aberto) |
| Roda do log | D27 | entrada; nos ensaios o gerador mexe neste mesmo pino |
| Vento | RX2 (D16) | 4 800 baud; nos ensaios a frase a fingir sai para este mesmo pino |
| Luz | D2 | a luz azul da placa: acesa com o portátil a receber tudo, a piscar se falta alguma coisa |

| Caixa 2 | Pino | Nota |
|---|---|---|
| Motor: leitura (CRX do módulo) | D4 | o único fio de dados entre o módulo e a placa |
| Motor: escrita | D25, sem fio | o controlador exige um pino; não se liga a nada, e o CTX do módulo fica preso aos 3,3 V |
| Luz | D2 | acesa com a caixa 1 a ouvir |

## O que muda no contrato das linhas

1. **Linha do motor com soma:** `(s.µs) can1 ID#DADOS*HH`, com `HH` o ou-exclusivo de tudo o que está antes do `*`. O portátil passa a exigi-la.
2. **Batimento da caixa 1 com três campos a mais no fim** (o contrato já deixava crescer): estado do sensor (0 a medir, 1 a arrancar, 2 calado e a tentar o RST, 3 não volta, 4 a fingir); motivo do último arranque da placa (o número que o chip dá); toques no RST desde o arranque.
3. **Linhas só de bancada**, que o portátil não conhece e conta como desconhecidas: `$AQR,<comando>,<resultado>*HH`, a resposta a um comando de ensaio.
4. **Comandos, do portátil para a caixa:** `$AQC,<comando>[,<valores>]*HH`. Sem soma certa não fazem nada. De ensaio: `log,<Hz>` (0 para parar), `vento,<décimos de grau>,<décimos de nó>` (`vento,0,0` para parar; `vento,-1,0` manda lixo, para ensaiar a entrada), `movimento,<0|1>`, `motor,<rpm>` (na caixa 2; 0 para parar), `prender` (bloqueia o ciclo, para ensaiar o cão de guarda), `rst` (um toque no RST do sensor), `parar` (desliga todos os geradores). De uso, com o barco parado: `guardar` (o sensor grava as calibrações dele; regra 7 do ponto 12).

---

### Task 1: O contrato no portátil, o esqueleto da caixa 1 e a bancada automática

**Files:**
- Modify: `software/signalk-arlequin-caixas/lib/linhas.js`; Test: `software/signalk-arlequin-caixas/test/linhas.test.js`
- Modify: `software/ferramentas/caixa-a-fingir/lib/gerador.js`; Test: `software/ferramentas/caixa-a-fingir/test/gerador.test.js`
- Modify: `docs/superpowers/plans/2026-11-22-sistema-no-portatil-parte1.md` (a tabela do contrato)
- Create: `software/caixas/comum/library.properties`, `software/caixas/comum/src/arlequin_linhas.h`, `software/caixas/comum/src/arlequin_versao.h`
- Create: `software/caixas/caixa1/caixa1.ino`, `software/caixas/caixa1/pinos.h`, `software/caixas/caixa1/ensaio.h`
- Create: `software/caixas/ensaio/package.json`, `software/caixas/ensaio/placa.js`
- Test: `software/caixas/ensaio/caixa1.test.js`
- Create: `software/caixas/package.json` (os comandos de compilar e gravar)

**Interfaces:**
- Produces (Node, `lib/linhas.js`), porque os ensaios das placas leem com o `ler()` e têm de o encontrar já a falar o contrato novo:
  - `ler()`: a linha do motor só vale com a soma certa (`(12.345678) can1 0CF00400#FFFFFF004BFFFFFF*HH`); o batimento da caixa 1 devolve também `sensor` (0 a 4), `arranque` e `rsts` quando os três campos vêm e são inteiros (sem eles, as chaves não aparecem, e um batimento antigo de 7 campos lê-se como antes).
  - A caixa a fingir junta a soma a cada linha do motor com o `soma()` que já usava.
- Produces (C++, `arlequin_linhas.h`):
  - `uint8_t aqSoma(const char *texto)` (o ou-exclusivo dos caracteres)
  - `class AqLinha { AqLinha(const char *tipo); AqLinha &i(long v); AqLinha &t(const char *v); void manda(Print &p); }` (junta os campos com vírgulas, fecha com `*HH\n`; nunca passa de 200 caracteres: se passar, não manda e conta em `aqCortadas`)
  - `bool aqComando(const char *linha, char *comando, size_t n, long valores[4], int *quantos)` (lê um `$AQC` com soma certa)
  - `const char *const AQ_VERSAO = "0.2.0"`
- Produces (`caixa1.ino`): o batimento de segundo a segundo, `$AQB,1,<ms>,0.2.0,<sim>,0,<perdidos>,<sensor>,<arranque>,<rsts>`; `perdidos` conta as linhas que a caixa não conseguiu mandar.
- Produces (Node, `placa.js`):
  - `abrir(porta: string): Promise<Placa>`, com a porta a 460 800 baud e as duas linhas de comando em repouso (não reinicia a placa)
  - `placa.linhas(ms: number): Promise<string[]>` (as linhas inteiras recebidas nesse tempo)
  - `placa.manda(comando: string, ...valores): Promise<string>` (escreve o `$AQC` com a soma e devolve o resultado do `$AQR` correspondente; rejeita ao fim de 2 s)
  - `placa.fechar(): Promise<void>`
  - `comPlaca(nome: 'ARLEQUIN_CAIXA1'|'ARLEQUIN_CAIXA2')`: a porta dada por essa variável de ambiente, ou `null`; os ensaios usam `{ skip: 'sem a placa ligada: definir ARLEQUIN_CAIXA1=COMx' }`
- Comandos: `npm run compilar:1`, `npm run gravar:1 -- COM3`, `npm test` (em `software/caixas`), que chamam o arduino-cli com `--library comum` e uma pasta de compilação fora do projeto (`%TEMP%/arlequin-caixas/caixa1`).

- [ ] **Step 0: O contrato no portátil, primeiro.** Testes que falham em `linhas.test.js` (linha do motor com a soma certa lê-se, sem soma ou com a soma errada dá `null`; batimento de 10 campos devolve `sensor`, `arranque` e `rsts`; o de 7 campos fica como estava) e em `gerador.test.js` (as linhas do motor da caixa a fingir levam soma e continuam a ler-se). Ver falhar (`cd software/dev && npm test`), implementar, ver passar em tudo, atualizar a tabela do contrato no plano da parte 1 e fazer commit: `git commit -m "Caixas: linha do motor com soma e estado do sensor no batimento"`.

- [ ] **Step 1: Escrever os ensaios que falham** (`caixa1.test.js`, só os desta tarefa):
  - "batimento desde o primeiro segundo": em 6 s chegam 5 a 7 linhas `$AQB` da caixa 1, com `ms` a crescer de 1000 em 1000 (±50), `fw` `0.2.0`, `sim` falso; o `ler()` do plugin lê todas as linhas recebidas (nenhuma `null`).
  - "abrir e fechar a porta não reinicia a caixa": três aberturas seguidas, o `ms` continua a subir.
  - "lixo e comandos sem soma não fazem nada": mandar 300 bytes ao acaso, `$AQC,log,26*00` e `$AQC,log,26` sem soma; o `sim` continua falso e não aparece nenhum `$AQL` com impulsos.
  - "um gerador ligado obriga a dizer que finge": `manda('log', 26)` devolve `ok`, o batimento seguinte traz `sim` verdadeiro; `manda('parar')` e volta a falso.
  - "cão de guarda": `manda('prender')`; em menos de 10 s a caixa recomeça sozinha (o `ms` volta a um valor pequeno) e o campo do motivo do arranque diz que foi o cão de guarda.
  - "Review Focus 1, o portátil não lê": fechar a porta 20 s com o gerador do log a 50 Hz ligado, reabrir: a primeira linha inteira lê-se, o `ms` avançou esses 20 s e a caixa não recomeçou.

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/caixas && ARLEQUIN_CAIXA1=COM3 npm test`
Expected: FAIL (na placa está o programa de bancada, a 115 200 baud: não chega nenhum `$AQB`)

- [ ] **Step 3: Implementar** a biblioteca, o esqueleto e a `placa.js`. Na caixa: `Serial.setTxBufferSize(8192)` antes de abrir a porta; antes de cada linha vê-se o espaço livre com `Serial.availableForWrite()`, e sem espaço a linha não se manda e conta-se; o ciclo principal nunca espera por nada mais de 50 ms; o cão de guarda do ciclo fica a 5 s. A luz da placa fica acesa enquanto não houver linhas por mandar e pisca quando a caixa deita linhas fora. Os geradores vivem em `ensaio.h` e esta tarefa só precisa do estado "algum gerador ligado".

- [ ] **Step 4: Compilar, gravar e ver passar**

Run: `cd software/caixas && npm run gravar:1 -- COM3 && ARLEQUIN_CAIXA1=COM3 npm test`
Expected: PASS, 6 ensaios. Sem a variável de ambiente: 6 saltados, saída 0.

- [ ] **Step 5: Commit**

```bash
git add software/caixas
git commit -m "Caixas: esqueleto da caixa 1 (linhas, batimento, cão de guarda) e ensaios com a placa"
```

### Task 2: A roda do log

**Files:**
- Create: `software/caixas/caixa1/log.h`
- Modify: `software/caixas/caixa1/caixa1.ino`, `software/caixas/caixa1/ensaio.h`
- Test: `software/caixas/ensaio/caixa1.test.js`

**Interfaces:**
- Produces: `void logIniciar()`, `void logCorre(uint32_t agoraMs)` (manda `$AQL,<ms>,<impulsos>,<periodoUs>` de 500 em 500 ms); em `ensaio.h`, `void ensaioLog(long hz)` (0 para; até 200).

- [ ] **Step 1: Ensaios que falham**
  - "log a 26 Hz": com `manda('log', 26)`, em 5 s chegam 9 a 11 `$AQL`; os impulsos sobem 26 por segundo (±1); o período é 38 462 µs ±1 %; com `c.velocidadeNaAgua(c.hzLog(...))` do plugin dá 5,2 nós ±0,1.
  - "Review Focus 5, roda parada": depois de `manda('log', 0)` os impulsos não mexem; numa caixa acabada de arrancar o período é 0.
  - "Review Focus 5, impulsos duplos": `manda('log', 400)` (acima do que a roda dá) não conta mais de 250 por segundo: dois impulsos a menos de 4 ms contam como um.

- [ ] **Step 2: Correr e ver falhar.** Run: `ARLEQUIN_CAIXA1=COM3 npm test`. Expected: FAIL (não há `$AQL`).

- [ ] **Step 3: Implementar.** Uma interrupção na subida do D27 que guarda a hora (`esp_timer_get_time`), conta e calcula o período; ignora subidas a menos de 4 ms da anterior. O ciclo lê os três valores de uma vez, com as interrupções paradas esse instante. O gerador é um temporizador que mexe no próprio D27, posto como entrada e saída.

- [ ] **Step 4: Gravar e ver passar.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Caixa 1: a roda do log"`

### Task 3: O vento

**Files:**
- Create: `software/caixas/caixa1/vento.h`
- Modify: `software/caixas/caixa1/caixa1.ino`, `software/caixas/caixa1/ensaio.h`
- Test: `software/caixas/ensaio/caixa1.test.js`

**Interfaces:**
- Produces: `void ventoIniciar()`, `void ventoCorre()` (lê a porta do vento a 4 800 baud e manda tal e qual cada frase `MWV` inteira e com a soma certa); `uint32_t ventoInvalidas`; em `ensaio.h`, `void ensaioVento(long decimosDeGrau, long decimosDeNo)` (uma frase por segundo, escrita por uma segunda porta série ligada por dentro ao mesmo pino).

- [ ] **Step 1: Ensaios que falham**
  - "vento a fingir": com `manda('vento', 350, 140)` chega por segundo `$IIMWV,35.0,R,14.0,N,A*3E`, e o `ler()` dá ângulo 35 e 7,20 m/s.
  - "Review Focus 4, lixo no vento": o comando `vento,-1,0` faz o gerador mandar uma frase com a soma errada, uma cortada a meio e 80 bytes ao acaso por segundo: não sai nenhuma linha de vento e a caixa continua a mandar o batimento.
  - "outras frases não passam": o gerador manda também um `$IIVWR`; só o `MWV` aparece.

- [ ] **Step 2: Correr e ver falhar.** Expected: FAIL (não há linhas de vento).
- [ ] **Step 3: Implementar.** Linhas até 82 caracteres; o que passar disso deita-se fora até ao próximo `\n`.
- [ ] **Step 4: Gravar e ver passar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Caixa 1: o vento, tal como o mostrador o manda"`

### Task 4: O movimento a fingir e a média de cada décimo de segundo

**Files:**
- Create: `software/caixas/caixa1/movimento.h`
- Modify: `software/caixas/caixa1/caixa1.ino`, `software/caixas/caixa1/ensaio.h`
- Test: `software/caixas/ensaio/caixa1.test.js`

**Interfaces:**
- Produces (`movimento.h`): `void movAceleracao(float x, float y, float z)` (m/s²), `void movRotacao(float x, float y, float z)` (rad/s), `void movAtitude(float i, float j, float k, float r, float erroRad, uint8_t confianca)`, `void movCorre(uint32_t agoraMs)` (de 100 em 100 ms manda `$AQM` com a média das acelerações e das rotações desse décimo, a última atitude, `k` igual ao número de acelerações juntas, e o número de ordem a seguir; sem acelerações nesse décimo não manda nada e o número de ordem não avança).
- Produces (`ensaio.h`): `void ensaioMovimento(bool ligado)`: 100 leituras por segundo com o cenário da caixa a fingir do portátil (adornamento 12°, proa 245° ±3° de 20 em 20 s, caimento ±2° e aceleração vertical ±0,4 m/s² de 6 em 6 s).

- [ ] **Step 1: Ensaios que falham**
  - "movimento a fingir": com `manda('movimento', 1)`, em 5 s chegam 49 a 51 `$AQM`, com números de ordem seguidos, `k` entre 9 e 11, e a atitude do plugin (`c.atitude` com `c.eixos('+y', '+z')`) dá adornamento 12° ±0,5° e proa entre 242° e 248°.
  - "sem leituras não há linhas": com o gerador desligado e sem sensor, nenhum `$AQM`, e o estado do sensor no batimento é 4 só enquanto o gerador está ligado.

- [ ] **Step 2: Correr e ver falhar.** Expected: FAIL.
- [ ] **Step 3: Implementar.** As unidades das linhas são as do contrato (mm/s², 0,1 mrad/s, ×10 000, 0,1 mrad), arredondadas, e presas aos limites do contrato.
- [ ] **Step 4: Gravar e ver passar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Caixa 1: o movimento, com a média de cada décimo de segundo"`

### Task 5: O rádio e a caixa 2

**Files:**
- Create: `software/caixas/comum/src/arlequin_radio.h`
- Create: `software/caixas/caixa1/radio1.h`; Modify: `software/caixas/caixa1/caixa1.ino`
- Create: `software/caixas/caixa2/caixa2.ino`, `software/caixas/caixa2/pinos.h`, `software/caixas/caixa2/motor.h`, `software/caixas/caixa2/radio2.h`, `software/caixas/caixa2/ensaio2.h`
- Test: `software/caixas/ensaio/caixa2.test.js`

**Interfaces:**
- Produces (`arlequin_radio.h`): o cabeçalho comum de 6 bytes `{ 'A', 'Q', versão 1, tipo, ordem (2 bytes) }`; `AQ_FAROL = 1` (da caixa 1, a todos, de segundo a segundo), `AQ_BATIMENTO = 2` (`ms`, versão em 12 letras, `sim`), `AQ_TRAMAS = 3` (até 11 tramas: identificador, comprimento, 8 bytes, segundos e microssegundos da caixa 2); `class AqPerdidos { uint32_t total; void chegou(uint16_t ordem); void recomecou(); }`; o canal do rádio, `AQ_CANAL = 1`.
- A caixa 2 só manda depois de ouvir o farol da caixa 1 e manda-lhe a ela (com confirmação e repetição do próprio rádio). Não há endereços no código: aprende-se do farol, e uma placa trocada emparelha-se sozinha.
- Produces (`radio1.h`): `void radioIniciar()`, `void radioCorre(uint32_t agoraMs)`: manda o farol; por cada batimento recebido escreve `$AQB,2,<ms>,<fw>,<sim>,<dBm>,<perdidos>`; por cada trama escreve `(s.µs) can1 ID#DADOS*HH`. Os pacotes passam da interrupção do rádio para o ciclo por uma fila de 32; fila cheia conta em perdidos.
- Produces (`motor.h`): `void motorIniciar()` (controlador do chip a 250 kbit/s, **só em escuta**), `bool motorLe(Trama &t)`.
- A caixa 2 manda também o seu batimento pelo USB (`$AQB,2,…,0,0`), para o portátil a reconhecer na procura automática, e aceita os mesmos comandos de ensaio (`motor,<rpm>`, `prender`, `parar`).

- [ ] **Step 1: Ensaios que falham** (precisam das duas placas ligadas ao portátil; a segunda só para ter corrente e receber comandos):
  - "a caixa 2 sozinha, pelo USB": batimento da caixa 2 de segundo a segundo, sem mais nada.
  - "motor a fingir, pelo rádio": com `manda('motor', 2100)` na caixa 2, a caixa 1 passa a mandar `$AQB,2` com `sim` verdadeiro e força do rádio entre −90 e −10 dBm, e linhas do motor que o `ler()` lê; entre elas o PGN 61444 com 2100 rpm (`lerLinha` e as contas do plugin do motor).
  - "Review Focus 2, a caixa 2 recomeça": `manda('prender')` na caixa 2; o batimento 2 para na caixa 1, volta em menos de 15 s, e os perdidos não sobem mais de 50 nem descem.
  - "Review Focus 2, a caixa 2 some-se": com a caixa 2 presa, a caixa 1 continua a mandar o seu batimento e o log sem falhas.
  - "só em escuta": o programa da caixa 2 não tem nenhuma chamada de envio ao controlador do motor (ensaio que lê o código: nenhum `twai_transmit` em `software/caixas/caixa2`), e o modo pedido é o de só escuta.

- [ ] **Step 2: Correr e ver falhar.** Run: `ARLEQUIN_CAIXA1=COM3 ARLEQUIN_CAIXA2=COMx npm test`. Expected: FAIL.
- [ ] **Step 3: Implementar.** As tramas a fingir saem das mesmas contas do simulador do portátil (rotações no PGN 61444, temperatura no 65262, tensão no 65271), geradas na caixa 2 em vez de lidas do barramento; o resto do caminho é o verdadeiro.
- [ ] **Step 4: Gravar as duas e ver passar.** A segunda placa só se grava depois de o programa de bancada 1 dizer `chip=ESP32-D0WD-V3` nela e de o Ivo confirmar que é a outra ELEGOO. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Caixas: o rádio entre as duas e a caixa 2 (motor só em escuta)"`

### Task 6: O lado do portátil

**Files:**
- Modify: `software/signalk-arlequin-caixas/lib/caixas.js`, `index.js`; Test: `test/caixas.test.js`, `test/plugin.test.js`
- Modify: `software/bordo/preparar.js`, `software/bordo/package.json`; Test: `software/bordo/test/preparar.test.js`
- Modify: `software/dev/package.json` (o `test` passa por `software/caixas`), `software/README.md`

**Interfaces:**
- Consumes: o `sensor` do batimento (Tarefa 1, passo 0).
- O plugin publica `arlequin.caixas.1.sensor` (`'a-medir' | 'a-arrancar' | 'calado' | 'nao-volta' | 'a-fingir' | null`) e levanta o aviso `notifications.arlequin.caixas.sensor` ("O sensor de movimento não responde: sem proa nem adornamento") quando o estado é `'nao-volta'`, ou `'calado'` há mais de 20 s. O aviso apaga-se quando volta a medir.
- `preparar('ensaio-placa')`: como o `ensaio` (pasta do ensaio, dados do ensaio, tudo marcado como simulado), mas com a porta das caixas em `'auto'`; `npm run ensaio-placa` em `software/bordo`.

- [ ] **Step 1: Escrever os testes que falham** (um por cada linha de cima, mais: sem os campos novos no batimento, o caminho do sensor fica a `null` e não há aviso).
- [ ] **Step 2: Correr e ver falhar.** Run: `cd software/dev && npm test`. Expected: FAIL nos testes novos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr e ver passar.** Expected: PASS em tudo.
- [ ] **Step 5: O ensaio geral com as placas.** Com as duas placas ligadas e os geradores todos ligados (`log,26`, `vento,350,140`, `movimento,1`, `motor,2100`): `npm run caixa-a-fingir` (só para o GPS a fingir) e `npm run ensaio-placa`. Conferir a mesma tabela de caminhos do ensaio geral da parte 1 (Tarefa 8, passo 7), com a origem `arlequin-simulador.caixas`, e que `~/arlequin-dados` e a pasta `config` do barco não foram tocadas. Depois tirar o cabo USB da caixa 1 durante 15 s e voltar a pô-lo (é o Ivo que o faz): os valores passam a `null`, o aviso aparece, e tudo volta sem mexer no servidor. Este passo fecha dois pendentes da parte 1: o comportamento verdadeiro do cabo tirado e a procura automática da porta com uma placa a sério.
- [ ] **Step 6: Commit** `git commit -m "Portátil: linha do motor com soma, estado do sensor e ensaio com as placas"`

### Task 7: O sensor verdadeiro

Depende de haver um sensor a responder. O primeiro deixou de responder a 22/11 e a 23/11 ficou provado que não é dos fios, das soldas nem da placa (ponto 12 do desenho). O Ivo encomendou outro. Até ele chegar a caixa anda com o estado do sensor a 3 e o resto a trabalhar, que é o que o Review Focus 3 pede.

**Mudança de 23/11 (pedido do Ivo: "ligamos logo os pinos todos para acordar e tudo"; parecer do Claude):** o sensor novo liga-se logo pela ligação que o fabricante dá como fiável nestas placas, a de 10 ligações (SPI), com o INT e o RST, e com a biblioteca do fabricante (Adafruit BNO08x 1.2.7, já instalada), que nessa ligação só lê quando o sensor avisa. A de 4 fios era a única suspeita que o fabricante já tinha escrito, e não se repete a experiência num sensor novo.

**As ligações do sensor novo** (a marcar na foto do Ivo antes de ele ligar; os seis primeiros fios ficam onde estão hoje):

| Sensor | Placa | Nota |
|---|---|---|
| VIN | 3V3 | como hoje (vermelho) |
| GND | GND | como hoje (preto) |
| SCL | D22 | como hoje (castanho); nesta ligação é o relógio |
| SDA | D21 | como hoje (laranja); nesta ligação são os dados do sensor para a placa |
| INT | D19 | como hoje (branco) |
| RST | D18 | como hoje (azul) |
| DI | D23 | novo: os dados da placa para o sensor. É o último pino da fila, colado ao castanho |
| CS | D5 | novo: a placa escolhe o sensor. É o pino colado ao azul, do lado do vermelho |
| P0 e P1 | 3 V | duas gotas de solda nas pontes "PS0" e "PS1" das costas do sensor: dizem-lhe que a ligação é esta |

**Files:**
- Create: `software/caixas/caixa1/sensor.h`
- Modify: `software/caixas/caixa1/caixa1.ino`, `software/caixas/caixa1/pinos.h`
- Test: `software/caixas/ensaio/caixa1.test.js`

**Interfaces:**
- `sensor.h`: `void sensorIniciar()`, `void sensorCorre(uint32_t agoraMs)`, `uint8_t sensorEstado()` (0 a 3), `uint32_t sensorRsts()`, `bool sensorGuarda()` (o comando `guardar`: o sensor grava as calibrações dele agora; a gravação automática de 5 em 5 segundos fica desligada, regra 7). Máquina de estados: **a arrancar** (toque no RST, a biblioteca espera pelo INT e pelo "recomeço completo", desliga-se a gravação periódica das calibrações, pedem-se aceleração, rotação e atitude a 100 por segundo, e só passa a **a medir** quando as três chegam: regra 2); **calado** ao fim de 500 ms sem leituras (toque no RST e volta a arrancar; os toques espaçam-se: 1 s, 2 s, 5 s, 10 s, depois de 30 em 30 s); **não volta** ao fim de 5 toques seguidos sem leituras (continua a tentar de 30 em 30 s). O arranque do sensor demora mais do que os 50 ms que o ciclo principal admite: enquanto durar, o batimento continua a sair (a espera faz-se aos bocados, com o ciclo a dar a volta).
- **As primeiras horas do sensor novo correm ao ritmo do desenho** (100 / 100 / 100) e sem ensaios ao dobro do ritmo.

- [ ] **Step 1: Ensaios que falham**
  - "movimento verdadeiro": sem geradores, 49 a 51 `$AQM` em 5 s, `k` ≥ 9, norma da aceleração entre 9,3 e 10,3 m/s² com a caixa pousada, estado do sensor 0.
  - "Review Focus 3, o sensor cala-se": `manda('rst')` a meio; os `$AQM` voltam em menos de 2 s, o número de ordem continua, o contador de toques sobe 1, e durante esse tempo o batimento e o log (gerador a 26 Hz) não falham uma linha.
  - "a placa recomeça com o sensor a meio de uma frase": `manda('prender')`; depois do recomeço os `$AQM` voltam em menos de 5 s (regras 1 e 3).
  - "sem sensor": com o fio do CS fora (é o Ivo que o tira e volta a pôr, com a placa desligada do PC de cada vez), o estado passa a 2 e depois a 3 e o batimento não falha; com o fio de volta passa a 0 sozinho em menos de 40 s.

- [ ] **Step 2: Correr e ver falhar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Gravar e ver passar.** Expected: PASS.
- [ ] **Step 5: O ensaio de resistência (regra 9).** Três horas ao ritmo do desenho, com `software/caixas/ensaio/resistencia.js` a contar, pelo `ler()`: linhas inválidas, saltos no número de ordem, segundos sem `$AQM`, mudanças do estado do sensor e toques no RST. Passa com 3 horas em que qualquer bloqueio se resolva sozinho; regista-se no ponto 12 do desenho o tempo total sem leituras e a taxa de linhas estragadas a 460 800 baud.
- [ ] **Step 6: Commit** `git commit -m "Caixa 1: o sensor BNO085, com o INT, o RST e as regras da bancada"`

### Task 8: Instruções e arrumação

**Files:**
- Create: `software/caixas/README.md`
- Modify: `software/README.md`, `docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md` ("Das caixas para o portátil" e o ponto 12), `docs/caixas/` (a foto dos fios, se a ligação final mudar)

- [ ] **Step 1:** `software/caixas/README.md`: para que serve cada caixa, os pinos, como se compila e grava cada uma, como se correm os ensaios com as placas, os comandos de ensaio, e o que a luz de cada placa quer dizer.
- [ ] **Step 2:** `software/README.md`: a linha das caixas na tabela e o `npm run ensaio-placa`.
- [ ] **Step 3:** O desenho: o contrato como ficou (soma no motor, campos novos no batimento) e o resultado do ensaio de resistência.
- [ ] **Step 4:** `cd software/dev && npm test` (tudo verde, com os ensaios das placas saltados se não estiverem ligadas) e `git commit -m "Caixas: instruções"`.

---

## O que fica para depois

- A linguagem do repetidor do mostrador do vento (se a foto das costas mostrar que não sai NMEA): fica para quando se souber a versão.
- O comparador da roda do log e a adaptação de nível do vento: são peças, escolhem-se depois de medir o sinal (pontos em aberto 1 e 2).
- Se a ligação de 10 ligações (SPI) também der bloqueios no ensaio de resistência, sobra a ligação série do sensor (UART), que o fabricante também dá como boa nestas placas.
- A conta da onda sobre a gravação.
