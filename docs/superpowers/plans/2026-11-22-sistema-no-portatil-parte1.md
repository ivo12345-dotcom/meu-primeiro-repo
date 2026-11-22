# Sistema no portátil, parte 1 (o lado do portátil): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o portátil recebe as linhas da caixa 1 (por USB), põe no SignalK o vento, a velocidade na água, a proa, o adornamento, o movimento do barco e o motor, e prova-se tudo em casa com uma caixa a fingir, sem depender das placas.

**Architecture:**
- **A linguagem das linhas** entre a caixa 1 e o portátil fica definida aqui (secção própria). É o contrato com o firmware, que tem plano à parte.
- **Plugin novo `software/signalk-arlequin-caixas`:** `lib/linhas.js` (ler e escrever linhas), `lib/contas.js` (log, vento, atitude, desvios), `lib/movimento.js` (o bloco por segundo), `lib/caixas.js` (estado de cada caixa e avisos), `lib/fonte.js` (porta série ou TCP, com religação e procura automática) e o `index.js` que os junta.
- **Plugin do motor:** fonte nova `caixa`, que usa o mesmo evento `arlequin-j1939` e sabe pela caixa 2 se o motor está calado ou se se perdeu a leitura.
- **Caixa a fingir** (`software/ferramentas/caixa-a-fingir`): fala a mesma linguagem por TCP, e faz também de AIS/GPS.
- **Perfil de bordo** (`software/bordo`): o SignalK do portátil sem simulador, com dois modos, `bordo` e `ensaio`.

**Tech Stack:** Node ≥ 22 (o portátil tem o 24), CommonJS, `node:test`; SignalK 2.33.0 (o de `software/dev/node_modules`); a `serialport` 11.0.1 que vem com o servidor; `signalk-derived-data` 1.47.0 (único descarregamento do plano).

**Spec:** `docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md`

## Global Constraints

- "As caixas só leem e mandam os valores em bruto. As contas e as calibrações ficam num plugin do SignalK": nenhuma calibração nas linhas; todas na configuração do plugin, para se corrigirem sem regravar as placas.
- "A leitura dos sensores não depende do telemóvel": nada deste plano pode depender de rede.
- O movimento: 10 leituras por segundo, um bloco por segundo num caminho próprio, **sem alterações ao plugin da caixa negra**.
- As tramas do motor chegam ao plugin do motor "no formato `candump -L`", pelo evento `arlequin-j1939`.
- Motor com a fonte `caixa`: "sem ligação" quando o batimento da caixa 2 para; "calado" quando há batimento sem tramas (ignição desligada, conta como vela).
- **Nunca um valor velho:** um caminho sem leitura nova há mais de 5 s publica-se a `null` (regra K-07 do projeto).
- **Dados a fingir nunca ensinam a AI:** tudo o que não vem do barco a navegar sai com `$source` `arlequin-simulador.caixas` (a caixa negra marca `simulado` o que vem de `arlequin-simulador` ou `arlequin-simulador.*`).
- Sem dependências novas nos nossos plugins: a `serialport` é a do servidor. O único descarregamento é o `signalk-derived-data@1.47.0` (Tarefa 8) e **só com o OK do Ivo**.
- Textos em pt-PT. Unidades SI no SignalK. Nunca `NaN` nem `undefined` publicados.
- Definições do Windows (firewall, não adormecer, portas) não se mexem: só se documentam, porque são do Ivo.
- O SignalK do dev e o de bordo usam a porta 3000: nunca os dois ao mesmo tempo. Não matar processos que a tarefa não arrancou.
- Repositório público: sem tokens, sem números de série, sem endereços de placas.
- Git: ramo `claude/piloto-automatico-cwnr0f`; nunca mudar a configuração do git; cada commit termina com uma linha em branco e `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Quem executa uma tarefa não faz push; faz quem coordena, no fim de cada tarefa revista.

## Review Focus

1. **O cabo USB sai e volta, ou a placa reinicia a meio de uma linha:** o plugin religa-se sozinho, e meia linha nunca dá um valor (Tarefa 4).
2. **A porta COM muda de número, ou há duas placas ligadas:** com `porta: 'auto'` encontra a caixa 1 pelo batimento dela (Tarefa 4).
3. **A caixa reinicia e os contadores voltam a zero:** sem velocidades negativas nem picos, e sem milhares de "leituras em falta" (Tarefas 2 e 5).
4. **Lixo na linha** (arranque da placa a outra velocidade, linhas cortadas, campos fora dos limites): ignora-se e conta-se, sem rebentar nem encher o registo (Tarefas 1 e 5).
5. **O portátil adormece e acorda, ou um sensor cala-se** (o mostrador do vento desligado): os valores passam a `null` ao fim de 5 s e voltam sozinhos (Tarefa 5).

---

## A linguagem das linhas (contrato com o firmware)

Porta série por USB a **460 800 baud**, 8N1. Uma linha por leitura, terminada por `\n` (aceita-se `\r\n`), com 200 caracteres no máximo. O que não se reconhece ignora-se e conta-se.

As linhas próprias são `$AQ<tipo>,<campos>*HH`, com `HH` a soma do NMEA 0183: o ou-exclusivo de todos os caracteres entre o `$` e o `*`, em duas letras hexadecimais maiúsculas. Os números são inteiros decimais, com `-` nos negativos. Campos a mais no fim ignoram-se (para a linguagem poder crescer); campos a menos invalidam a linha.

| Linha | Cadência | Campos, por ordem |
|---|---|---|
| `$AQB` batimento | 1 por segundo e por caixa | caixa (1 ou 2); ms desde o arranque dessa caixa; versão do programa (`[A-Za-z0-9._-]`, 1 a 12); a fingir (0 ou 1); força do rádio em dBm (−127 a 0; a caixa 1 manda 0); perdidos (contador) |
| `$AQL` log | 2 por segundo | ms; impulsos (contador desde o arranque); período entre os dois últimos impulsos em µs (0 se não houver) |
| `$AQM` movimento | 10 por segundo | n.º de ordem; k (leituras do sensor na média, 1 a 255); aceleração x, y, z em mm/s² (±160 000); rotação x, y, z em 0,1 mrad/s (±350 000); quaternião i, j, k, r × 10 000 (±10 000, norma entre 0,9 e 1,1); erro estimado da atitude em 0,1 mrad (0 a 31 416); confiança (0 a 3) |
| `$..MWV` vento | como o mostrador mandar | a frase NMEA 0183 tal como chega (ou feita pela caixa, se o mostrador só falar a linguagem do repetidor): ângulo em graus, `R`, velocidade, unidade `N`, `M` ou `K`, estado `A` |
| `(s.µs) can1 ID#DADOS` motor | cada trama | a linha do `candump -L`, com o tempo da caixa 2 no lugar da hora; ID com 8 letras hexadecimais, 0 a 8 bytes de dados |

Exemplos com a soma certa:

```
$AQB,1,123456,0.1.0,0,0,0*65
$AQB,2,120000,0.1.0,1,-58,3*70
$AQL,123500,5210,38462*48
$AQM,1042,10,512,-2980,9320,-12,35,4,0,1736,0,9848,349,3*54
$IIMWV,35.0,R,14.0,N,A*3E
(12.345678) can1 0CF00400#FFFFFF004BFFFFFF
```

**O que o lado do portátil espera das caixas** (escrito ao executar o plano, a 22/11, para o plano do firmware):

- **O batimento da caixa 1 sai de segundo a segundo desde o primeiro segundo**, mesmo que o sensor ou o mostrador do vento não arranquem. Sem um batimento com 5 s ou menos o portátil não publica medição nenhuma: é por ele que sabe se a caixa finge.
- **O portátil abre a porta USB sem reiniciar a placa** (as duas linhas de comando em repouso). A caixa tem de aguentar as duas coisas: arrancar com o portátil já à escuta, e o portátil ligar-se a meio (a primeira linha pode ir cortada; deita-se fora).
- **Na procura automática** o portátil abre cada porta de placa ESP32 e espera 3 s pelo batimento da caixa 1. A caixa 2, se estiver ligada por USB só para ter corrente, manda o batimento dela (`caixa` 2) e o portátil passa logo à porta seguinte.
- **Uma porta aberta sem um único byte durante 10 s** é fechada e reaberta pelo portátil.
- **O sensor BNO085 guarda o estado quando a placa recomeça** e pode ficar a ignorar ordens: as regras de arranque estão no ponto 12 do desenho (bancada de 22/11).

**Decisão deste plano sobre o desenho:** a atitude deixa de ter linha própria. Vai no `$AQM`, como quaternião (a orientação completa que o chip calcula), em vez do adornamento e do caimento. Guarda-se mais e não se perde nada: o adornamento, o caimento e a proa tiram-se do quaternião no portátil, com a montagem da caixa na configuração.

---

### Task 1: A linguagem das linhas

**Files:**
- Create: `software/signalk-arlequin-caixas/package.json`
- Create: `software/signalk-arlequin-caixas/lib/linhas.js`
- Test: `software/signalk-arlequin-caixas/test/linhas.test.js`
- Modify: `docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md` (secção "Das caixas para o portátil")

**Interfaces:**
- Produces:
  - `BAUD = 460800`, `MAX_LINHA = 200`
  - `soma(texto: string): string` (duas letras hexadecimais maiúsculas)
  - `escrever(tipo: 'B'|'L'|'M', campos: Array<number|string>): string` (a linha completa, sem `\n`)
  - `ler(linha: string): object | null`, que devolve um de:
    - `{ tipo: 'batimento', caixa, ms, fw, sim: boolean, rssi, perdidos }`
    - `{ tipo: 'log', ms, impulsos, periodoUs }`
    - `{ tipo: 'movimento', n, k, a: [x,y,z], w: [x,y,z], q: [i,j,k,r], precisao, estado }` (os inteiros tal como chegam)
    - `{ tipo: 'vento', angulo, velocidade }` (graus de 0 a 360 exclusive; m/s)
    - `{ tipo: 'motor', id: number, dados: string }` (dados em hexadecimal maiúsculo)
  - `linhaMotor(m: { id, dados }, agoraMs: number): string` (a linha `candump -L` com a hora do portátil)

- [ ] **Step 1: Criar o `package.json`** igual ao do `signalk-arlequin-j1939` (mesmas chaves), com `name` `signalk-arlequin-caixas`, `description` "Caixas ESP32 do Arlequin: vento, velocidade na água, proa, adornamento, movimento e motor, por USB" e sem `dependencies`.

- [ ] **Step 2: Escrever os testes que falham**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { ler, escrever, soma, linhaMotor, BAUD, MAX_LINHA } = require('../lib/linhas')

test('soma e escrever: como no NMEA 0183', () => {
  assert.equal(soma('AQB,1,123456,0.1.0,0,0,0'), '65')
  assert.equal(escrever('B', [1, 123456, '0.1.0', 0, 0, 0]), '$AQB,1,123456,0.1.0,0,0,0*65')
  assert.equal(BAUD, 460800)
  assert.equal(MAX_LINHA, 200)
})

test('batimento das duas caixas', () => {
  assert.deepEqual(ler('$AQB,1,123456,0.1.0,0,0,0*65'), { tipo: 'batimento', caixa: 1, ms: 123456, fw: '0.1.0', sim: false, rssi: 0, perdidos: 0 })
  assert.deepEqual(ler('$AQB,2,120000,0.1.0,1,-58,3*70\r'), { tipo: 'batimento', caixa: 2, ms: 120000, fw: '0.1.0', sim: true, rssi: -58, perdidos: 3 })
})

test('log e movimento: os inteiros tal como chegam', () => {
  assert.deepEqual(ler('$AQL,123500,5210,38462*48'), { tipo: 'log', ms: 123500, impulsos: 5210, periodoUs: 38462 })
  assert.deepEqual(ler('$AQM,1042,10,512,-2980,9320,-12,35,4,0,1736,0,9848,349,3*54'),
    { tipo: 'movimento', n: 1042, k: 10, a: [512, -2980, 9320], w: [-12, 35, 4], q: [0, 1736, 0, 9848], precisao: 349, estado: 3 })
})

test('vento: só o aparente (R) válido (A), em m/s', () => {
  const v = ler('$IIMWV,35.0,R,14.0,N,A*3E')
  assert.equal(v.tipo, 'vento')
  assert.equal(v.angulo, 35)
  assert.ok(Math.abs(v.velocidade - 7.202216) < 1e-6)
  assert.deepEqual(ler('$IIMWV,350.0,R,7.5,M,A*3A'), { tipo: 'vento', angulo: 350, velocidade: 7.5 })
  assert.equal(ler('$IIMWV,35.0,T,14.0,N,A*38'), null) // vento real: não é o que o mostrador mede
  assert.equal(ler('$IIMWV,35.0,R,14.0,N,V*29'), null) // o mostrador diz que não vale
})

test('motor: a trama, e a linha para o plugin do motor com a hora do portátil', () => {
  const m = ler('(12.345678) can1 0cf00400#ffffff004bffffff')
  assert.deepEqual(m, { tipo: 'motor', id: 0x0CF00400, dados: 'FFFFFF004BFFFFFF' })
  assert.equal(linhaMotor(m, 1_727_600_000_123), '(1727600000.123000) can1 0CF00400#FFFFFF004BFFFFFF')
})

test('Review Focus 4: lixo e linhas fora dos limites dão null, nunca um valor', () => {
  const M = [1042, 10, 512, -2980, 9320, -12, 35, 4, 0, 1736, 0, 9848, 349, 3]
  const com = (i, v) => escrever('M', M.map((x, j) => (j === i ? v : x)))
  for (const l of [
    '', 'ola', '\u0000ÿ\u0012', '$AQB,1,123456,0.1.0,0,0,0*66', '$AQB,1,123456,0.1.0,0,0,0', '$AQB,1,123456*00',
    escrever('B', [3, 1, '0.1.0', 0, 0, 0]), escrever('B', [1, 1, 'versao com espacos', 0, 0, 0]),
    escrever('B', [1, 1, '0.1.0', 2, 0, 0]), escrever('B', [1, 1, '0.1.0', 0, 5, 0]),
    escrever('L', [1, -4, 0]), escrever('L', [1, '12.5', 0]), escrever('L', [1, 2]),
    com(1, 0), com(2, 200000), com(5, 400000), com(11, 20000), com(11, 5000) /* norma 0,53 */, com(12, 40000), com(13, 4),
    '(12.3) can1 0CF004#00', '(12.3) can1 0CF00400#F', '$AQB,' + '1,'.repeat(120) + '*00'
  ]) assert.equal(ler(l), null, JSON.stringify(l))
  assert.equal(ler(escrever('M', [1, 10, 0, 0, 9807, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null) // quaternião nulo
  assert.notEqual(ler(escrever('B', [1, 1, '0.1.0', 0, 0, 0, 77, 'futuro'])), null) // campos a mais: aceita
})
```

- [ ] **Step 3: Correr e ver falhar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: FAIL com "Cannot find module '../lib/linhas'"

- [ ] **Step 4: Implementar `lib/linhas.js`** com as assinaturas acima. Os limites de cada campo são os da tabela da linguagem. Inteiros só com `/^-?\d+$/`. A velocidade do vento converte-se com N × 0,514444, K × 0,277778 e M × 1; o ângulo 360 passa a 0. A linha do motor valida-se com `^\((\d+)\.(\d{1,6})\)\s+(\S+)\s+([0-9A-Fa-f]{8})#((?:[0-9A-Fa-f]{2}){0,8})\s*$`.

- [ ] **Step 5: Correr e ver passar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: PASS, 6 testes

- [ ] **Step 6: Atualizar o desenho.** Na secção "Das caixas para o portátil" trocar "atitude do BNO085, o movimento do barco (10 linhas por segundo, com aceleração, rotação e inclinação, e um número de ordem para se ver se faltou alguma)" por uma frase que diga que o sensor vai numa só linha, 10 vezes por segundo, com a aceleração, a rotação, a orientação completa e um número de ordem, e apontar para este plano como o sítio dos campos exatos. Na tabela "O que se grava, 10 vezes por segundo", a terceira linha passa a "Orientação completa calculada pelo chip (quaternião)".

- [ ] **Step 7: Commit**

```bash
git add software/signalk-arlequin-caixas docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md
git commit -m "Caixas: a linguagem das linhas entre a caixa 1 e o portátil"
```

### Task 2: As contas (log, vento, atitude, desvios) e o bloco do movimento

**Files:**
- Create: `software/signalk-arlequin-caixas/lib/contas.js`
- Create: `software/signalk-arlequin-caixas/lib/movimento.js`
- Test: `software/signalk-arlequin-caixas/test/contas.test.js`
- Test: `software/signalk-arlequin-caixas/test/movimento.test.js`

**Interfaces:**
- Consumes: os objetos `log`, `vento` e `movimento` de `ler` (Tarefa 1).
- Produces (`contas.js`):
  - `NO = 0.514444`
  - `novoLog(): estado`; `juntarLog(estado, { ms, impulsos, periodoUs }): estado`; `hzLog(estado): number | null`
  - `velocidadeNaAgua(hz: number, nosPorHz = 0.2): number` (m/s)
  - `ventoAparente({ angulo, velocidade }, { desvioVento = 0, fatorVento = 1 }): { angleApparent, speedApparent }` (rad em ]−π, π], positivo a estibordo; m/s)
  - `eixos(eixoProa: string, eixoCima: string): { f, u, s } | null` (vetores no referencial do sensor; `null` se os dois eixos não forem perpendiculares). Eixos válidos: `'+x' '-x' '+y' '-y' '+z' '-z'`.
  - `atitude(q: [i,j,k,r], eixos): { roll, pitch, heading } | null` (rad; `heading` de 0 a 2π, magnética, sem desvios; `null` com quaternião nulo)
  - `corrigirProa(heading: number, { desvioProa = 0, tabelaDesvios = [] }): number` (rad, 0 a 2π)
  - `corrigirInclinacao({ roll, pitch }, { desvioAdorno = 0, desvioCaimento = 0 }): { roll, pitch }`
- Produces (`movimento.js`):
  - `novoBloco(): bloco`; `juntar(bloco, m): bloco`; `fechar(bloco): { n: number[], k: number[], a: number[][], w: number[][], q: number[][] } | null`
  - `emFalta(nAnterior: number | null, n: number): number`

**As regras que os testes não determinam sozinhos:**
- **Log.** Guardam-se as leituras dos últimos 3000 ms (pelo tempo da caixa). Se a leitura nova tiver `ms` ou `impulsos` menores do que a anterior, a caixa reiniciou: esvazia-se e recomeça. `hzLog`: `null` enquanto as leituras guardadas não abrangerem 2000 ms; com 8 impulsos ou mais entre a primeira e a última, impulsos × 1000 ÷ ms (por esta ordem, para dar números redondos); com 1 a 7 e `periodoUs` > 0 na última, 1 000 000 ÷ `periodoUs`; senão 0.
- **Atitude.** O chip dá a orientação do sensor no referencial Leste-Norte-Cima (x para leste, y para norte, z para cima). Roda-se com o quaternião cada vetor do barco escrito no referencial do sensor: `f` (para a proa), `u` (para cima) e `s = f × u` (para estibordo). Com `F`, `S` e `U` no referencial do mundo: `heading = atan2(F.leste, F.norte)`, `pitch = asin(F.cima)` (proa a subir é positivo), `roll = atan2(−S.cima, U.cima)` (estibordo a descer é positivo).
- **Tabela de desvios.** Entradas `{ rumo, desvio }` em graus. Primeiro soma-se o `desvioProa`; depois o desvio da tabela para esse rumo, interpolado em linha reta entre as duas entradas vizinhas, dando a volta aos 360°. Sem entradas é 0; com uma só, é sempre esse valor.
- **`eixos`.** Os vetores saem só com 0, 1 e −1, sem zeros negativos (o `deepEqual` distingue-os).
- **`emFalta`.** `n − nAnterior − 1` se estiver entre 1 e 999; senão 0 (a primeira leitura, a ordem certa, ou a caixa reiniciou).

- [ ] **Step 1: Escrever os testes que falham**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const c = require('../lib/contas')
const perto = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} não é ${b}`)
const GRAU = Math.PI / 180

test('log: 10 impulsos por segundo são 2 nós', () => {
  let e = c.novoLog()
  for (let i = 0; i <= 4; i++) e = c.juntarLog(e, { ms: 1000 + 500 * i, impulsos: 100 + 5 * i, periodoUs: 100000 })
  assert.equal(c.hzLog(e), 10)
  perto(c.velocidadeNaAgua(10), 1.028888)
  perto(c.velocidadeNaAgua(10, 0.25), 1.28611)
})

test('log devagar usa o período do último impulso; parado dá 0; sem 2 s de leituras dá null', () => {
  let e = c.novoLog()
  e = c.juntarLog(e, { ms: 0, impulsos: 7, periodoUs: 1000000 })
  assert.equal(c.hzLog(e), null)
  for (const [ms, impulsos] of [[500, 7], [1000, 8], [1500, 8], [2000, 9]]) e = c.juntarLog(e, { ms, impulsos, periodoUs: 1000000 })
  assert.equal(c.hzLog(e), 1)
  let p = c.novoLog()
  for (let i = 0; i <= 4; i++) p = c.juntarLog(p, { ms: 500 * i, impulsos: 42, periodoUs: 0 })
  assert.equal(c.hzLog(p), 0)
})

test('Review Focus 3: a caixa reinicia e a conta recomeça, sem negativos nem picos', () => {
  let e = c.novoLog()
  for (let i = 0; i <= 4; i++) e = c.juntarLog(e, { ms: 90000 + 500 * i, impulsos: 5000 + 5 * i, periodoUs: 100000 })
  e = c.juntarLog(e, { ms: 300, impulsos: 2, periodoUs: 0 })
  assert.equal(c.hzLog(e), null)
  for (let i = 1; i <= 4; i++) e = c.juntarLog(e, { ms: 300 + 500 * i, impulsos: 2 + 5 * i, periodoUs: 100000 })
  assert.equal(c.hzLog(e), 10)
})

test('vento aparente: ângulo para os dois bordos, desvio e fator', () => {
  perto(c.ventoAparente({ angulo: 350, velocidade: 7.5 }, {}).angleApparent, -0.174533)
  perto(c.ventoAparente({ angulo: 90, velocidade: 7.5 }, { desvioVento: 5 }).angleApparent, 1.658063)
  perto(c.ventoAparente({ angulo: 180, velocidade: 7.5 }, {}).angleApparent, Math.PI)
  perto(c.ventoAparente({ angulo: 10, velocidade: 10 }, { fatorVento: 1.1 }).speedApparent, 11)
})

test('eixos: 24 montagens válidas; eixos paralelos não', () => {
  assert.deepEqual(c.eixos('+y', '+z'), { f: [0, 1, 0], u: [0, 0, 1], s: [1, 0, 0] })
  assert.deepEqual(c.eixos('+x', '+z'), { f: [1, 0, 0], u: [0, 0, 1], s: [0, -1, 0] })
  assert.equal(c.eixos('+x', '-x'), null)
  assert.equal(c.eixos('+q', '+z'), null)
})

test('atitude: proa, adornamento a estibordo e proa a subir', () => {
  const plano = c.eixos('+y', '+z')
  let r = c.atitude([0, 0, 0, 1], plano) // o y do sensor aponta ao norte
  perto(r.heading, 0); perto(r.roll, 0); perto(r.pitch, 0)
  perto(c.atitude([0, 0, 0, 1], c.eixos('+x', '+z')).heading, Math.PI / 2) // o x aponta a leste
  perto(c.atitude([0, 0, 0.707107, 0.707107], c.eixos('+x', '+z')).heading, 0) // rodado 90° para a esquerda
  r = c.atitude([0, 0.173648, 0, 0.984808], plano) // 20° sobre o eixo norte: estibordo desce
  perto(r.roll, 0.349066); perto(r.pitch, 0); perto(r.heading, 0)
  r = c.atitude([0.087156, 0, 0, 0.996195], plano) // 10° sobre o eixo leste: a proa sobe
  perto(r.pitch, 0.174533); perto(r.roll, 0)
  assert.equal(c.atitude([0, 0, 0, 0], plano), null)
})

test('desvios da proa: fixo e por rumo, com a volta aos 360°', () => {
  const t = [{ rumo: 0, desvio: 2 }, { rumo: 180, desvio: -2 }]
  perto(c.corrigirProa(0, { tabelaDesvios: t }), 2 * GRAU)
  perto(c.corrigirProa(90 * GRAU, { tabelaDesvios: t }), 90 * GRAU)
  perto(c.corrigirProa(270 * GRAU, { tabelaDesvios: t }), 270 * GRAU)
  perto(c.corrigirProa(359 * GRAU, { desvioProa: 3 }), 2 * GRAU)
  perto(c.corrigirProa(10 * GRAU, { tabelaDesvios: [{ rumo: 77, desvio: -4 }] }), 6 * GRAU)
  perto(c.corrigirInclinacao({ roll: 0.1, pitch: 0.02 }, { desvioAdorno: 2, desvioCaimento: -1 }).roll, 0.1 - 2 * GRAU)
})
```

`movimento.test.js`:

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoBloco, juntar, fechar, emFalta } = require('../lib/movimento')

test('o bloco guarda os inteiros de cada leitura, pela ordem de chegada', () => {
  let b = novoBloco()
  assert.equal(fechar(b), null)
  for (let i = 0; i < 10; i++) b = juntar(b, { tipo: 'movimento', n: 1042 + i, k: 10, a: [512, -2980, 9320 + i], w: [-12, 35, 4], q: [0, 1736, 0, 9848], precisao: 349, estado: 3 })
  const v = fechar(b)
  assert.deepEqual(v.n, [1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051])
  assert.deepEqual(v.k, Array(10).fill(10))
  assert.deepEqual(v.a[9], [512, -2980, 9329])
  assert.deepEqual(v.w[0], [-12, 35, 4])
  assert.deepEqual(v.q[0], [0, 1736, 0, 9848])
  assert.deepEqual(Object.keys(v), ['n', 'k', 'a', 'w', 'q'])
})

test('Review Focus 3: leituras em falta, sem contar o reinício da caixa', () => {
  assert.equal(emFalta(null, 5), 0)
  assert.equal(emFalta(5, 6), 0)
  assert.equal(emFalta(5, 9), 3)
  assert.equal(emFalta(90000, 2), 0)
  assert.equal(emFalta(5, 5000), 0)
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: FAIL com "Cannot find module '../lib/contas'"

- [ ] **Step 3: Implementar `lib/contas.js` e `lib/movimento.js`** com as assinaturas e as regras acima.

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-caixas
git commit -m "Caixas: as contas do log, do vento e da atitude, e o bloco do movimento"
```

### Task 3: O estado de cada caixa e os avisos

**Files:**
- Create: `software/signalk-arlequin-caixas/lib/caixas.js`
- Test: `software/signalk-arlequin-caixas/test/caixas.test.js`

**Interfaces:**
- Consumes: o objeto `batimento` de `ler`.
- Produces:
  - `VELHO = 5000`, `ESPERA = 30000`
  - `novoEstadoCaixas(agora: number): estado`
  - `anotarBatimento(estado, batimento, agora): estado`
  - `anotarPorta(estado, { aberta: boolean, nome?: string, motivo?: string }, agora): estado`
  - `avaliarCaixas(estado, agora): { estado, caixas: { 1: { estado, motivo }, 2: { estado, motivo } }, sim: boolean, notificacoes: Array<{ id, state, method, message, apito? }> }`
  - o `estado` de cada caixa é `'a-receber'` ou `'sem-ligacao'`

**Regras:**
- Caixa 1: `'a-receber'` com um batimento dela há 5 s ou menos. Senão `'sem-ligacao'`, com o motivo "a porta <nome> não abre: <motivo>" se a porta estiver fechada, ou "a caixa não fala há N s" se estiver aberta.
- Caixa 2: se a caixa 1 não está `'a-receber'`, fica `'sem-ligacao'` com o motivo "sem a caixa dos instrumentos não se sabe"; com um batimento dela há 5 s ou menos, `'a-receber'`; senão `'sem-ligacao'` com "a caixa do motor não dá sinal (sem corrente ou fora do alcance do rádio)".
- `sim` é o do último batimento da caixa 1.
- Só a caixa 1 dá aviso (o da caixa 2 dá-o o plugin do motor, com o `semLigacao` dele). O aviso `caixa1` acende quando a caixa 1 passa de `'a-receber'` a `'sem-ligacao'`, ou quando passam 30 s do arranque sem nunca ter falado; apaga quando volta. Acende: `{ id: 'caixa1', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: 'A caixa dos instrumentos (vento, velocidade, proa) deixou de falar: <motivo>' }`. Apaga: `{ id: 'caixa1', state: 'normal', method: [], message: 'Normal' }`. Cada mudança sai uma vez.

- [ ] **Step 1: Escrever os testes que falham**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEstadoCaixas, anotarBatimento, anotarPorta, avaliarCaixas, VELHO, ESPERA } = require('../lib/caixas')
const bat = (caixa, sim = false) => ({ tipo: 'batimento', caixa, ms: 1, fw: '0.1.0', sim, rssi: -58, perdidos: 0 })

test('as duas caixas a falar; a 2 cala-se sem aviso daqui; a 1 cala-se com um aviso só', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)
  e = anotarBatimento(anotarBatimento(e, bat(1), 1000), bat(2), 1000)
  let r = avaliarCaixas(e, 2000)
  assert.equal(r.caixas[1].estado, 'a-receber')
  assert.equal(r.caixas[2].estado, 'a-receber')
  assert.deepEqual(r.notificacoes, [])
  e = anotarBatimento(r.estado, bat(1), 7000)
  r = avaliarCaixas(e, 7000)
  assert.equal(r.caixas[2].estado, 'sem-ligacao')
  assert.match(r.caixas[2].motivo, /caixa do motor não dá sinal/)
  assert.deepEqual(r.notificacoes, [])
  r = avaliarCaixas(r.estado, 7000 + VELHO + 1)
  assert.equal(r.caixas[1].estado, 'sem-ligacao')
  assert.match(r.caixas[1].motivo, /não fala há 5 s/)
  assert.match(r.caixas[2].motivo, /sem a caixa dos instrumentos/)
  assert.equal(r.notificacoes.length, 1)
  assert.deepEqual({ ...r.notificacoes[0], message: '' }, { id: 'caixa1', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: '' })
  assert.deepEqual(avaliarCaixas(r.estado, 20000).notificacoes, [])
  r = avaliarCaixas(anotarBatimento(r.estado, bat(1), 21000), 21000)
  assert.deepEqual(r.notificacoes, [{ id: 'caixa1', state: 'normal', method: [], message: 'Normal' }])
})

test('nunca falou: só avisa ao fim de 30 s, e diz porque a porta não abre', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: false, nome: 'COM7', motivo: 'File not found' }, 0)
  let r = avaliarCaixas(e, ESPERA - 1)
  assert.equal(r.caixas[1].estado, 'sem-ligacao')
  assert.deepEqual(r.notificacoes, [])
  r = avaliarCaixas(r.estado, ESPERA + 1)
  assert.match(r.notificacoes[0].message, /a porta COM7 não abre: File not found/)
})

test('a fingir: vem do último batimento da caixa 1', () => {
  const e = anotarBatimento(novoEstadoCaixas(0), bat(1, true), 100)
  assert.equal(avaliarCaixas(e, 200).sim, true)
  assert.equal(avaliarCaixas(anotarBatimento(e, bat(1, false), 300), 400).sim, false)
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: FAIL com "Cannot find module '../lib/caixas'"

- [ ] **Step 3: Implementar `lib/caixas.js`** com as assinaturas e as regras acima. As funções não mexem no estado recebido: devolvem um novo.

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-caixas
git commit -m "Caixas: o estado de cada caixa e o aviso de caixa calada"
```

### Task 4: A fonte das linhas (porta série ou TCP)

**Files:**
- Create: `software/signalk-arlequin-caixas/lib/fonte.js`
- Test: `software/signalk-arlequin-caixas/test/fonte.test.js`

**Interfaces:**
- Consumes: `ler`, `BAUD`, `MAX_LINHA` (Tarefa 1).
- Produces:
  - `RELIGAR = 3000`, `PROVA = 3000`
  - `abrirFonte({ porta, aoLinha, aoEstado, deps? }): { fechar(): void }`
    - `porta`: `'auto'`, o nome de uma porta série (`'COM7'`, `'/dev/ttyUSB0'`) ou `'tcp://host:porta'`
    - `aoLinha(texto: string)`: uma linha inteira, sem `\r` nem `\n`
    - `aoEstado({ aberta: boolean, nome: string, motivo?: string })`
    - `deps`: `{ SerialPort, net }`, para os testes
  - `pedirSerialport(): { SerialPort }`

**Regras:**
- A `serialport` procura-se primeiro com `require('serialport')` e, se não houver, na instalação do servidor: `require.resolve('serialport', { paths: [process.cwd(), pasta do require.main] })`. Sem ela, um erro que diga isso mesmo.
- Porta série: `new SerialPort({ path, baudRate: 460800, autoOpen: false })`.
- Os bytes partem-se em linhas pelo `\n`; tira-se o `\r`; uma linha com mais de 200 caracteres deita-se fora inteira. O que ficou a meio quando a porta fecha deita-se fora.
- Ao fechar ou dar erro: `aoEstado({ aberta: false, ... })` e nova tentativa ao fim de 3000 ms. O `fechar()` para tudo, incluindo tentativas marcadas.
- `'auto'`: `SerialPort.list()`; ficam as portas cujo `vendorId` (sem olhar a maiúsculas) é `10C4`, `1A86`, `0403` ou `303A`, por ordem do nome. Abre-se uma de cada vez e espera-se até 3000 ms por um batimento válido da **caixa 1**; a primeira que o der fica. Se nenhuma der: `aoEstado({ aberta: false, nome: 'auto', motivo: 'nenhuma porta com a caixa 1 (vistas: <nomes ou "nenhuma">)' })` e nova volta ao fim de 3000 ms.

- [ ] **Step 1: Escrever os testes que falham.** Com uma `SerialPort` a fingir (um `EventEmitter` com `open(cb)`, `close(cb)`, `write` e `static list()`) e `t.mock.timers`:
  - `linhas partidas em bocados e com \r\n chegam inteiras`: emitir `'$AQL,1,2'` e depois `',3*hh\r\n$AQ'`; `aoLinha` recebe uma linha só, sem `\r`.
  - `Review Focus 4: uma linha com mais de 200 caracteres deita-se fora`: 300 caracteres sem `\n`, depois `\nola\n`; `aoLinha` só recebe `'ola'`.
  - `Review Focus 1: a porta fecha a meio de uma linha`: emitir `'$AQL,1,'`, depois `'close'`; avançar 3000 ms; a porta nova emite `'2,3*hh\n'`; `aoLinha` recebe `'2,3*hh'` e nunca uma linha começada antes do fecho; `aoEstado` viu `aberta: true`, `aberta: false`, `aberta: true`, por esta ordem.
  - `o fechar() cancela a religação`: fechar a porta, chamar `fechar()`, avançar 10 000 ms; não se cria outra porta.
  - `Review Focus 2: auto escolhe a porta da caixa 1`: `list()` devolve `COM3` (vendorId `046D`, um rato), `COM5` (`10c4`, só lixo), `COM8` (`1A86`, batimento da caixa 2) e `COM9` (`10C4`, batimento da caixa 1); fica aberta a `COM9`, a `COM3` nunca se abre, e `aoEstado` acaba em `{ aberta: true, nome: 'COM9' }`.
  - `auto sem nenhuma caixa: diz as portas que viu e volta a tentar`: o motivo contém `COM5` e, 3000 ms depois, `list()` foi chamada outra vez.
  - `tcp: liga, recebe linhas e religa quando o outro lado fecha`: com um servidor `net` verdadeiro numa porta livre (sem `mock.timers` neste teste; `RELIGAR` passa por `deps.religar = 50`).

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: FAIL com "Cannot find module '../lib/fonte'"

- [ ] **Step 3: Implementar `lib/fonte.js`** com as assinaturas e as regras acima. `deps.religar` e `deps.prova` (ms) substituem `RELIGAR` e `PROVA` quando vierem.

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: PASS

- [ ] **Step 5: Confirmar que a `serialport` do servidor se encontra neste portátil**

Run: `cd software/dev && node -e "console.log(typeof require('../signalk-arlequin-caixas/lib/fonte').pedirSerialport().SerialPort.list)"`
Expected: `function`

- [ ] **Step 6: Commit**

```bash
git add software/signalk-arlequin-caixas
git commit -m "Caixas: a fonte das linhas, por porta série ou TCP, com religação e procura da porta"
```

### Task 5: O plugin

**Files:**
- Create: `software/signalk-arlequin-caixas/index.js`
- Test: `software/signalk-arlequin-caixas/test/plugin.test.js`
- Modify: `software/ferramentas/ondas/tamanho.js` (o bloco novo, com o quaternião)
- Modify: `docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md` (o tamanho medido)

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 4.
- Produces:
  - `module.exports = function (app, { abrirFonte } = {})`, com `id` `signalk-arlequin-caixas`
  - o evento `app.emit('arlequin-j1939', linha)` por cada trama do motor, já com a hora do portátil
  - os caminhos do SignalK abaixo
  - `GET /plugins/signalk-arlequin-caixas/estado` (`readonly`): `{ porta, caixas, sim, linhas, invalidas, emFalta, ultimas: string[] }` (as 20 últimas linhas)

**Configuração (`plugin.schema`), com os valores por omissão:**

| Chave | Omissão | O que é |
|---|---|---|
| `porta` | `'auto'` | porta série, `'auto'` ou `tcp://host:porta` |
| `ensaio` | `false` | marca tudo como simulado (ensaios em casa com a caixa verdadeira) |
| `nosPorHz` | `0.2` | fator do log: nós por impulso por segundo |
| `desvioVento` | `0` | graus a somar ao ângulo do vento |
| `fatorVento` | `1` | fator da velocidade do vento |
| `eixoProa` | `'+y'` | eixo do sensor que aponta à proa |
| `eixoCima` | `'+z'` | eixo do sensor que aponta para cima |
| `desvioProa`, `desvioAdorno`, `desvioCaimento` | `0` | graus |
| `tabelaDesvios` | `[]` | `{ rumo, desvio }` em graus |
| `posicaoSensor` | `{ vante: 0, estibordo: 0, acima: 0 }` | metros, para a conta da onda (só se guarda) |
| `acelerometro` | `{ desvio: [0, 0, 0], escala: [1, 1, 1] }` | a calibração das seis faces (só se guarda) |

**O que publica:**

| Cadência | Caminhos |
|---|---|
| 2 por segundo | `navigation.attitude` (`{ roll, pitch, yaw }`, com `yaw` igual à proa corrigida), `navigation.headingMagnetic` |
| 1 por segundo | `navigation.speedThroughWater`, `environment.wind.angleApparent`, `environment.wind.speedApparent` |
| 1 por segundo | `arlequin.caixas.log.impulsos`, `arlequin.caixas.log.hz`, `arlequin.caixas.vento.angulo`, `arlequin.caixas.vento.velocidade`, `arlequin.caixas.atitude.precisao` (rad), `arlequin.caixas.atitude.estado` |
| 1 por segundo | `arlequin.caixas.1.estado`, `arlequin.caixas.2.estado`, `arlequin.caixas.1.fw`, `arlequin.caixas.2.fw`, `arlequin.caixas.1.perdidos`, `arlequin.caixas.2.perdidos`, `arlequin.caixas.2.rssi` |
| 1 por segundo, se houver leituras | `arlequin.caixas.movimento` (o valor de `fechar`) |

**Regras:**
- Cada grandeza vale enquanto a sua última linha tiver 5 s ou menos; depois publica-se a `null` (as três do topo e as "em bruto" dela). O relógio é o do portátil (`Date.now()`), para um salto de hora (o portátil acordou) envelhecer tudo de uma vez.
- Com `ensaio` ligado ou com a caixa 1 a dizer que finge, **todas** as atualizações levam `$source: 'arlequin-simulador.caixas'`; senão não levam `$source` (o servidor põe o id do plugin).
- As notificações de `avaliarCaixas` publicam-se em `notifications.arlequin.caixas.<id>`, com o `apito` dentro do valor quando o houver (como faz o plugin do motor).
- Linhas inválidas contam-se e só se mostram no estado do plugin e no `/estado`; nunca uma mensagem por linha no registo.
- Uma configuração com `eixoProa` e `eixoCima` paralelos dá `app.setPluginError` com a frase "o eixo da proa e o eixo de cima têm de ser diferentes e perpendiculares" e o plugin não arranca a fonte.
- Estado do plugin (`app.setPluginStatus`): `<porta> · caixa 1 <estado> · caixa 2 <estado> · <linhas> linhas · <invalidas> inválidas · <emFalta> leituras em falta`, com ` · A FINGIR` no fim quando for o caso. Com a caixa 1 `'sem-ligacao'` usa-se `app.setPluginError` com o motivo.
- O `stop()` fecha a fonte, para os temporizadores e põe o aviso `caixa1` a normal se estiver aceso.

- [ ] **Step 1: Escrever os testes que falham.** Com o `appFalso` do `signalk-arlequin-j1939/test/plugin.test.js` (copiado, a guardar também o `$source` de cada atualização em `app.fontes`) e uma fonte a fingir que guarda o `aoLinha` e o `aoEstado`. `t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })`. Linhas feitas com `escrever`.
  - `linhas → valores, a 1 e a 2 por segundo`: porta aberta `COM7`; batimentos das duas caixas; 5 linhas de log (`ms` 1000 a 3000 de 500 em 500, `impulsos` 100 a 120); `$IIMWV,35.0,R,14.0,N,A*3E`; 10 de movimento com `q` `[0, 1736, 0, 9848]`, `n` 1042 a 1051. Avançar 1000 ms. Esperado: `navigation.speedThroughWater` ≈ 1,028888; `environment.wind.angleApparent` ≈ 0,610865; `environment.wind.speedApparent` ≈ 7,202216; `navigation.attitude.roll` ≈ 0,3490 (tolerância 0,001); `navigation.headingMagnetic` ≈ 0; `arlequin.caixas.1.estado` `'a-receber'`; `arlequin.caixas.movimento.n` de 1042 a 1051; `arlequin.caixas.log.hz` 10; nenhum `$source` em `app.fontes`.
  - `a montagem e os desvios vêm da configuração`: `start({ eixoProa: '+x', desvioProa: 5, nosPorHz: 0.25 })`, mesmo movimento com `q` `[0, 0, 7071, 7071]`; `navigation.headingMagnetic` ≈ 5° em radianos; `speedThroughWater` ≈ 1,28611.
  - `Review Focus 5: um sensor cala-se e o valor passa a null; volta sozinho`: depois do primeiro teste, só batimentos durante 6 s; `speedThroughWater`, `angleApparent`, `speedApparent`, `attitude` e `headingMagnetic` são `null`. Chega um MWV: o vento volta, o resto continua `null`.
  - `Review Focus 5: o portátil acorda horas depois`: valores bons; `t.mock.timers.setTime(agora + 3 * 3600 * 1000)` e um tique de 1000 ms sem linhas; tudo a `null`, caixa 1 `'sem-ligacao'`, um aviso `notifications.arlequin.caixas.caixa1` em `warn`.
  - `a fingir: tudo sai marcado como simulado`: batimento da caixa 1 com `sim` 1; todas as atualizações seguintes têm `$source` `'arlequin-simulador.caixas'`. O mesmo com `start({ ensaio: true })` e `sim` 0.
  - `motor: a trama segue para o plugin do motor com a hora do portátil`: a linha `(12.345678) can1 0CF00400#FFFFFF004BFFFFFF` faz sair um evento `arlequin-j1939` com `(1727600000.000000) can1 0CF00400#FFFFFF004BFFFFFF`.
  - `Review Focus 3: a caixa reinicia`: movimento com `n` 5000 a 5009, depois `n` 0 a 9; `emFalta` no `/estado` continua 0. Depois `n` 10, 11, 15: `emFalta` é 3.
  - `Review Focus 4: lixo conta-se e não rebenta`: 50 linhas de lixo; `invalidas` é 50; `app.debug` e `app.error` não foram chamados 50 vezes (no máximo 1).
  - `eixos paralelos: erro claro e a fonte não se abre`.
  - `stop: fecha a fonte e apaga o aviso aceso`.
  - `K-11: o GET /estado regista-se readonly` (como no teste do plugin do motor).

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: FAIL com "Cannot find module '..'"

- [ ] **Step 3: Implementar `index.js`** com a configuração, as cadências e as regras acima.

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/signalk-arlequin-caixas && npm test`
Expected: PASS

- [ ] **Step 5: Medir o espaço na caixa negra com o bloco novo.** No `software/ferramentas/ondas/tamanho.js`, o formato "inteiros" passa a ser o do `fechar` (`n`, `k`, `a`, `w`, `q` com quatro inteiros por leitura) e o caminho passa a `arlequin.caixas.movimento`; os outros dois formatos saem.

Run: `cd software/ferramentas/ondas && node tamanho.js`
Expected: uma linha com "gravado N MB/h", com N entre 0,7 e 1,2. Pôr esse número (e os GB em 300 h) no desenho, onde hoje diz "cerca de 0,8 MB por hora, ou 0,25 GB em 300 horas", e juntar a linha ao `resultado-2026-11-21.txt` com a data de hoje.

- [ ] **Step 6: Commit**

```bash
git add software/signalk-arlequin-caixas software/ferramentas/ondas docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md
git commit -m "Caixas: o plugin que põe no SignalK o que a caixa 1 manda"
```

### Task 6: O plugin do motor aprende a fonte `caixa`

**Files:**
- Modify: `software/signalk-arlequin-j1939/lib/ligacao.js` (`avaliarLigacao`)
- Modify: `software/signalk-arlequin-j1939/index.js` (esquema, `start`, `stop`, `publicar`, estado do plugin)
- Test: `software/signalk-arlequin-j1939/test/ligacao.test.js`, `software/signalk-arlequin-j1939/test/plugin.test.js`

**Interfaces:**
- Consumes: o evento `arlequin-j1939` e os caminhos `arlequin.caixas.1.estado` e `arlequin.caixas.2.estado` (Tarefa 5).
- Produces: `fonte: 'caixa'` no esquema; `avaliarLigacao` aceita `s.caixa: (() => { viva: boolean, motivo: string }) | undefined`.

**Regras:**
- Com `s.caixa`: uma trama há 5 s ou menos, `'a-receber'`. Senão, se `s.caixa().viva`: `'calado'` depois de 5 s à escuta, `null` antes. Senão `'sem-ligacao'` com o motivo que a função deu. Não se lê interface nem `candump`.
- No `index.js`, com `fonte: 'caixa'`: ouve o evento como com o simulador; a função `caixa` lê `app.getSelfPath('arlequin.caixas.2.estado')` e dá `viva` se o valor for `'a-receber'` e a hora dele tiver 5 s ou menos. Motivos: com `arlequin.caixas.1.estado` diferente de `'a-receber'` (ou velho), "a caixa dos instrumentos não está ligada ao portátil"; senão "a caixa do motor não dá sinal (sem corrente ou fora do alcance do rádio)".
- O `velocidade()`, os alarmes e o resto ficam como estão. O estado do plugin diz `caixa · …` como diz `simulador · …`.

- [ ] **Step 1: Escrever os testes que falham.** Em `ligacao.test.js`:

```js
test('fonte caixa: a caixa 2 viva sem tramas é a ignição desligada; sem a caixa é leitura perdida', () => {
  const base = { agora: 100000, ultimaTrama: -Infinity, simulador: false, candumpVivo: false, lerInterface: () => { throw new Error('não se lê a interface') }, anterior: null, nome: 'can1' }
  const viva = () => ({ viva: true, motivo: '' })
  const morta = () => ({ viva: false, motivo: 'a caixa do motor não dá sinal (sem corrente ou fora do alcance do rádio)' })
  assert.deepEqual(avaliarLigacao({ ...base, ultimaTrama: 99000, ouvirDesde: 0, caixa: morta }), { ligacao: 'a-receber', motivo: null })
  assert.deepEqual(avaliarLigacao({ ...base, ouvirDesde: 90000, caixa: viva }), { ligacao: 'calado', motivo: null })
  assert.deepEqual(avaliarLigacao({ ...base, ouvirDesde: 98000, caixa: viva }), { ligacao: null, motivo: null })
  assert.deepEqual(avaliarLigacao({ ...base, ouvirDesde: 0, caixa: morta }), { ligacao: 'sem-ligacao', motivo: 'a caixa do motor não dá sinal (sem corrente ou fora do alcance do rádio)' })
})
```

Em `plugin.test.js`, com `app.getSelfPath` a devolver `{ value, timestamp }` de um mapa do teste:
  - `fonte caixa: tramas pelo evento dão rotações e estado, como no simulador` (as mesmas quatro tramas e os mesmos valores do teste do simulador).
  - `fonte caixa: a caixa 2 viva e sem tramas é 'calado'` (ao fim de 6 s; `propulsion.main.ligacao` `'calado'`, `propulsion.main.state` `'stopped'`).
  - `fonte caixa: sem a caixa 2 é 'sem-ligacao', com o aviso e o motivo certo` (os dois motivos, conforme a caixa 1).
  - `fonte caixa: o estado da caixa 2 com mais de 5 s não vale` (hora velha no `getSelfPath`).
  - `fonte caixa: nunca lança o candump` (o `spawn` a fingir não é chamado).

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/signalk-arlequin-j1939 && npm test`
Expected: FAIL nos testes novos (os antigos passam)

- [ ] **Step 3: Implementar** em `lib/ligacao.js` e `index.js`. Atualizar os comentários do cabeçalho dos dois ficheiros (a fonte nova e as suas regras).

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/signalk-arlequin-j1939 && npm test`
Expected: PASS, todos (antigos e novos)

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-j1939
git commit -m "Motor: fonte 'caixa', com as tramas pela caixa 1 e o estado pela caixa 2"
```

### Task 7: A caixa a fingir

**Files:**
- Create: `software/ferramentas/caixa-a-fingir/package.json`
- Create: `software/ferramentas/caixa-a-fingir/lib/gerador.js`
- Create: `software/ferramentas/caixa-a-fingir/caixa-a-fingir.js`
- Test: `software/ferramentas/caixa-a-fingir/test/gerador.test.js`

**Interfaces:**
- Consumes: `escrever`, `soma` (Tarefa 1); `tramasMotor` de `software/arlequin-simulador/lib/j1939sim.js`; `lerLinha` de `software/signalk-arlequin-j1939/lib/j1939.js`.
- Produces:
  - `CENARIO = { nos: 5.2, impulsosPorSegundo: 26, ventoAngulo: 35, ventoNos: 14.0, proa: 245, proaOscila: 3, adorno: 12, caimentoOscila: 2, sobeDesce: 0.4, periodo: 6, cicloMotor: 120, rpm: 2100, rssi: -58, lat: 38.695, lon: -9.236667, sog: 5.0, cog: 245 }`
  - `quaterniao({ proa, adorno, caimento }): [i,j,k,r]` (graus; para uma caixa montada com `eixoProa: '+y'`, `eixoCima: '+z'`)
  - `criarGerador({ inicio = Date.UTC(2026, 10, 22, 10, 15, 0), semCaixa2, semVento, lixo, ...cenario }?): { linhas(ms: number): string[], gps(ms: number): string[] }` (`ms` é o tempo desde o arranque; cada chamada devolve as linhas devidas desde a chamada anterior; `inicio` é a hora que o GPS a fingir dá no instante 0, e o programa passa-lhe `Date.now()`)
  - o programa: `node caixa-a-fingir.js [--porta 8765] [--porta-gps 8766] [--sem-caixa2] [--sem-vento] [--lixo] [--parar-aos <s>]`

**O cenário (`CENARIO`):** velocidade na água 5,2 nós (26 impulsos por segundo); vento aparente 35° e 14,0 nós; proa magnética 245°, a oscilar ±3° de 20 em 20 s; adornamento 12° a estibordo; caimento a oscilar ±2° de 6 em 6 s; aceleração vertical a oscilar ±0,4 m/s² de 6 em 6 s; motor desligado nos primeiros 60 s de cada ciclo de 120 s e a 2100 rpm nos outros 60 s (as tramas saem do `tramasMotor`, com o tempo da caixa na linha); as duas caixas dizem que fingem (`sim` 1); rádio a −58 dBm. O GPS: de 38° 41,700' N, 9° 14,200' W, a 5,0 nós no rumo 245°, uma frase `RMC` e uma `GGA` por segundo.

**As opções:** `--sem-caixa2` tira o batimento e as tramas da caixa 2; `--sem-vento` tira o MWV; `--lixo` mete de 5 em 5 s uma linha de lixo e uma linha cortada a meio; `--parar-aos N` deixa de mandar ao fim de N segundos e fecha a ligação (o cabo tirado).

- [ ] **Step 1: Escrever os testes que falham**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { criarGerador, quaterniao, CENARIO } = require('../lib/gerador')
const { ler, soma } = require('../../../signalk-arlequin-caixas/lib/linhas')
const c = require('../../../signalk-arlequin-caixas/lib/contas')
const GRAU = Math.PI / 180
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} não é ${b}`)

test('o quaternião feito aqui dá de volta a proa, o adornamento e o caimento', () => {
  const r = c.atitude(quaterniao({ proa: 245, adorno: 12, caimento: -2 }), c.eixos('+y', '+z'))
  perto(r.heading, 245 * GRAU, 1e-6); perto(r.roll, 12 * GRAU, 1e-6); perto(r.pitch, -2 * GRAU, 1e-6)
})

test('10 s de caixa: todas as linhas se leem e as cadências batem certo', () => {
  const g = criarGerador()
  const linhas = []
  for (let ms = 100; ms <= 10000; ms += 100) linhas.push(...g.linhas(ms))
  const lidas = linhas.map(ler)
  assert.ok(lidas.every(Boolean), linhas[lidas.indexOf(null)])
  const de = (tipo) => lidas.filter(l => l.tipo === tipo)
  assert.equal(de('batimento').filter(b => b.caixa === 1).length, 10)
  assert.equal(de('batimento').filter(b => b.caixa === 2).length, 10)
  assert.ok(de('batimento').every(b => b.sim === true))
  assert.equal(de('log').length, 20)
  assert.equal(de('movimento').length, 100)
  assert.deepEqual(de('movimento').map(m => m.n), Array.from({ length: 100 }, (_, i) => i + 1))
  assert.ok(de('vento').length >= 10)
  assert.equal(de('motor').length, 0) // nos primeiros 60 s o motor está desligado
})

test('os valores são os do cenário', () => {
  const g = criarGerador()
  let log = c.novoLog(); let ultimo
  for (let ms = 100; ms <= 4000; ms += 100) for (const l of g.linhas(ms).map(ler)) { if (l.tipo === 'log') log = c.juntarLog(log, l); if (l.tipo === 'movimento') ultimo = l; if (l.tipo === 'vento') { assert.equal(l.angulo, CENARIO.ventoAngulo); perto(l.velocidade, CENARIO.ventoNos * c.NO, 0.01) } }
  perto(c.velocidadeNaAgua(c.hzLog(log)) / c.NO, 5.2, 0.1)
  const r = c.atitude(ultimo.q.map(v => v / 10000), c.eixos('+y', '+z'))
  perto(r.roll, 12 * GRAU, 0.01); perto(r.heading, 245 * GRAU, 4 * GRAU)
})

test('a motor: saem tramas que o plugin do motor lê', () => {
  const g = criarGerador()
  const linhas = []
  for (let ms = 100; ms <= 62000; ms += 100) linhas.push(...g.linhas(ms))
  const motor = linhas.map(ler).filter(l => l && l.tipo === 'motor')
  assert.ok(motor.length >= 5)
  assert.ok(motor.some(m => (m.id >>> 8 & 0x3FFFF) === 61444))
})

test('as opções: sem a caixa 2, sem vento e com lixo', () => {
  const tudo = (o, ate = 62000) => { const g = criarGerador(o); const l = []; for (let ms = 100; ms <= ate; ms += 100) l.push(...g.linhas(ms)); return l }
  const sem2 = tudo({ semCaixa2: true }).map(ler)
  assert.equal(sem2.filter(l => l && l.tipo === 'batimento' && l.caixa === 2).length, 0)
  assert.equal(sem2.filter(l => l && l.tipo === 'motor').length, 0)
  assert.equal(tudo({ semVento: true }, 10000).map(ler).filter(l => l && l.tipo === 'vento').length, 0)
  assert.ok(tudo({ lixo: true }, 10000).map(ler).filter(l => l === null).length >= 2)
})

test('o GPS a fingir: RMC e GGA com a soma certa', () => {
  const g = criarGerador()
  const frases = g.gps(1000)
  assert.equal(frases.length, 2)
  for (const f of frases) { const m = /^\$(.*)\*([0-9A-F]{2})$/.exec(f); assert.ok(m, f); assert.equal(soma(m[1]), m[2]) }
  assert.match(frases[0], /^\$GPRMC,\d{6}\.\d\d,A,3841\.\d+,N,00914\.\d+,W,5\.0,245\.0,\d{6},,,A\*/)
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/ferramentas/caixa-a-fingir && npm test`
Expected: FAIL com "Cannot find module '../lib/gerador'"

- [ ] **Step 3: Implementar `lib/gerador.js`** (sem relógio nem acaso lá dentro: tudo sai do `ms` recebido) **e `caixa-a-fingir.js`** (dois servidores TCP em `localhost`; de 100 em 100 ms manda a cada cliente as linhas devidas; diz no ecrã, uma vez por segundo, quantos clientes tem e o que está a fingir). O `package.json` segue o dos outros, com `"test": "node --test \"test/*.test.js\""` e sem dependências.

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/ferramentas/caixa-a-fingir && npm test`
Expected: PASS, 6 testes

- [ ] **Step 5: Commit**

```bash
git add software/ferramentas/caixa-a-fingir
git commit -m "Ferramentas: caixa a fingir, para ensaiar o portátil sem as placas"
```

### Task 8: O perfil de bordo e o ensaio geral em casa

**Files:**
- Create: `software/bordo/package.json`, `software/bordo/preparar.js`
- Create: `software/bordo/config/package.json`, `software/bordo/config/settings.json`, `software/bordo/config/plugin-config-data/*.json`
- Test: `software/bordo/test/preparar.test.js`, `software/bordo/test/config-bordo.test.js`
- Modify: `.gitignore`, `software/dev/package.json` (o `test`), `software/README.md`

**Interfaces:**
- Consumes: os plugins das tarefas anteriores e a caixa a fingir.
- Produces:
  - `preparar(modo: 'bordo'|'ensaio', pasta: string): string[]` (o que mudou, para mostrar); em linha de comandos, `node preparar.js bordo|ensaio`
  - `npm run instalar`, `npm start` (bordo), `npm run ensaio`, `npm run caixa-a-fingir`, `npm test`, na pasta `software/bordo`

**A configuração no git (o estado `bordo`):**
- `config/package.json`: os mesmos plugins do `software/dev/config/package.json`, **sem** o `arlequin-simulador`, mais `"signalk-arlequin-caixas": "file:../../signalk-arlequin-caixas"` e `"signalk-derived-data": "1.47.0"`.
- `config/settings.json`: como o do dev, com dois `pipedProviders`:

```json
[
  { "id": "b330", "enabled": false, "pipeElements": [{ "type": "providers/simple", "options": { "logging": false, "type": "NMEA0183", "subOptions": { "type": "serial", "device": "", "baudrate": 38400, "validateChecksum": true } } }] },
  { "id": "b330-a-fingir", "enabled": false, "pipeElements": [{ "type": "providers/simple", "options": { "logging": false, "type": "NMEA0183", "subOptions": { "type": "tcp", "host": "localhost", "port": 8766, "validateChecksum": true } } }] }
]
```

- `plugin-config-data`: ligados `signalk-arlequin-caixas` (os valores por omissão da Tarefa 5), `signalk-arlequin-j1939` (`fonte: 'caixa'`, o resto como no dev), `signalk-arlequin-caixanegra` (`pasta: '~/arlequin-dados'`, limites como no dev), `signalk-arlequin-ia` e `signalk-arlequin-rota` (como no dev, com `pasta: '~/arlequin-dados'` e, na rota, **sem** `modoTeste`), `arlequin-ecra`, `signalk-arlequin-ais`, `signalk-logbook`, `course-provider`, `resources-provider` (como no dev) e `signalk-derived-data`. Desligados (`enabled: false`), porque ficam para depois: `signalk-arlequin-energia`, `signalk-arlequin-gasoleo`, `signalk-arlequin-agua`, `signalk-arlequin-porto` (este com o token e os contactos falsos do dev).
- `signalk-derived-data`: ligar só os cálculos que dão `navigation.magneticVariation`, `navigation.headingTrue`, `environment.wind.angleTrueWater`, `environment.wind.speedTrue` e `environment.wind.directionTrue`. Os nomes das opções leem-se no esquema do plugin depois de instalado.

**O `preparar` muda só isto, e guarda o resto como estiver** (as calibrações que o Ivo for acertando):

| | `bordo` | `ensaio` |
|---|---|---|
| caixas: `porta` | fica como está; se for `tcp://…`, passa a `'auto'` | `'tcp://localhost:8765'` |
| caixas: `ensaio` | `false` | `true` |
| caixa negra, AI e rota: `pasta` | `'~/arlequin-dados'` | `'arlequin-dados-ensaio'` |
| `b330-a-fingir`: `enabled` | `false` | `true` |
| `b330`: `enabled` | `true` se tiver `device`, senão `false` | `false` |

**Os comandos do `package.json`:** `instalar` é `cd config && npm install`; `start` é `node preparar.js bordo && node ../dev/node_modules/signalk-server/bin/signalk-server -c config`; `ensaio` é o mesmo com `ensaio`; `caixa-a-fingir` é `node ../ferramentas/caixa-a-fingir/caixa-a-fingir.js`; `test` é `node --test "test/*.test.js"`.

- [ ] **Step 1: Escrever os testes que falham.**
  - `preparar.test.js`, numa cópia da pasta `config` em `os.tmpdir()`: `ensaio` põe os valores da coluna e devolve a lista do que mudou; `bordo` a seguir repõe-nos; uma calibração escrita à mão (`nosPorHz: 0.23`, `desvioProa: 4`) sobrevive a `ensaio` seguido de `bordo`; uma `porta: 'COM7'` escrita à mão fica em `bordo` enquanto não se passar pelo `ensaio`, e depois do `ensaio` volta a `'auto'`; `b330` com `device: 'COM5'` fica ligado em `bordo` e desligado em `ensaio`; um modo desconhecido lança erro e não escreve nada.
  - `config-bordo.test.js`: o detetor de segredos do `software/dev/test/config-dev.test.js` (copiar a função `segredos`) não acha nada; o `config/package.json` não tem `arlequin-simulador`; o estado no git é o `bordo` (as cinco chaves da tabela, com `b330` desligado e sem `device`); o motor tem `fonte: 'caixa'`; a rota não tem `modoTeste: true`; os quatro plugins "para depois" estão desligados; o porto tem `telegramToken: 'DEV-TELEGRAM-FALSO'`.

- [ ] **Step 2: Correr e ver falhar**

Run: `cd software/bordo && npm test`
Expected: FAIL (não há `preparar.js` nem `config`)

- [ ] **Step 3: Implementar** o `preparar.js`, o `package.json`, a configuração e o `.gitignore` (como o do dev: `software/bordo/config/*` fora, menos `package.json`, `settings.json` e `plugin-config-data/`; e `software/bordo/arlequin-dados-ensaio/`).

- [ ] **Step 4: Correr e ver passar**

Run: `cd software/bordo && npm test`
Expected: PASS

- [ ] **Step 5: Juntar os testes novos ao `npm test` do dev.** No `software/dev/package.json`, o `test` passa a correr também `signalk-arlequin-caixas`, `ferramentas/caixa-a-fingir` e `bordo`.

Run: `cd software/dev && npm test`
Expected: PASS em tudo (os antigos e os novos)

- [ ] **Step 6: Instalar (precisa de rede e do OK do Ivo para o descarregamento do `signalk-derived-data@1.47.0`, 297 KB, do registo do npm, e das cinco bibliotecas de que depende).**

Run: `cd software/bordo && npm run instalar`
Expected: sem erros; `config/node_modules/signalk-arlequin-caixas` e `config/node_modules/signalk-derived-data` existem; `config/node_modules/arlequin-simulador` não existe.

- [ ] **Step 7: O ensaio geral.** Com o SignalK do dev parado. Num terminal `cd software/bordo && npm run caixa-a-fingir`; noutro, `npm run ensaio`. Esperar 30 s e conferir, com `curl -s http://localhost:3000/signalk/v1/api/vessels/self/<caminho>`:

| Caminho | Esperado |
|---|---|
| `navigation/speedThroughWater/value` | 2,67 ± 0,06 (5,2 nós) |
| `environment/wind/angleApparent/value` | 0,611 ± 0,01 |
| `navigation/attitude/value` | `roll` 0,209 ± 0,01 |
| `navigation/headingMagnetic/value` | entre 4,22 e 4,33 |
| `navigation/position/value` | latitude 38,69 ± 0,01 |
| `navigation/headingTrue/value` e `environment/wind/speedTrue/value` | números (vêm do `signalk-derived-data`) |
| `arlequin/caixas/1/estado/value` e `arlequin/caixas/2/estado/value` | `"a-receber"` |
| `propulsion/main/ligacao/value` | `"calado"` no primeiro minuto, `"a-receber"` no segundo |
| `propulsion/main/revolutions/value` | 35 no segundo minuto (2100 rpm) |
| `navigation/speedThroughWater/$source` | `"arlequin-simulador.caixas"` |

Conferir também: em `software/bordo/arlequin-dados-ensaio/tabela/` há um CSV de hoje em que as linhas têm `stw`, `aws`, `awa`, `adorno` e `proa` preenchidos e `simulado` a 1; em `…/bruto/` o ficheiro da hora tem deltas com `arlequin.caixas.movimento`; `~/arlequin-dados` **não** foi tocada; `http://localhost:3000/arlequin-ecra/` abre e mostra os valores. Depois: parar a caixa a fingir e ver, em 10 s, os valores a `null`, a caixa 1 `"sem-ligacao"` e o aviso no ecrã; voltar a arrancá-la e ver tudo voltar sem mexer no servidor. Repetir com `--sem-caixa2` (o motor passa a "sem leitura") e com `--lixo` (nada muda, as inválidas sobem no `/plugins/signalk-arlequin-caixas/estado`). Parar os dois programas no fim.

- [ ] **Step 8: Repor o estado do git e documentar.** `node preparar.js bordo`; `npm test` na pasta `software/bordo` (o servidor reescreve a configuração: o teste diz se ficou alguma coisa fora do sítio). No `software/README.md`: a linha do `signalk-arlequin-caixas` e as da caixa a fingir e do `bordo` na tabela, e uma secção "No portátil a bordo, com as duas caixas" com os comandos, o que é o modo `ensaio`, onde se põe a porta do B330 e o que fica por fazer à mão no Windows (não adormecer, firewall para o Fold): só dito, não feito.

- [ ] **Step 9: Commit**

```bash
git add .gitignore software/bordo software/dev/package.json software/README.md
git commit -m "Bordo: o SignalK do portátil sem simulador, com os modos bordo e ensaio"
```

---

## O que fica para os planos seguintes

- **O programa das duas placas**, a falar esta linguagem: a caixa 1 (sensor, log, vento, rádio, USB) e a caixa 2 (motor só em escuta, rádio). A ligação do sensor: a bancada de 22/11 mostrou que os 4 fios funcionam (ponto 12 do desenho); falta o resultado do ensaio de resistência e decidir com o Ivo o quinto fio (RST).
- **A conta da onda** sobre a gravação (altura e período), que o ensaio de bancada dos 30 cm precisa.
